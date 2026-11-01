// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";

import {
  QuestBaseline,
  QuestError,
  QuestPendingWrite,
  QuestRevisionRecord,
  QuestState,
  questAppliedUnderstanding,
  type ModelSelection,
  type QuestActor,
  type QuestConversation,
  type QuestFileContent,
  type QuestHistoryEntry,
  type QuestMembership,
  type QuestOpenConversationInput,
  type QuestQuestion,
  type QuestReconstruction,
  type QuestRecoverWriteInput,
  type QuestResultSource,
  type QuestRetained,
  type QuestSourcePin,
  type QuestThreadLink,
  type QuestUpdateInput,
  type QuestWork,
  type QuestWorkspaceFiles,
  type QuestWriteDocumentInput,
  type QuestWriteResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import * as ServerConfig from "../config.ts";
import { diffQuestDomain, questDomain, replayQuestRecord } from "./questArchive.ts";
import { QUEST_ID, QUEST_TITLE, questContextPacket, questSourceIds } from "./questContext.ts";
import {
  normalizeQuestFilePath,
  requireQuestRoot,
  resolveQuestFile,
  sha256,
  validateQuestWorkspace,
} from "./questFiles.ts";
import { migrateQuestV1, migrateQuestV2, QuestStateV1, QuestStateV2 } from "./questMigration.ts";
import { questSeedV1 } from "./questSeed.ts";

export interface QuestReservation {
  readonly state: QuestState;
  readonly conversation: QuestConversation;
  readonly created: boolean;
}

/** Whether the caller holds the environment's filesystem read grant; pins never read files without it. */
export interface QuestFileAccess {
  readonly readFiles: boolean;
}

export class QuestStore extends Context.Service<
  QuestStore,
  {
    /** Read-only: never creates, migrates or finalizes anything on disk. */
    readonly get: Effect.Effect<QuestState, QuestError>;
    readonly membership: Effect.Effect<QuestMembership, QuestError>;
    readonly threadLink: (threadId: string) => Effect.Effect<QuestThreadLink | null, QuestError>;
    readonly reconstruct: (revision: number) => Effect.Effect<QuestReconstruction, QuestError>;
    readonly update: (
      input: QuestUpdateInput,
      actor: QuestActor,
    ) => Effect.Effect<QuestState, QuestError>;
    /** Persists a conversation identity before any thread exists, or returns the one to resume. */
    readonly reserveConversation: (
      input: QuestOpenConversationInput,
      actor: QuestActor,
      access: QuestFileAccess,
    ) => Effect.Effect<QuestReservation, QuestError>;
    readonly finalizeConversation: (
      threadId: string,
      effective: ModelSelection,
      actor: QuestActor,
    ) => Effect.Effect<QuestState, QuestError>;
    readonly readDocument: (documentId: string) => Effect.Effect<QuestFileContent, QuestError>;
    readonly retained: (sha: string) => Effect.Effect<QuestRetained, QuestError>;
    readonly workspaceFiles: Effect.Effect<QuestWorkspaceFiles, QuestError>;
    readonly writeDocument: (
      input: QuestWriteDocumentInput,
      actor: QuestActor,
    ) => Effect.Effect<QuestWriteResult, QuestError>;
    /** Resolves a pending write against the file's actual bytes; a third version is a conflict. */
    readonly recoverWrite: (
      input: QuestRecoverWriteInput,
      actor: QuestActor,
    ) => Effect.Effect<QuestWriteResult, QuestError>;
  }
>()("t3/quest/QuestStore") {}

const QuestArchive = Schema.Struct({
  baseline: QuestBaseline,
  records: Schema.Array(QuestRevisionRecord),
});
type QuestArchive = typeof QuestArchive.Type;
const QuestStoreFile = Schema.Struct({
  format: Schema.Literal("t3-quest-store-3"),
  state: QuestState,
  archive: QuestArchive,
});

const encodeStoreFile = Schema.encodeEffect(Schema.fromJsonString(QuestStoreFile));
const decodeJson = Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown));
const decodeStoreFile = Schema.decodeUnknownEffect(QuestStoreFile);
const decodeV2 = Schema.decodeUnknownEffect(QuestStateV2);
const decodeV1 = Schema.decodeUnknownEffect(QuestStateV1);
const isPendingWrite = Schema.is(QuestPendingWrite);

interface Loaded {
  readonly state: QuestState;
  /** Null until the first write in this format starts structured history. */
  readonly archive: QuestArchive | null;
  /** The exact earlier bytes, kept as a backup when the first write replaces them. */
  readonly prior: { readonly encoded: string; readonly version: "v1" | "v2" } | null;
}

type Entry = Omit<QuestHistoryEntry, "id" | "revision" | "at">;
type Change = QuestUpdateInput["change"];
interface Meta {
  readonly operationId: string | null;
  readonly operation: string;
  readonly actor: QuestActor;
  readonly source: QuestResultSource | null;
}

const WORK_FIELDS = [
  ["title", "Title"],
  ["state", "State"],
  ["parentId", "Parent"],
  ["owner", "Human owner"],
  ["agent", "Agent assignment"],
  ["understanding", "Current understanding"],
  ["documentIds", "Documents"],
  ["priorAttempts", "Previous attempts"],
  ["findings", "Unresolved findings"],
  ["handoff", "Prepared handoff"],
] as const satisfies ReadonlyArray<readonly [keyof QuestWork, string]>;

function fieldText(value: QuestWork[keyof QuestWork]): string | null {
  if (value === null) return null;
  return typeof value === "string" ? value : value.join(", ");
}

function validParent(current: QuestState, work: QuestWork): boolean {
  let parent = work.parentId;
  const visited = new Set([work.id]);
  while (parent !== null) {
    if (visited.has(parent)) return false;
    visited.add(parent);
    const item = current.work.find((candidate) => candidate.id === parent);
    if (!item) return false;
    parent = item.parentId;
  }
  return true;
}

function documentExists(state: QuestState, id: string): boolean {
  return state.documents.some((doc) => doc.id === id) || state.files.some((file) => file.id === id);
}

function questionDraft(
  state: QuestState,
  draft: { workId: string; title: string; context: string; alternatives: ReadonlyArray<string> },
) {
  if (!state.work.some((item) => item.id === draft.workId) || !draft.title.trim()) return null;
  return {
    workId: draft.workId,
    title: draft.title.trim(),
    context: draft.context,
    alternatives: draft.alternatives.map((item) => item.trim()).filter((item) => item.length > 0),
  };
}

function nextQuestionId(state: QuestState): string {
  let index = state.questions.length + 1;
  while (state.questions.some((item) => item.id === `question-${index}`)) index += 1;
  return `question-${index}`;
}

function changeState(
  current: QuestState,
  change: Change,
  at: string,
  source: QuestResultSource | null,
): { readonly state: QuestState; readonly entry: Entry | null } | null {
  const question =
    "questionId" in change && change.questionId !== null
      ? current.questions.find((item) => item.id === change.questionId)
      : undefined;
  const nextRevision = current.revision + 1;
  switch (change.type) {
    case "work": {
      const work = change.work;
      const existing = current.work.find((item) => item.id === work.id);
      if (
        !existing ||
        work.kind !== existing.kind ||
        !work.title.trim() ||
        work.documentIds.some((id) => !documentExists(current, id)) ||
        !validParent(current, work)
      )
        return null;
      const changes = WORK_FIELDS.flatMap(([key, label]) => {
        const before = fieldText(existing[key]);
        const after = fieldText(work[key]);
        return before === after ? [] : [{ label, before, after }];
      });
      if (changes.length === 0) return { state: current, entry: null };
      return {
        state: {
          ...current,
          work: current.work.map((item) => (item.id === work.id ? work : item)),
        },
        entry: { kind: "work", targetId: work.id, summary: `Edited “${work.title}”`, changes },
      };
    }
    case "document": {
      const existing = current.documents.find((item) => item.id === change.document.id);
      if (
        !existing ||
        existing.kind === "evidence" ||
        change.document.kind !== existing.kind ||
        change.document.source !== existing.source ||
        change.document.sha256 !== existing.sha256 ||
        !change.document.title.trim()
      )
        return null;
      const changes = [
        { label: "Title", before: existing.title, after: change.document.title },
        { label: "Content", before: existing.body, after: change.document.body },
      ].filter((item) => item.before !== item.after);
      if (changes.length === 0) return { state: current, entry: null };
      return {
        state: {
          ...current,
          documents: current.documents.map((item) =>
            item.id === change.document.id ? change.document : item,
          ),
        },
        entry: {
          kind: "document",
          targetId: existing.id,
          summary: `Edited “${change.document.title}”`,
          changes,
        },
      };
    }
    case "answer": {
      const answer = change.answer?.trim() ? change.answer : null;
      const rationale = change.rationale?.trim() ? change.rationale : null;
      if (!question || question.applied || (!change.deferred && answer === null)) return null;
      const sourceTitle = (threadId: string | undefined) =>
        threadId === undefined
          ? null
          : (current.conversations.find((item) => item.threadId === threadId)?.title ?? threadId);
      return {
        state: {
          ...current,
          questions: current.questions.map((item) =>
            item.id === question.id
              ? { ...item, answer, rationale, deferred: change.deferred, answerSource: source }
              : item,
          ),
        },
        entry: {
          kind: change.deferred ? "defer" : "answer",
          targetId: question.id,
          summary: change.deferred
            ? `Deferred “${question.title}”`
            : `Recorded an answer to “${question.title}” (not applied)`,
          changes: [
            { label: "Answer", before: question.answer, after: answer },
            { label: "Rationale", before: question.rationale, after: rationale },
            {
              label: "From conversation",
              before: sourceTitle(question.answerSource?.threadId),
              after: sourceTitle(source?.threadId),
            },
          ].filter((item) => item.before !== item.after || item.label === "Answer"),
        },
      };
    }
    case "reopen": {
      if (!question || !question.applied) return null;
      return {
        state: {
          ...current,
          questions: current.questions.map((item) =>
            item.id === question.id ? { ...item, applied: false, deferred: false } : item,
          ),
        },
        entry: {
          kind: "reopen",
          targetId: question.id,
          summary: `Reopened “${question.title}” for revision. The earlier application stays in the work’s understanding until it is edited.`,
          changes: [],
        },
      };
    }
    case "apply": {
      const work = question && current.work.find((item) => item.id === question.workId);
      if (!question || !work || question.applied || question.deferred || !question.answer?.trim())
        return null;
      const understanding = questAppliedUnderstanding(work, question);
      return {
        state: {
          ...current,
          questions: current.questions.map((item) =>
            item.id === question.id
              ? { ...item, applied: true, appliedRevision: nextRevision }
              : item,
          ),
          work: current.work.map((item) =>
            item.id === work.id ? { ...item, understanding } : item,
          ),
        },
        entry: {
          kind: "apply",
          targetId: question.id,
          summary: `Applied the answer to “${question.title}” to “${work.title}”`,
          changes: [
            {
              label: `${work.title} · current understanding`,
              before: work.understanding,
              after: understanding,
            },
          ],
        },
      };
    }
    case "current": {
      const work = current.work.find((item) => item.id === change.workId);
      if (!work || work.kind !== "work" || current.currentWorkId === work.id) return null;
      const previous = current.work.find((item) => item.id === current.currentWorkId);
      return {
        state: { ...current, currentWorkId: work.id },
        entry: {
          kind: "current",
          targetId: work.id,
          summary: `Marked “${work.title}” as the current milestone`,
          changes: [
            { label: "Current milestone", before: previous?.title ?? null, after: work.title },
          ],
        },
      };
    }
    case "question-create": {
      const draft = questionDraft(current, change.question);
      if (!draft) return null;
      const created: QuestQuestion = {
        id: nextQuestionId(current),
        ...draft,
        answer: null,
        rationale: null,
        deferred: false,
        applied: false,
        proposal: false,
        answerSource: null,
        appliedRevision: null,
      };
      return {
        state: { ...current, questions: [...current.questions, created] },
        entry: {
          kind: "question",
          targetId: created.id,
          summary: `Prepared the question “${created.title}”`,
          changes: [{ label: "Question", before: null, after: created.context || created.title }],
        },
      };
    }
    case "question-edit": {
      const draft = questionDraft(current, change.question);
      if (!question || question.applied || !draft) return null;
      const changes = [
        { label: "Title", before: question.title, after: draft.title },
        { label: "Context", before: question.context, after: draft.context },
        {
          label: "Alternatives",
          before: question.alternatives.join("\n"),
          after: draft.alternatives.join("\n"),
        },
        { label: "Work", before: question.workId, after: draft.workId },
      ].filter((item) => item.before !== item.after);
      if (changes.length === 0) return { state: current, entry: null };
      return {
        state: {
          ...current,
          questions: current.questions.map((item) =>
            item.id === question.id ? { ...item, ...draft } : item,
          ),
        },
        entry: {
          kind: "question",
          targetId: question.id,
          summary: `Edited the question “${draft.title}”`,
          changes,
        },
      };
    }
    case "link": {
      if (
        !change.threadId.trim() ||
        current.conversations.some((item) => item.threadId === change.threadId) ||
        (change.workId !== null && !current.work.some((item) => item.id === change.workId)) ||
        (change.questionId !== null && !question)
      )
        return null;
      const about =
        current.work.find((item) => item.id === change.workId)?.title ?? question?.title ?? null;
      const purposeKind = change.purposeKind ?? "linked";
      const conversation: QuestConversation = {
        threadId: change.threadId,
        projectId: change.projectId,
        title: change.title,
        workId: change.workId,
        questionId: change.questionId,
        linkedAt: at,
        role: purposeKind === "linked" || purposeKind === "coordinate" ? "linked" : "focused",
        purposeKind: purposeKind === "coordinate" ? "linked" : purposeKind,
        purpose: change.purpose ?? "",
        sourceRevision: change.context === "fork" ? current.revision : null,
        sources: [],
        context: change.context ?? "none",
        prepared: null,
        origin: change.origin ?? null,
        creation: null,
      };
      return {
        state: { ...current, conversations: [...current.conversations, conversation] },
        entry: {
          kind: "link",
          targetId: change.threadId,
          summary:
            change.context === "fork"
              ? `Added the fork “${change.title}” as a discussion`
              : `Linked conversation “${change.title}”${about ? ` about “${about}”` : ""}`,
          changes: [],
        },
      };
    }
    case "unlink": {
      const existing = current.conversations.find((item) => item.threadId === change.threadId);
      if (!existing || existing.role === "core") return null;
      return {
        state: {
          ...current,
          conversations: current.conversations.filter((item) => item !== existing),
        },
        entry: {
          kind: "unlink",
          targetId: change.threadId,
          summary: `Detached “${existing.title}” from the Quest. The thread itself is unchanged.`,
          changes: [],
        },
      };
    }
    case "core-replace": {
      const core = current.conversations.find((item) => item.role === "core");
      if (!core || !change.reason.trim()) return null;
      return {
        state: {
          ...current,
          conversations: current.conversations.filter((item) => item !== core),
          corePredecessors: [
            ...current.corePredecessors,
            { conversation: core, replacedAt: at, reason: change.reason.trim() },
          ],
        },
        entry: {
          kind: "core",
          targetId: core.threadId,
          summary: `Retired the core conversation “${core.title}” as a predecessor`,
          changes: [{ label: "Reason", before: null, after: change.reason.trim() }],
        },
      };
    }
    case "workspace-register": {
      if (current.workspace?.root === change.root) return { state: current, entry: null };
      return {
        state: { ...current, workspace: { root: change.root, registeredAt: at } },
        entry: {
          kind: "workspace",
          targetId: null,
          summary: "Registered the Quest document workspace",
          changes: [
            { label: "Workspace", before: current.workspace?.root ?? null, after: change.root },
          ],
        },
      };
    }
    case "file-register": {
      if (current.files.some((file) => file.path === change.path) || !change.title.trim())
        return null;
      const id = `file-${NodeCrypto.randomUUID()}`;
      return {
        state: {
          ...current,
          files: [
            ...current.files,
            { id, path: change.path, title: change.title.trim(), registeredAt: at },
          ],
        },
        entry: {
          kind: "file",
          targetId: id,
          summary: `Registered the document ${change.path}`,
          changes: [],
        },
      };
    }
    case "write-discard": {
      const write = current.pendingWrites.find((item) => item.id === change.writeId);
      if (!write) return null;
      return {
        state: {
          ...current,
          pendingWrites: current.pendingWrites.filter((item) => item !== write),
        },
        entry: {
          kind: "file",
          targetId: write.documentId,
          summary: `Discarded the ${write.status} save of ${write.path}. Its versions stay retained.`,
          changes: [],
        },
      };
    }
  }
}

function freshSeed(at: string): QuestState {
  return migrateQuestV2(migrateQuestV1(questSeedV1, { at, fresh: true }));
}

function baselineLimit(loaded: Loaded): string {
  const revision = loaded.state.revision;
  if (loaded.prior === null)
    return `Created from the captured example at revision ${revision}; nothing earlier was saved.`;
  return `Structured history starts at revision ${revision}. Earlier revisions are described only by the prose history and cannot be reconstructed; the exact earlier file is kept as a backup.`;
}

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const mutex = yield* Semaphore.make(1);
  const directory = path.join(config.stateDir, "quest-prototype");
  const statePath = path.join(directory, "state.json");
  const pendingPath = path.join(directory, "state.pending.json");
  const blobDirectory = path.join(directory, "blobs");
  const storageError = (cause: unknown) => new QuestError({ reason: "storage", cause });
  const invalid = (detail?: string) =>
    new QuestError({ reason: "invalid", ...(detail === undefined ? {} : { detail }) });
  const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));

  const load = Effect.fn("QuestStore.load")(function* () {
    const exists = yield* fs.exists(statePath).pipe(Effect.mapError(storageError));
    if (!exists)
      return { state: freshSeed(yield* now), archive: null, prior: null } satisfies Loaded;
    const encoded = yield* fs.readFileString(statePath).pipe(Effect.mapError(storageError));
    const raw = yield* decodeJson(encoded).pipe(Effect.mapError(storageError));
    if (typeof raw === "object" && raw !== null && "format" in raw) {
      const stored = yield* decodeStoreFile(raw).pipe(Effect.mapError(storageError));
      return { state: stored.state, archive: stored.archive, prior: null } satisfies Loaded;
    }
    if (typeof raw === "object" && raw !== null && "schemaVersion" in raw) {
      const v2 = yield* decodeV2(raw).pipe(Effect.mapError(storageError));
      return {
        state: migrateQuestV2(v2),
        archive: null,
        prior: { encoded, version: "v2" },
      } satisfies Loaded;
    }
    const v1 = yield* decodeV1(raw).pipe(Effect.mapError(storageError));
    return {
      state: migrateQuestV2(migrateQuestV1(v1, { at: yield* now, fresh: false })),
      archive: null,
      prior: { encoded, version: "v1" },
    } satisfies Loaded;
  });

  const writeBlob = Effect.fn("QuestStore.writeBlob")(function* (bytes: Uint8Array) {
    const sha = sha256(bytes);
    const target = path.join(blobDirectory, sha);
    if (yield* fs.exists(target)) return sha;
    yield* fs.makeDirectory(blobDirectory, { recursive: true });
    const temporary = `${target}.${NodeCrypto.randomUUID()}.tmp`;
    yield* fs.writeFile(temporary, bytes);
    yield* fs.rename(temporary, target);
    return sha;
  }, Effect.mapError(storageError));

  /** Keeps the exact earlier file before its first replacement in this format. */
  const startArchive = Effect.fn("QuestStore.startArchive")(function* (loaded: Loaded) {
    const at = yield* now;
    let backupFile: string | null = null;
    let sourceSha256: string | null = null;
    if (loaded.prior !== null) {
      const bytes = new TextEncoder().encode(loaded.prior.encoded);
      sourceSha256 = sha256(bytes);
      backupFile = `state.${loaded.prior.version}.backup.json`;
      const existing = yield* fs.exists(path.join(directory, backupFile));
      if (existing) {
        const kept = yield* fs.readFile(path.join(directory, backupFile));
        if (sha256(kept) !== sourceSha256)
          backupFile = `state.${loaded.prior.version}.${sourceSha256.slice(0, 12)}.backup.json`;
      }
      if (!(yield* fs.exists(path.join(directory, backupFile))))
        yield* fs.writeFile(path.join(directory, backupFile), bytes);
    }
    return {
      baseline: {
        revision: loaded.state.revision,
        at,
        sourceSha256,
        backupFile,
        limit: baselineLimit(loaded),
        domain: questDomain(loaded.state),
      },
      records: [],
    } satisfies QuestArchive;
  }, Effect.mapError(storageError));

  /** Saves the next state and its revision record in one file replacement. */
  const commit = Effect.fn("QuestStore.commit")(function* (
    loaded: Loaded,
    changed: QuestState,
    entry: Entry,
    meta: Meta,
  ) {
    yield* fs.makeDirectory(directory, { recursive: true }).pipe(Effect.mapError(storageError));
    const archive = loaded.archive ?? (yield* startArchive(loaded));
    const at = yield* now;
    const revision = loaded.state.revision + 1;
    const next: QuestState = {
      ...changed,
      revision,
      history: [...loaded.state.history, { ...entry, id: `r${revision}`, revision, at }],
    };
    const record: QuestRevisionRecord = {
      revision,
      at,
      operationId: meta.operationId,
      operation: meta.operation,
      actor: meta.actor,
      source: meta.source,
      summary: entry.summary,
      ...diffQuestDomain(questDomain(loaded.state), questDomain(next)),
    };
    const encoded = yield* encodeStoreFile({
      format: "t3-quest-store-3",
      state: next,
      archive: { ...archive, records: [...archive.records, record] },
    }).pipe(Effect.mapError(storageError));
    yield* fs.writeFileString(pendingPath, encoded).pipe(Effect.mapError(storageError));
    yield* fs.rename(pendingPath, statePath).pipe(Effect.mapError(storageError));
    return next;
  });

  const replayed = (loaded: Loaded, operationId: string | undefined) =>
    operationId !== undefined &&
    (loaded.archive?.records.some((record) => record.operationId === operationId) ?? false);

  /** Validates what needs the filesystem, then hands a plain change to `changeState`. */
  const prepare = Effect.fn("QuestStore.prepare")(function* (state: QuestState, change: Change) {
    if (change.type === "workspace-register") {
      const root = yield* validateQuestWorkspace(fs, path, change.root);
      // Document ids and pending saves resolve against this root; moving it would silently retarget them.
      if (state.workspace !== null && state.workspace.root !== root && state.files.length > 0)
        return yield* invalid(
          "This Quest's documents are registered in its current workspace. Moving them to another folder is not supported.",
        );
      return { ...change, root };
    }
    if (change.type === "file-register") {
      if (!state.workspace) return yield* invalid("Register the Quest workspace first.");
      const resolved = yield* resolveQuestFile(fs, path, state.workspace.root, change.path);
      return { ...change, path: resolved.normalized };
    }
    return change;
  });

  const update = Effect.fn("QuestStore.update")(function* (
    input: QuestUpdateInput,
    actor: QuestActor,
  ) {
    const loaded = yield* load();
    if (replayed(loaded, input.operationId)) return loaded.state;
    if (input.expectedRevision !== loaded.state.revision)
      return yield* new QuestError({ reason: "conflict" });
    const change = yield* prepare(loaded.state, input.change);
    const changed = changeState(loaded.state, change, yield* now, input.source ?? null);
    if (!changed) return yield* invalid();
    if (changed.entry === null) return loaded.state;
    return yield* commit(loaded, changed.state, changed.entry, {
      operationId: input.operationId ?? null,
      operation: change.type,
      actor,
      source: input.source ?? null,
    });
  }, mutex.withPermits(1));

  /** Pins exact current bytes of a subject's documents; unreadable sources are named, not skipped. */
  const pinSources = Effect.fn("QuestStore.pinSources")(function* (
    state: QuestState,
    ids: ReadonlyArray<string>,
    access: QuestFileAccess,
  ) {
    const at = yield* now;
    return yield* Effect.forEach(ids, (documentId) =>
      Effect.gen(function* () {
        const legacy = state.documents.find((doc) => doc.id === documentId);
        if (legacy) {
          const sha = yield* writeBlob(new TextEncoder().encode(legacy.body));
          return { documentId, path: null, sha256: sha, capturedAt: at, unavailable: null };
        }
        const file = state.files.find((item) => item.id === documentId);
        if (file && !access.readFiles)
          return {
            documentId,
            path: file.path,
            sha256: null,
            capturedAt: at,
            unavailable: "not read: this connection has no file access",
          } satisfies QuestSourcePin;
        if (!file || !state.workspace)
          return {
            documentId,
            path: null,
            sha256: null,
            capturedAt: at,
            unavailable: "not registered",
          };
        const pinned = yield* resolveQuestFile(fs, path, state.workspace.root, file.path).pipe(
          Effect.flatMap((resolved) => fs.readFile(resolved.real)),
          Effect.flatMap(writeBlob),
          Effect.map((sha) => ({ sha, unavailable: null })),
          Effect.catch((error) =>
            Effect.succeed({
              sha: null,
              unavailable: error._tag === "QuestError" ? error.message : "could not be read",
            }),
          ),
        );
        return {
          documentId,
          path: file.path,
          sha256: pinned.sha,
          capturedAt: at,
          unavailable: pinned.unavailable,
        } satisfies QuestSourcePin;
      }),
    );
  });

  const reserveConversation = Effect.fn("QuestStore.reserveConversation")(function* (
    input: QuestOpenConversationInput,
    actor: QuestActor,
    access: QuestFileAccess,
  ) {
    const loaded = yield* load();
    const { state } = loaded;
    const byThread = (threadId: string) =>
      state.conversations.find((item) => item.threadId === threadId) ?? null;
    const replay = loaded.archive?.records.find(
      (record) => record.operationId === input.operationId,
    );
    const replayedThread = replay?.changes.find(
      (change) => change.collection === "conversations" && change.after !== null,
    )?.id;
    const replayedConversation = replayedThread ? byThread(replayedThread) : null;
    if (replayedConversation)
      return {
        state,
        conversation: replayedConversation,
        created: false,
      } satisfies QuestReservation;
    if (input.threadId !== undefined) {
      const exact = byThread(input.threadId);
      if (!exact) return yield* invalid("That conversation is no longer part of the Quest.");
      return { state, conversation: exact, created: false } satisfies QuestReservation;
    }
    if (input.role === "core") {
      const core = state.conversations.find((item) => item.role === "core");
      if (core) return { state, conversation: core, created: false } satisfies QuestReservation;
    } else if (input.resume) {
      const match = state.conversations.findLast(
        (item) =>
          item.role === "focused" &&
          item.purposeKind === input.purposeKind &&
          item.workId === input.workId &&
          item.questionId === input.questionId,
      );
      if (match) return { state, conversation: match, created: false } satisfies QuestReservation;
    }
    const work = state.work.find((item) => item.id === input.workId);
    const question = state.questions.find((item) => item.id === input.questionId);
    if (
      !input.projectId.trim() ||
      (input.workId !== null && !work) ||
      (input.questionId !== null && !question) ||
      (input.role === "focused" && input.purposeKind === "coordinate")
    )
      return yield* invalid();
    const workId = input.role === "core" ? state.currentWorkId : input.workId;
    const sources = yield* pinSources(
      state,
      questSourceIds(state, workId, input.questionId),
      access,
    );
    const at = yield* now;
    const about = question?.title ?? work?.title ?? null;
    const shape = {
      role: input.role,
      purpose: input.purpose.trim(),
      workId: input.workId,
      questionId: input.questionId,
      context: "packet",
    } as const;
    const conversation: QuestConversation = {
      threadId: NodeCrypto.randomUUID(),
      projectId: input.projectId,
      title:
        input.role === "core"
          ? `${QUEST_TITLE} · Core`
          : `${QUEST_TITLE} · ${shape.purpose || about || "Discussion"}`.slice(0, 120),
      workId: input.workId,
      questionId: input.questionId,
      linkedAt: at,
      role: input.role,
      purposeKind: input.role === "core" ? "coordinate" : input.purposeKind,
      purpose: shape.purpose,
      sourceRevision: state.revision,
      sources,
      context: "packet",
      prepared: questContextPacket(state, shape, sources, state.revision),
      origin: null,
      creation: {
        commandId: `quest:${input.operationId}`,
        status: "reserved",
        requested: {
          modelSelection: input.modelSelection,
          runtimeMode: input.runtimeMode,
          interactionMode: input.interactionMode,
          provenance: "client-default",
        },
        effectiveModelSelection: null,
        reservedAt: at,
        readyAt: null,
      },
    };
    const next = yield* commit(
      loaded,
      { ...state, conversations: [...state.conversations, conversation] },
      {
        kind: input.role === "core" ? "core" : "conversation",
        targetId: conversation.threadId,
        summary:
          input.role === "core"
            ? "Reserved the core conversation"
            : `Reserved the discussion “${conversation.title}”${about ? ` about “${about}”` : ""}`,
        changes: shape.purpose ? [{ label: "Purpose", before: null, after: shape.purpose }] : [],
      },
      { operationId: input.operationId, operation: "conversation-reserve", actor, source: null },
    );
    return { state: next, conversation, created: true } satisfies QuestReservation;
  }, mutex.withPermits(1));

  const finalizeConversation = Effect.fn("QuestStore.finalizeConversation")(function* (
    threadId: string,
    effective: ModelSelection,
    actor: QuestActor,
  ) {
    const loaded = yield* load();
    const conversation = loaded.state.conversations.find((item) => item.threadId === threadId);
    if (!conversation?.creation || conversation.creation.status === "ready") return loaded.state;
    const at = yield* now;
    const ready: QuestConversation = {
      ...conversation,
      creation: {
        ...conversation.creation,
        status: "ready",
        effectiveModelSelection: effective,
        readyAt: at,
      },
    };
    return yield* commit(
      loaded,
      {
        ...loaded.state,
        conversations: loaded.state.conversations.map((item) =>
          item === conversation ? ready : item,
        ),
      },
      {
        kind: conversation.role === "core" ? "core" : "conversation",
        targetId: threadId,
        summary: `“${conversation.title}” is ready. Nothing has been sent.`,
        changes: [],
      },
      {
        operationId: `${conversation.creation.commandId}:ready`,
        operation: "conversation-ready",
        actor,
        source: null,
      },
    );
  }, mutex.withPermits(1));

  const fileFor = (state: QuestState, documentId: string) => {
    const file = state.files.find((item) => item.id === documentId);
    return file && state.workspace ? { file, root: state.workspace.root } : null;
  };

  const readFileBytes = Effect.fn("QuestStore.readFileBytes")(function* (
    root: string,
    relative: string,
  ) {
    const resolved = yield* resolveQuestFile(fs, path, root, relative);
    const bytes = yield* fs
      .readFile(resolved.real)
      .pipe(
        Effect.mapError(
          () => new QuestError({ reason: "unavailable", detail: `${relative} could not be read.` }),
        ),
      );
    return { ...resolved, bytes, sha: sha256(bytes) };
  });

  const fileContent = (
    documentId: string,
    relative: string,
    bytes: Uint8Array | null,
    detail: string | null,
  ): QuestFileContent => ({
    documentId,
    path: relative,
    content: bytes === null ? null : new TextDecoder().decode(bytes),
    sha256: bytes === null ? null : sha256(bytes),
    unavailable: detail,
  });

  const readDocument = Effect.fn("QuestStore.readDocument")(function* (documentId: string) {
    const { state } = yield* load();
    const target = fileFor(state, documentId);
    if (!target) return yield* invalid("That document is not registered in this Quest.");
    return yield* readFileBytes(target.root, target.file.path).pipe(
      Effect.map((read) => fileContent(documentId, target.file.path, read.bytes, null)),
      Effect.catch((error) =>
        Effect.succeed(fileContent(documentId, target.file.path, null, error.message)),
      ),
    );
  });

  const retained = Effect.fn("QuestStore.retained")(function* (sha: string) {
    if (!/^[0-9a-f]{64}$/.test(sha)) return yield* invalid();
    const target = path.join(blobDirectory, sha);
    const exists = yield* fs.exists(target).pipe(Effect.mapError(storageError));
    if (!exists) return { sha256: sha, content: null };
    const bytes = yield* fs.readFile(target).pipe(Effect.mapError(storageError));
    return { sha256: sha, content: new TextDecoder().decode(bytes) };
  });

  const workspaceFiles = Effect.gen(function* () {
    const { state } = yield* load();
    if (!state.workspace) return { root: null, paths: [], truncated: false };
    yield* requireQuestRoot(fs, state.workspace.root);
    const listed = yield* fs.readDirectory(state.workspace.root, { recursive: true }).pipe(
      Effect.mapError(
        () =>
          new QuestError({
            reason: "unavailable",
            detail: "The Quest workspace is not available.",
          }),
      ),
    );
    const paths = listed
      .map((entry) => entry.replaceAll("\\", "/"))
      .filter(
        (entry) =>
          normalizeQuestFilePath(path, entry) === entry &&
          !entry.split("/").some((part) => part.startsWith(".") || part === "node_modules"),
      )
      .toSorted();
    return {
      root: state.workspace.root,
      paths: paths.slice(0, 500),
      truncated: paths.length > 500,
    };
  }).pipe(Effect.withSpan("QuestStore.workspaceFiles"));

  /**
   * The file a save is bound to, while the registered root and document still resolve to it. Saves
   * recorded without a target are refused before any workspace access.
   */
  const confirmTarget = Effect.fn("QuestStore.confirmTarget")(function* (
    state: QuestState,
    write: QuestPendingWrite,
  ) {
    const target = write.target;
    if (target === undefined)
      return yield* new QuestError({
        reason: "unavailable",
        detail: `This save of ${write.path} was recorded before T3 Code kept its file target, so it is not finished automatically. Its versions stay retained; discard it and save again.`,
      });
    const file = state.files.find((item) => item.id === write.documentId);
    if (!file || file.path !== write.path || state.workspace?.root !== target.root)
      return yield* new QuestError({
        reason: "unavailable",
        detail: `${write.path} is no longer registered where this save started.`,
      });
    const resolved = yield* resolveQuestFile(fs, path, target.root, write.path);
    if (resolved.real !== target.real)
      return yield* new QuestError({
        reason: "unavailable",
        detail: `${write.path} no longer leads to the file this save started with.`,
      });
    return target.real;
  });

  const readBound = Effect.fn("QuestStore.readBound")(function* (
    state: QuestState,
    write: QuestPendingWrite,
  ) {
    const real = yield* confirmTarget(state, write);
    const bytes = yield* fs
      .readFile(real)
      .pipe(
        Effect.mapError(
          () =>
            new QuestError({ reason: "unavailable", detail: `${write.path} could not be read.` }),
        ),
      );
    return { real, bytes, sha: sha256(bytes) };
  });

  /**
   * Replaces the bound file only while it still holds the expected bytes. The binding is checked
   * again right before the rename; changes by other writers within that last window are not
   * excluded atomically.
   */
  const replaceFile = Effect.fn("QuestStore.replaceFile")(function* (
    state: QuestState,
    write: QuestPendingWrite,
    bytes: Uint8Array,
  ) {
    const current = yield* readBound(state, write);
    if (current.sha !== write.expectedSha256)
      return { replaced: false as const, actual: current.bytes };
    const { real } = current;
    const temporary = `${real}.quest-${write.id}.tmp`;
    yield* fs.writeFile(temporary, bytes);
    yield* confirmTarget(state, write).pipe(
      Effect.andThen(fs.rename(temporary, real)),
      Effect.tapError(() => fs.remove(temporary).pipe(Effect.ignore)),
    );
    return { replaced: true as const, actual: bytes };
  });

  /** A save's current outcome from the state and its archive, for retries and repeated recovery. */
  const writeOutcome = Effect.fn("QuestStore.writeOutcome")(function* (
    loaded: Loaded,
    writeId: string,
  ) {
    const open = loaded.state.pendingWrites.find((item) => item.id === writeId);
    const removal = loaded.archive?.records
      .flatMap((record) =>
        record.changes
          .filter(
            (change) =>
              change.collection === "pendingWrites" &&
              change.id === writeId &&
              change.after === null,
          )
          .map((change) => ({ record, before: change.before })),
      )
      .at(-1);
    const removed = removal && isPendingWrite(removal.before) ? removal.before : null;
    const write = open ?? removed;
    if (!write) return yield* invalid("That save is no longer pending.");
    if (!open && removal?.record.operation === "write-discard")
      return yield* invalid("That save was discarded. Its versions stay retained.");
    // An unresolved save only reports the file it is bound to; a finished one reports the current file.
    const file = open
      ? yield* readBound(loaded.state, open).pipe(
          Effect.map((read) => fileContent(open.documentId, open.path, read.bytes, null)),
          Effect.catch((error) =>
            Effect.succeed(fileContent(open.documentId, open.path, null, error.message)),
          ),
        )
      : yield* readDocument(write.documentId);
    return {
      state: loaded.state,
      outcome: open ? open.status : "saved",
      file,
    } satisfies QuestWriteResult;
  });

  const writeMeta = (operationId: string, operation: string, actor: QuestActor): Meta => ({
    operationId,
    operation,
    actor,
    source: null,
  });

  const recordConflict = Effect.fn("QuestStore.recordConflict")(function* (
    loaded: Loaded,
    write: QuestPendingWrite,
    actualSha: string,
    meta: Meta,
  ) {
    const conflicted = {
      ...write,
      status: "conflict" as const,
      actualSha256: actualSha,
      detail:
        "The file changed outside T3 Code. Nothing was overwritten; both versions are retained.",
    };
    const exists = loaded.state.pendingWrites.some((item) => item.id === write.id);
    return yield* commit(
      loaded,
      {
        ...loaded.state,
        pendingWrites: exists
          ? loaded.state.pendingWrites.map((item) => (item.id === write.id ? conflicted : item))
          : [...loaded.state.pendingWrites, conflicted],
      },
      {
        kind: "file",
        targetId: write.documentId,
        summary: `Kept a conflicting save of ${write.path} without overwriting the file`,
        changes: [],
      },
      { ...meta, operationId: meta.operationId === null ? null : `${meta.operationId}:conflict` },
    );
  });

  const finalizeWrite = Effect.fn("QuestStore.finalizeWrite")(function* (
    loaded: Loaded,
    write: QuestPendingWrite,
    meta: Meta,
  ) {
    yield* confirmTarget(loaded.state, write);
    return yield* commit(
      loaded,
      {
        ...loaded.state,
        pendingWrites: loaded.state.pendingWrites.filter((item) => item.id !== write.id),
      },
      {
        kind: "file",
        targetId: write.documentId,
        summary: `Saved ${write.path}`,
        changes: [
          { label: "Content SHA-256", before: write.expectedSha256, after: write.desiredSha256 },
        ],
      },
      meta,
    );
  });

  /** Writes the file then finalizes; a failure between them leaves the durable intent pending. */
  const completeWrite = Effect.fn("QuestStore.completeWrite")(function* (
    loaded: Loaded,
    write: QuestPendingWrite,
    bytes: Uint8Array,
    meta: Meta,
  ) {
    const replaced = yield* replaceFile(loaded.state, write, bytes).pipe(
      Effect.map((result) => ({ ...result, failed: null })),
      Effect.catch((cause) =>
        Effect.succeed({ replaced: false as const, actual: null, failed: cause }),
      ),
    );
    if (replaced.failed !== null || replaced.actual === null)
      return {
        state: loaded.state,
        outcome: "pending" as const,
        file: fileContent(
          write.documentId,
          write.path,
          null,
          `${replaced.failed?._tag === "QuestError" ? `${replaced.failed.message} ` : ""}The file was not written. The save is kept as pending.`,
        ),
      };
    if (!replaced.replaced) {
      yield* writeBlob(replaced.actual);
      const state = yield* recordConflict(loaded, write, sha256(replaced.actual), meta);
      return {
        state,
        outcome: "conflict" as const,
        file: fileContent(write.documentId, write.path, replaced.actual, null),
      };
    }
    const state = yield* finalizeWrite(loaded, write, meta);
    return {
      state,
      outcome: "saved" as const,
      file: fileContent(write.documentId, write.path, bytes, null),
    };
  });

  const writeDocument = Effect.fn("QuestStore.writeDocument")(function* (
    input: QuestWriteDocumentInput,
    actor: QuestActor,
  ) {
    const loaded = yield* load();
    const target = fileFor(loaded.state, input.documentId);
    if (!target) return yield* invalid("That document is not registered in this Quest.");
    const meta = writeMeta(input.operationId, "document-write", actor);
    // A retry reports what became of the save it started, including a later recovery or discard.
    const startedWrite = loaded.archive?.records
      .filter((record) =>
        [
          input.operationId,
          `${input.operationId}:intent`,
          `${input.operationId}:conflict`,
        ].includes(record.operationId ?? ""),
      )
      .flatMap((record) => record.changes)
      .find((change) => change.collection === "pendingWrites")?.id;
    if (startedWrite !== undefined) return yield* writeOutcome(loaded, startedWrite);
    if (loaded.state.pendingWrites.some((item) => item.documentId === input.documentId))
      return yield* invalid(
        "An earlier save of this document is unresolved. Recover or discard it first.",
      );
    const observed = yield* readFileBytes(target.root, target.file.path);
    const proposed = new TextEncoder().encode(input.content);
    const desiredSha = yield* writeBlob(proposed);
    yield* writeBlob(observed.bytes);
    const write: QuestPendingWrite = {
      id: `write-${NodeCrypto.randomUUID()}`,
      documentId: input.documentId,
      path: target.file.path,
      expectedSha256: input.expectedSha256,
      desiredSha256: desiredSha,
      actualSha256: null,
      status: "pending",
      createdAt: yield* now,
      detail: "Saving.",
      target: { root: target.root, real: observed.real },
    };
    if (observed.sha !== input.expectedSha256) {
      const state = yield* recordConflict(
        loaded,
        { ...write, expectedSha256: input.expectedSha256 },
        observed.sha,
        meta,
      );
      return {
        state,
        outcome: "conflict" as const,
        file: fileContent(input.documentId, target.file.path, observed.bytes, null),
      };
    }
    if (desiredSha === observed.sha)
      return {
        state: loaded.state,
        outcome: "saved" as const,
        file: fileContent(input.documentId, target.file.path, observed.bytes, null),
      };
    const intent = yield* commit(
      loaded,
      { ...loaded.state, pendingWrites: [...loaded.state.pendingWrites, write] },
      {
        kind: "file",
        targetId: input.documentId,
        summary: `Started saving ${target.file.path}`,
        changes: [{ label: "Content SHA-256", before: write.expectedSha256, after: desiredSha }],
      },
      writeMeta(`${input.operationId}:intent`, "document-write-intent", actor),
    );
    const afterIntent = yield* load();
    if (afterIntent.state.revision !== intent.revision)
      return yield* storageError("The Quest changed during a save.");
    return yield* completeWrite(afterIntent, write, proposed, meta);
  }, mutex.withPermits(1));

  const recoverWrite = Effect.fn("QuestStore.recoverWrite")(function* (
    input: QuestRecoverWriteInput,
    actor: QuestActor,
  ) {
    const loaded = yield* load();
    const write = loaded.state.pendingWrites.find((item) => item.id === input.writeId);
    if (!write) return yield* writeOutcome(loaded, input.writeId);
    const meta = writeMeta(input.operationId, "document-write-recover", actor);
    const actual = yield* readBound(loaded.state, write);
    if (actual.sha === write.desiredSha256) {
      const state = yield* finalizeWrite(loaded, write, meta);
      return {
        state,
        outcome: "saved" as const,
        file: fileContent(write.documentId, write.path, actual.bytes, null),
      };
    }
    if (actual.sha === write.expectedSha256 && write.status === "pending") {
      const proposed = yield* retained(write.desiredSha256);
      if (proposed.content === null)
        return yield* invalid("The proposed version is no longer retained.");
      return yield* completeWrite(loaded, write, new TextEncoder().encode(proposed.content), meta);
    }
    yield* writeBlob(actual.bytes);
    if (write.status === "conflict" && write.actualSha256 === actual.sha)
      return {
        state: loaded.state,
        outcome: "conflict" as const,
        file: fileContent(write.documentId, write.path, actual.bytes, null),
      };
    const state = yield* recordConflict(loaded, write, actual.sha, meta);
    return {
      state,
      outcome: "conflict" as const,
      file: fileContent(write.documentId, write.path, actual.bytes, null),
    };
  }, mutex.withPermits(1));

  const membership = Effect.gen(function* () {
    const { state } = yield* load();
    return {
      questId: QUEST_ID,
      title: QUEST_TITLE,
      revision: state.revision,
      members: state.conversations.map((item) => ({
        threadId: item.threadId,
        role: item.role,
        title: item.title,
      })),
    } satisfies QuestMembership;
  }).pipe(Effect.withSpan("QuestStore.membership"));

  const threadLink = Effect.fn("QuestStore.threadLink")(function* (threadId: string) {
    const { state } = yield* load();
    const conversation = state.conversations.find((item) => item.threadId === threadId);
    if (!conversation) return null;
    return {
      threadId,
      workId: conversation.workId,
      questionId: conversation.questionId,
      about:
        state.work.find((item) => item.id === conversation.workId)?.title ??
        state.questions.find((item) => item.id === conversation.questionId)?.title ??
        null,
      role: conversation.role,
      purpose: conversation.purpose,
    };
  });

  const reconstruct = Effect.fn("QuestStore.reconstruct")(function* (revision: number) {
    const loaded = yield* load();
    const archive = loaded.archive;
    if (
      archive === null ||
      revision < archive.baseline.revision ||
      revision > loaded.state.revision
    )
      return yield* new QuestError({
        reason: "unavailable",
        detail:
          archive === null
            ? `Structured history starts with the next saved change; only revision ${loaded.state.revision} is available.`
            : `Revisions before ${archive.baseline.revision} cannot be reconstructed. ${archive.baseline.limit}`,
      });
    const records = archive.records.filter((record) => record.revision <= revision);
    return {
      revision,
      baselineRevision: archive.baseline.revision,
      limit: archive.baseline.limit,
      domain: records.reduce(replayQuestRecord, archive.baseline.domain),
      records,
    } satisfies QuestReconstruction;
  });

  return QuestStore.of({
    get: load().pipe(Effect.map((loaded) => loaded.state)),
    membership,
    threadLink,
    reconstruct,
    update,
    reserveConversation,
    finalizeConversation,
    readDocument,
    retained,
    workspaceFiles,
    writeDocument,
    recoverWrite,
  });
});

export const layer = Layer.effect(QuestStore, make);

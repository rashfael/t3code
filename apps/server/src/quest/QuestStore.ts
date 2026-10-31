import {
  QuestError,
  QuestState,
  questAppliedUnderstanding,
  type QuestHistoryEntry,
  type QuestUpdateInput,
  type QuestWork,
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
import { migrateQuestV1, QuestStateV1 } from "./questMigration.ts";
import { questSeedV1 } from "./questSeed.ts";

export class QuestStore extends Context.Service<
  QuestStore,
  {
    readonly get: Effect.Effect<QuestState, QuestError>;
    readonly update: (input: QuestUpdateInput) => Effect.Effect<QuestState, QuestError>;
  }
>()("t3/quest/QuestStore") {}

const encodeState = Schema.encodeEffect(Schema.fromJsonString(QuestState));
const decodeJson = Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown));
const decodeState = Schema.decodeUnknownEffect(QuestState);
const decodeV1 = Schema.decodeUnknownEffect(QuestStateV1);

type Entry = Omit<QuestHistoryEntry, "id" | "revision" | "at">;
type Change = QuestUpdateInput["change"];

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

function changeState(
  current: QuestState,
  change: Change,
  at: string,
): { readonly state: QuestState; readonly entry: Entry | null } | null {
  const question =
    "questionId" in change && change.questionId !== null
      ? current.questions.find((item) => item.id === change.questionId)
      : undefined;
  switch (change.type) {
    case "work": {
      const work = change.work;
      const existing = current.work.find((item) => item.id === work.id);
      if (
        !existing ||
        work.kind !== existing.kind ||
        !work.title.trim() ||
        work.documentIds.some((id) => !current.documents.some((doc) => doc.id === id)) ||
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
      return {
        state: {
          ...current,
          questions: current.questions.map((item) =>
            item.id === question.id
              ? { ...item, answer, rationale, deferred: change.deferred }
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
            item.id === question.id ? { ...item, applied: true } : item,
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
      return {
        state: {
          ...current,
          conversations: [
            ...current.conversations,
            {
              threadId: change.threadId,
              projectId: change.projectId,
              title: change.title,
              workId: change.workId,
              questionId: change.questionId,
              linkedAt: at,
            },
          ],
        },
        entry: {
          kind: "link",
          targetId: change.threadId,
          summary: `Linked conversation “${change.title}”${about ? ` about “${about}”` : ""}`,
          changes: [],
        },
      };
    }
    case "unlink": {
      const existing = current.conversations.find((item) => item.threadId === change.threadId);
      if (!existing) return null;
      return {
        state: {
          ...current,
          conversations: current.conversations.filter((item) => item !== existing),
        },
        entry: {
          kind: "unlink",
          targetId: change.threadId,
          summary: `Removed conversation “${existing.title}” from the Quest. The thread itself is unchanged.`,
          changes: [],
        },
      };
    }
  }
}

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const mutex = yield* Semaphore.make(1);
  const directory = path.join(config.stateDir, "quest-prototype");
  const statePath = path.join(directory, "state.json");
  const pendingPath = path.join(directory, "state.pending.json");
  const v1BackupPath = path.join(directory, "state.v1.json");
  const storageError = (cause: unknown) => new QuestError({ reason: "storage", cause });
  const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));

  const persist = Effect.fn("QuestStore.persist")(function* (state: QuestState) {
    yield* fs.makeDirectory(directory, { recursive: true });
    const encoded = yield* encodeState(state);
    yield* fs.writeFileString(pendingPath, encoded);
    yield* fs.rename(pendingPath, statePath);
  }, Effect.mapError(storageError));

  const read = Effect.fn("QuestStore.read")(function* () {
    const exists = yield* fs.exists(statePath).pipe(Effect.mapError(storageError));
    if (!exists) {
      const seed = migrateQuestV1(questSeedV1, { at: yield* now, fresh: true });
      yield* persist(seed);
      return seed;
    }
    const encoded = yield* fs.readFileString(statePath).pipe(Effect.mapError(storageError));
    const raw = yield* decodeJson(encoded).pipe(Effect.mapError(storageError));
    if (typeof raw === "object" && raw !== null && "schemaVersion" in raw)
      return yield* decodeState(raw).pipe(Effect.mapError(storageError));
    const v1 = yield* decodeV1(raw).pipe(Effect.mapError(storageError));
    // Keep the first-prototype file byte for byte before replacing it with the upgraded shape.
    if (!(yield* fs.exists(v1BackupPath).pipe(Effect.mapError(storageError))))
      yield* fs.writeFileString(v1BackupPath, encoded).pipe(Effect.mapError(storageError));
    const upgraded = migrateQuestV1(v1, { at: yield* now, fresh: false });
    yield* persist(upgraded);
    return upgraded;
  });

  const update = Effect.fn("QuestStore.update")(function* (input: QuestUpdateInput) {
    const current = yield* read();
    if (input.expectedRevision !== current.revision)
      return yield* new QuestError({ reason: "conflict" });
    const at = yield* now;
    const changed = changeState(current, input.change, at);
    if (!changed) return yield* new QuestError({ reason: "invalid" });
    if (changed.entry === null) return current;
    const revision = current.revision + 1;
    const next: QuestState = {
      ...changed.state,
      revision,
      history: [...current.history, { ...changed.entry, id: `r${revision}`, revision, at }],
    };
    yield* persist(next);
    return next;
  }, mutex.withPermits(1));

  return QuestStore.of({ get: mutex.withPermits(1)(read()), update });
});

export const layer = Layer.effect(QuestStore, make);

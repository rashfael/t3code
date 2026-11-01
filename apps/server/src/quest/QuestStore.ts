// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";

import {
  QUEST_DEFAULT_ID,
  QuestBaseline,
  QuestError,
  QuestPendingWrite,
  QuestRevisionRecord,
  QuestState,
  isQuestFocus,
  questAppliedUnderstanding,
  type ModelSelection,
  type QuestActor,
  type QuestCatalog,
  type QuestCreateInput,
  type QuestContribution,
  type QuestConversation,
  type QuestFileContent,
  type QuestHistoryEntry,
  type QuestMembership,
  type QuestOpenConversationInput,
  type QuestPlanEdit,
  type QuestPlanProposal,
  type QuestProvenance,
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
import {
  questFollowsId,
  questPlanEditChecks,
  questPlanEditSummary,
  questPlanWorkBase,
} from "@t3tools/shared/questPlan";
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
import {
  LEGACY_QUEST,
  questContextPacket,
  questSourceIds,
  type QuestIdentity,
} from "./questContext.ts";
import {
  normalizeQuestFilePath,
  requireQuestRoot,
  resolveQuestFile,
  sha256,
  validateQuestWorkspace,
} from "./questFiles.ts";
import { migrateQuestV1, migrateQuestV2, QuestStateV1, QuestStateV2 } from "./questMigration.ts";
import { questSeedV1 } from "./questSeed.ts";

/** What an agent may add without the owner: a result or a plan proposal, never a decision. */
export interface QuestContributeInput {
  readonly operationId?: string;
  readonly source: QuestResultSource;
  readonly change: Extract<
    QuestUpdateInput["change"],
    { readonly type: "contribution-record" | "plan-propose" }
  >;
}

export interface QuestReservation {
  readonly state: QuestState;
  readonly conversation: QuestConversation;
  readonly created: boolean;
}

/** Whether the caller holds the environment's filesystem read grant; pins never read files without it. */
export interface QuestFileAccess {
  readonly readFiles: boolean;
}

/** One Quest's records. Every method reads and writes only that Quest. */
export interface QuestRecord {
  readonly identity: QuestIdentity;
  /** Read-only: never creates, migrates or finalizes anything on disk. */
  readonly get: Effect.Effect<QuestState, QuestError>;
  readonly membership: Effect.Effect<QuestMembership, QuestError>;
  readonly threadLink: (threadId: string) => Effect.Effect<QuestThreadLink | null, QuestError>;
  readonly reconstruct: (revision: number) => Effect.Effect<QuestReconstruction, QuestError>;
  readonly update: (
    input: QuestUpdateInput,
    actor: QuestActor,
  ) => Effect.Effect<QuestState, QuestError>;
  /** Returns the new record's id, or the earlier one when the operation was already saved. */
  readonly contribute: (
    input: QuestContributeInput,
    actor: QuestActor,
  ) => Effect.Effect<{ readonly state: QuestState; readonly id: string | null }, QuestError>;
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

export class QuestStore extends Context.Service<
  QuestStore,
  {
    /** Every Quest on this environment with its members. */
    readonly catalog: Effect.Effect<QuestCatalog, QuestError>;
    /** The named Quest; an unknown id fails and never resolves to another Quest. */
    readonly quest: (questId: string) => Effect.Effect<QuestRecord, QuestError>;
    /** Creates an empty Quest. Repeating it with the same title returns the existing one. */
    readonly create: (input: QuestCreateInput) => Effect.Effect<QuestState, QuestError>;
    readonly threadLink: (threadId: string) => Effect.Effect<QuestThreadLink | null, QuestError>;
    /** The Quest a thread is a member of, or null; fails if records name it in several. */
    readonly memberQuest: (threadId: string) => Effect.Effect<QuestRecord | null, QuestError>;
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
  ["focus", "Planned focus"],
] as const satisfies ReadonlyArray<readonly [keyof QuestWork, string]>;

function fieldText(value: QuestWork[keyof QuestWork]): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return `${value} of 5`;
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

const WORK_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Observed only when an agent's own thread is the source; anything a client supplies is reported. */
function provenanceOf(actor: QuestActor, source: QuestResultSource | null): QuestProvenance {
  return actor.kind === "agent" && source !== null && actor.id === source.threadId
    ? "observed"
    : "reported";
}

function nextRecordId(prefix: string, existing: ReadonlyArray<{ readonly id: string }>): string {
  let index = existing.length + 1;
  while (existing.some((item) => item.id === `${prefix}-${index}`)) index += 1;
  return `${prefix}-${index}`;
}

type Changed = { readonly state: QuestState; readonly entry: Entry | null };
type Refused = { readonly refused: string };

/** Fills each proposed edit with the exact values it replaces, or says why it cannot be proposed. */
function proposeEdits(
  current: QuestState,
  drafts: Extract<Change, { type: "plan-propose" }>["proposal"]["edits"],
): ReadonlyArray<QuestPlanEdit> | Refused {
  const added = new Set<string>();
  const exists = (id: string) => added.has(id) || current.work.some((item) => item.id === id);
  const edits: Array<QuestPlanEdit> = [];
  for (const [index, draft] of drafts.entries()) {
    const id = `edit-${index + 1}`;
    const refuse = (detail: string) => ({ refused: `Change ${index + 1}: ${detail}` });
    switch (draft.type) {
      case "add-work": {
        const work = draft.work;
        if (!WORK_ID.test(work.id))
          return refuse("new work ids use lowercase letters, digits and dashes.");
        if (exists(work.id)) return refuse(`work “${work.id}” already exists.`);
        if (!work.title.trim()) return refuse("new work needs a title.");
        if (work.focus !== null && !isQuestFocus(work.focus))
          return refuse("planned focus is 1 to 5.");
        if (work.parentId !== null && !exists(work.parentId))
          return refuse(`parent “${work.parentId}” is not in the plan.`);
        added.add(work.id);
        edits.push({ id, type: "add-work", work: { ...work, title: work.title.trim() } });
        break;
      }
      case "change-work": {
        const work = current.work.find((item) => item.id === draft.workId);
        if (!work) return refuse(`work “${draft.workId}” is not in the Quest.`);
        const after = draft.after;
        if (after.title !== undefined && !after.title.trim()) return refuse("titles are required.");
        if (after.focus !== undefined && after.focus !== null && !isQuestFocus(after.focus))
          return refuse("planned focus is 1 to 5.");
        if (after.parentId !== undefined && after.parentId !== null) {
          if (after.parentId === work.id || !exists(after.parentId))
            return refuse(`parent “${after.parentId}” is not valid here.`);
        }
        const before = questPlanWorkBase(work, after);
        if (Object.keys(before).length === 0 || JSON.stringify(before) === JSON.stringify(after))
          return refuse(`nothing would change on “${work.title}”.`);
        edits.push({ id, type: "change-work", workId: work.id, before, after });
        break;
      }
      case "add-follows": {
        if (draft.from === draft.to || !exists(draft.from) || !exists(draft.to))
          return refuse("both ends of a dependency must be different work in the plan.");
        if (current.relations.some((item) => item.id === questFollowsId(draft.from, draft.to)))
          return refuse("that dependency already exists.");
        edits.push({ id, type: "add-follows", from: draft.from, to: draft.to });
        break;
      }
      case "remove-relation": {
        const relation = current.relations.find((item) => item.id === draft.relationId);
        if (!relation) return refuse(`relation “${draft.relationId}” is not in the Quest.`);
        edits.push({ id, type: "remove-relation", relationId: relation.id, before: relation });
        break;
      }
      case "set-current": {
        if (!exists(draft.workId)) return refuse(`work “${draft.workId}” is not in the plan.`);
        edits.push({
          id,
          type: "set-current",
          workId: draft.workId,
          before: current.currentWorkId,
        });
        break;
      }
      case "associate-conversation": {
        const conversation = current.conversations.find((item) => item.threadId === draft.threadId);
        if (!conversation) return refuse("that discussion is not in the Quest.");
        if (draft.workId !== null && !exists(draft.workId))
          return refuse(`work “${draft.workId}” is not in the plan.`);
        edits.push({
          id,
          type: "associate-conversation",
          threadId: draft.threadId,
          workId: draft.workId,
          before: conversation.workId,
        });
        break;
      }
    }
  }
  return edits;
}

/** Applies checked edits in proposal order. Business validation already ran. */
function applyEdits(
  state: QuestState,
  proposal: QuestPlanProposal,
  edits: ReadonlyArray<QuestPlanEdit>,
): QuestState {
  const work = [...state.work];
  const relations = [...state.relations];
  const conversations = [...state.conversations];
  let currentWorkId = state.currentWorkId;
  for (const edit of edits) {
    switch (edit.type) {
      case "add-work": {
        const { focus, ...added } = edit.work;
        work.push({
          ...added,
          kind: "work",
          owner: "",
          agent: "",
          documentIds: [],
          priorAttempts: "",
          findings: "",
          handoff: "",
          ...(focus === null ? {} : { focus }),
        });
        break;
      }
      case "change-work": {
        const index = work.findIndex((item) => item.id === edit.workId);
        const { focus, ...patch } = edit.after;
        const { focus: previous, ...rest } = { ...work[index]!, ...patch };
        const next = focus === undefined ? previous : focus;
        work[index] = next === null || next === undefined ? rest : { ...rest, focus: next };
        break;
      }
      case "add-follows": {
        const id = questFollowsId(edit.from, edit.to);
        if (relations.some((item) => item.id === id)) break;
        relations.push({
          id,
          type: "follows",
          from: edit.from,
          to: edit.to,
          provenance: "plan",
          documentId: null,
          excerpt: `${proposal.id} · ${proposal.title}`,
        });
        break;
      }
      case "remove-relation": {
        const index = relations.findIndex((item) => item.id === edit.relationId);
        if (index >= 0) relations.splice(index, 1);
        break;
      }
      case "set-current":
        currentWorkId = edit.workId;
        break;
      case "associate-conversation": {
        const index = conversations.findIndex((item) => item.threadId === edit.threadId);
        conversations[index] = { ...conversations[index]!, workId: edit.workId };
        break;
      }
    }
  }
  return { ...state, work, relations, conversations, currentWorkId };
}

function contributionChange(
  current: QuestState,
  change: Extract<Change, { type: "contribution-record" }>,
  at: string,
  source: QuestResultSource | null,
  actor: QuestActor,
): Changed | Refused | null {
  const draft = change.contribution;
  if (!draft.title.trim() || !draft.summary.trim()) return null;
  const missing = draft.affectedWorkIds.filter(
    (id) => !current.work.some((item) => item.id === id),
  );
  if (missing.length > 0) return { refused: `Unknown affected work: ${missing.join(", ")}.` };
  const replaced = draft.supersedes
    ? current.contributions.find((item) => item.id === draft.supersedes)
    : undefined;
  if (draft.supersedes !== null) {
    if (!replaced || replaced.disposition === "superseded")
      return { refused: `Result “${draft.supersedes}” cannot be superseded.` };
    if (replaced.source?.threadId !== source?.threadId)
      return { refused: "Only the discussion that recorded a result can supersede it." };
  }
  const conversation = current.conversations.find((item) => item.threadId === source?.threadId);
  const revision = current.revision + 1;
  const created: QuestContribution = {
    title: draft.title.trim(),
    summary: draft.summary,
    candidate: draft.candidate,
    evidence: draft.evidence,
    limitations: draft.limitations,
    openQuestions: draft.openQuestions,
    affectedWorkIds: draft.affectedWorkIds,
    supersedes: draft.supersedes,
    contextRevision: draft.contextRevision,
    id: nextRecordId("result", current.contributions),
    workId: conversation?.workId ?? null,
    source,
    provenance: provenanceOf(actor, source),
    sources: conversation?.sources ?? [],
    recordedAt: at,
    recordedRevision: revision,
    disposition: "open",
    dispositionBy: null,
  };
  const title = (id: string) => current.work.find((item) => item.id === id)?.title ?? id;
  return {
    state: {
      ...current,
      contributions: [
        ...current.contributions.map((item) =>
          item === replaced
            ? {
                ...item,
                disposition: "superseded" as const,
                dispositionBy: { proposalId: null, contributionId: created.id, revision, note: "" },
              }
            : item,
        ),
        created,
      ],
    },
    entry: {
      kind: "contribution",
      targetId: created.id,
      summary: `Recorded the result “${created.title}”${conversation ? ` from “${conversation.purpose || conversation.title}”` : ""}`,
      changes: [
        { label: "Result", before: replaced?.summary ?? null, after: created.summary },
        {
          label: "Affects",
          before: null,
          after: created.affectedWorkIds.map(title).join(", ") || null,
        },
        { label: "Limitations", before: null, after: created.limitations || null },
      ].filter((item) => item.after !== null),
    },
  };
}

function proposalChange(
  current: QuestState,
  change: Extract<Change, { type: "plan-propose" }>,
  at: string,
  source: QuestResultSource | null,
  actor: QuestActor,
): Changed | Refused | null {
  const draft = change.proposal;
  if (!draft.title.trim() || draft.edits.length === 0) return null;
  const unknown = draft.contributionIds.filter(
    (id) => !current.contributions.some((item) => item.id === id),
  );
  if (unknown.length > 0) return { refused: `Unknown results: ${unknown.join(", ")}.` };
  const replaced = draft.supersedes
    ? current.proposals.find((item) => item.id === draft.supersedes)
    : undefined;
  if (
    draft.supersedes !== null &&
    (!replaced || !["proposed", "deferred"].includes(replaced.status))
  )
    return { refused: `Proposal “${draft.supersedes}” is not open, so it cannot be superseded.` };
  const edits = proposeEdits(current, draft.edits);
  if ("refused" in edits) return edits;
  const revision = current.revision + 1;
  const proposal: QuestPlanProposal = {
    id: nextRecordId("proposal", current.proposals),
    title: draft.title.trim(),
    rationale: draft.rationale,
    contributionIds: draft.contributionIds,
    supersedes: draft.supersedes,
    edits,
    baseRevision: current.revision,
    source,
    provenance: provenanceOf(actor, source),
    proposedAt: at,
    status: "proposed",
    decisions: [],
  };
  return {
    state: {
      ...current,
      proposals: [
        ...current.proposals.map((item) =>
          item === replaced
            ? {
                ...item,
                status: "superseded" as const,
                decisions: [
                  ...item.decisions,
                  {
                    status: "superseded" as const,
                    at,
                    revision,
                    note: "",
                    selectedEditIds: [],
                    byProposalId: proposal.id,
                  },
                ],
              }
            : item,
        ),
        proposal,
      ],
    },
    entry: {
      kind: "proposal",
      targetId: proposal.id,
      summary: `Proposed the plan change “${proposal.title}” (not applied)`,
      changes: edits.map((edit) => questPlanEditSummary(current, edit)),
    },
  };
}

const DECIDABLE: Record<"apply" | "defer" | "decline" | "reopen", ReadonlyArray<string>> = {
  apply: ["proposed", "deferred"],
  defer: ["proposed"],
  decline: ["proposed", "deferred"],
  reopen: ["deferred", "declined"],
};

function planDecision(
  current: QuestState,
  change: Extract<Change, { type: "plan-decide" }>,
  at: string,
  actor: QuestActor,
): Changed | Refused | null {
  if (actor.kind === "agent")
    return { refused: "Only the Quest owner decides plan proposals. Agents may only propose." };
  const proposal = current.proposals.find((item) => item.id === change.proposalId);
  if (!proposal) return null;
  if (!DECIDABLE[change.decision].includes(proposal.status))
    return { refused: `This proposal is ${proposal.status}.` };
  const revision = current.revision + 1;
  const status = (
    { apply: "applied", defer: "deferred", decline: "declined", reopen: "proposed" } as const
  )[change.decision];
  const note = change.note.trim();
  const selected = change.decision === "apply" ? change.selectedEditIds : [];
  const decided: QuestPlanProposal = {
    ...proposal,
    status,
    decisions: [
      ...proposal.decisions,
      { status, at, revision, note, selectedEditIds: selected, byProposalId: null },
    ],
  };
  const withProposal = (state: QuestState) => ({
    ...state,
    proposals: state.proposals.map((item) => (item.id === proposal.id ? decided : item)),
  });
  if (change.decision !== "apply") {
    const lead = { defer: "Deferred", decline: "Declined", reopen: "Reopened" }[change.decision];
    return {
      state: withProposal(current),
      entry: {
        kind: "proposal",
        targetId: proposal.id,
        summary: `${lead} the plan change “${proposal.title}”`,
        changes: note ? [{ label: "Note", before: null, after: note }] : [],
      },
    };
  }
  const chosen = new Set(selected);
  if (chosen.size === 0 || chosen.size !== selected.length)
    return { refused: "Select the changes to apply." };
  if ([...chosen].some((id) => !proposal.edits.some((edit) => edit.id === id))) return null;
  const checks = questPlanEditChecks(current, proposal.edits, chosen);
  const blocked = proposal.edits.filter((edit) => {
    const check = checks.get(edit.id);
    return (
      chosen.has(edit.id) &&
      check !== undefined &&
      (check.status === "stale" || check.status === "invalid")
    );
  });
  if (blocked.length > 0)
    return {
      refused: `Nothing was applied. ${blocked
        .map(
          (edit) => `${questPlanEditSummary(current, edit).label}: ${checks.get(edit.id)?.detail}`,
        )
        .join(" ")}`,
    };
  const applied = proposal.edits.filter((edit) => chosen.has(edit.id));
  const planned = applyEdits(current, proposal, applied);
  for (const edit of applied) {
    if (edit.type !== "change-work" || edit.after.parentId === undefined) continue;
    const work = planned.work.find((item) => item.id === edit.workId);
    if (!work || !validParent(planned, work))
      return { refused: "Nothing was applied. A new parent would make the plan circular." };
  }
  const skipped = proposal.edits.filter((edit) => !chosen.has(edit.id));
  return {
    state: withProposal({
      ...planned,
      contributions: planned.contributions.map((item) =>
        proposal.contributionIds.includes(item.id) &&
        (item.disposition === "open" || item.disposition === "set-aside")
          ? {
              ...item,
              disposition: "incorporated" as const,
              dispositionBy: { proposalId: proposal.id, contributionId: null, revision, note: "" },
            }
          : item,
      ),
    }),
    entry: {
      kind: "plan",
      targetId: proposal.id,
      summary: `Applied the plan change “${proposal.title}” (${applied.length} of ${proposal.edits.length} changes)`,
      changes: [
        ...applied.map((edit) => questPlanEditSummary(current, edit)),
        ...(skipped.length > 0
          ? [
              {
                label: "Not applied",
                before: null,
                after: skipped.map((edit) => questPlanEditSummary(current, edit).label).join("\n"),
              },
            ]
          : []),
        ...(note ? [{ label: "Note", before: null, after: note }] : []),
      ],
    },
  };
}

function changeState(
  current: QuestState,
  change: Change,
  at: string,
  source: QuestResultSource | null,
  actor: QuestActor,
): Changed | Refused | null {
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
        (work.focus !== undefined && !isQuestFocus(work.focus)) ||
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
    case "work-add": {
      const work = change.work;
      if (
        !WORK_ID.test(work.id) ||
        current.work.some((item) => item.id === work.id) ||
        !work.title.trim() ||
        (work.focus !== undefined && !isQuestFocus(work.focus)) ||
        work.documentIds.some((id) => !documentExists(current, id)) ||
        !validParent(current, work)
      )
        return null;
      return {
        state: { ...current, work: [...current.work, { ...work, title: work.title.trim() }] },
        entry: {
          kind: "work",
          targetId: work.id,
          summary: `Added “${work.title.trim()}”`,
          changes: WORK_FIELDS.flatMap(([key, label]) => {
            const after = fieldText(work[key]);
            return after ? [{ label, before: null, after }] : [];
          }),
        },
      };
    }
    case "external-conversation": {
      const reference = change.conversation;
      if (
        !reference.environmentId.trim() ||
        !reference.threadId.trim() ||
        !reference.title.trim() ||
        (reference.workId !== null && !current.work.some((item) => item.id === reference.workId))
      )
        return null;
      const existing = current.externalConversations.find(
        (item) =>
          item.environmentId === reference.environmentId && item.threadId === reference.threadId,
      );
      const next = { ...reference, recordedAt: existing?.recordedAt ?? at };
      if (existing && JSON.stringify(existing) === JSON.stringify(next))
        return { state: current, entry: null };
      return {
        state: {
          ...current,
          externalConversations: existing
            ? current.externalConversations.map((item) => (item === existing ? next : item))
            : [...current.externalConversations, next],
        },
        entry: {
          kind: "reference",
          targetId: reference.threadId,
          summary: `${existing ? "Updated" : "Recorded"} the conversation “${reference.title}” in another environment`,
          changes: [
            {
              label: "Environment",
              before: existing?.environmentId ?? null,
              after: reference.environmentId,
            },
            { label: "Purpose", before: existing?.purpose ?? null, after: reference.purpose },
          ].filter((item) => item.before !== item.after),
        },
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
    case "contribution-record":
      return contributionChange(current, change, at, source, actor);
    case "contribution-dispose": {
      if (actor.kind === "agent") return { refused: "Only the Quest owner sets results aside." };
      const result = current.contributions.find((item) => item.id === change.contributionId);
      if (
        !result ||
        result.disposition === change.disposition ||
        (result.disposition !== "open" && result.disposition !== "set-aside")
      )
        return null;
      const note = change.note.trim();
      return {
        state: {
          ...current,
          contributions: current.contributions.map((item) =>
            item === result
              ? {
                  ...item,
                  disposition: change.disposition,
                  dispositionBy: {
                    proposalId: null,
                    contributionId: null,
                    revision: nextRevision,
                    note,
                  },
                }
              : item,
          ),
        },
        entry: {
          kind: "contribution",
          targetId: result.id,
          summary:
            change.disposition === "set-aside"
              ? `Set aside the result “${result.title}”`
              : `Reopened the result “${result.title}”`,
          changes: note ? [{ label: "Note", before: null, after: note }] : [],
        },
      };
    }
    case "plan-propose":
      return proposalChange(current, change, at, source, actor);
    case "plan-decide":
      return planDecision(current, change, at, actor);
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

interface RecordOptions {
  readonly identity: QuestIdentity;
  readonly directory: string;
  /** Shared by every Quest, so a thread cannot be linked into two Quests at once. */
  readonly mutex: Semaphore.Semaphore;
  /** The title of another Quest that already has this thread as a member. */
  readonly memberElsewhere: (threadId: string) => Effect.Effect<string | null, QuestError>;
}

function makeRecord(
  fs: FileSystem.FileSystem,
  path: Path.Path,
  options: RecordOptions,
): QuestRecord {
  const { identity, directory, mutex } = options;
  const statePath = path.join(directory, "state.json");
  const pendingPath = path.join(directory, "state.pending.json");
  const blobDirectory = path.join(directory, "blobs");
  const storageError = (cause: unknown) => new QuestError({ reason: "storage", cause });
  const invalid = (detail?: string) =>
    new QuestError({ reason: "invalid", ...(detail === undefined ? {} : { detail }) });
  const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));

  const load = Effect.fn("QuestStore.load")(function* () {
    const exists = yield* fs.exists(statePath).pipe(Effect.mapError(storageError));
    // Only the historical Quest starts from its captured example; others are created explicitly.
    if (!exists && !identity.historical)
      return yield* storageError(`The Quest ${identity.id} has no saved state.`);
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
    if (change.type === "link") {
      const other = yield* options.memberElsewhere(change.threadId);
      if (other !== null)
        return yield* invalid(`That thread already belongs to the Quest “${other}”.`);
    }
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

  const applyChange = Effect.fn("QuestStore.applyChange")(function* (
    loaded: Loaded,
    input: Omit<QuestUpdateInput, "expectedRevision">,
    actor: QuestActor,
  ) {
    const change = yield* prepare(loaded.state, input.change);
    const source = input.source ?? null;
    const changed = changeState(loaded.state, change, yield* now, source, actor);
    if (!changed) return yield* invalid();
    if ("refused" in changed) return yield* invalid(changed.refused);
    if (changed.entry === null) return loaded.state;
    return yield* commit(loaded, changed.state, changed.entry, {
      operationId: input.operationId ?? null,
      operation: change.type,
      actor,
      source,
    });
  });

  const update = Effect.fn("QuestStore.update")(function* (
    input: QuestUpdateInput,
    actor: QuestActor,
  ) {
    const loaded = yield* load();
    if (replayed(loaded, input.operationId)) return loaded.state;
    if (input.expectedRevision !== loaded.state.revision)
      return yield* new QuestError({ reason: "conflict" });
    return yield* applyChange(loaded, input, actor);
  }, mutex.withPermits(1));

  /**
   * Adds an agent's result or plan proposal to whatever the Quest holds now. Both only add
   * records and capture their own base, so they need no expected revision; deciding stays with
   * `update`, which the owner's client drives.
   */
  const contribute = Effect.fn("QuestStore.contribute")(function* (
    input: QuestContributeInput,
    actor: QuestActor,
  ) {
    const loaded = yield* load();
    const collection = input.change.type === "plan-propose" ? "proposals" : "contributions";
    const earlier = loaded.archive?.records.find(
      (record) => input.operationId !== undefined && record.operationId === input.operationId,
    );
    if (earlier) {
      const created = earlier.changes.find(
        (item) => item.collection === collection && item.before === null,
      );
      return { state: loaded.state, id: created?.id ?? null };
    }
    const state = yield* applyChange(loaded, input, actor);
    return { state, id: state === loaded.state ? null : (state[collection].at(-1)?.id ?? null) };
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
          ? `${identity.title} · Core`
          : `${identity.title} · ${shape.purpose || about || "Discussion"}`.slice(0, 120),
      workId: input.workId,
      questionId: input.questionId,
      linkedAt: at,
      role: input.role,
      purposeKind: input.role === "core" ? "coordinate" : input.purposeKind,
      purpose: shape.purpose,
      sourceRevision: state.revision,
      sources,
      context: "packet",
      prepared: questContextPacket(state, shape, sources, state.revision, identity),
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
      questId: identity.id,
      title: identity.title,
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
      questId: identity.id,
      questTitle: identity.title,
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

  return {
    identity,
    get: load().pipe(Effect.map((loaded) => loaded.state)),
    membership,
    threadLink,
    reconstruct,
    update,
    contribute,
    reserveConversation,
    finalizeConversation,
    readDocument,
    retained,
    workspaceFiles,
    writeDocument,
    recoverWrite,
  } satisfies QuestRecord;
}

const QuestIdentityFile = Schema.Struct({
  format: Schema.Literal("t3-quest-identity-1"),
  id: Schema.String,
  title: Schema.String,
  createdAt: Schema.String,
});
const decodeIdentityFile = Schema.decodeEffect(Schema.fromJsonString(QuestIdentityFile));
const encodeIdentityFile = Schema.encodeEffect(Schema.fromJsonString(QuestIdentityFile));
const QUEST_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

function emptyQuest(title: string, at: string): QuestState {
  return {
    schemaVersion: 3,
    revision: 0,
    currentWorkId: null,
    work: [],
    relations: [],
    documents: [],
    questions: [],
    conversations: [],
    corePredecessors: [],
    workspace: null,
    files: [],
    pendingWrites: [],
    contributions: [],
    proposals: [],
    externalConversations: [],
    history: [
      {
        id: "r0",
        revision: 0,
        at,
        kind: "baseline",
        targetId: null,
        summary: `Started “${title}” in T3 Code`,
        changes: [],
      },
    ],
  };
}

/**
 * The historical Quest keeps its original files directly in `quest-prototype`; every other Quest
 * has its own folder below `quest-prototype/quests`, with its identity, state and retained blobs.
 */
const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const mutex = yield* Semaphore.make(1);
  const root = path.join(config.stateDir, "quest-prototype");
  const questsDirectory = path.join(root, "quests");
  const storageError = (cause: unknown) => new QuestError({ reason: "storage", cause });
  const records = new Map<string, QuestRecord>();

  const readIdentity = Effect.fn("QuestStore.readIdentity")(function* (questId: string) {
    if (!QUEST_ID.test(questId)) return null;
    const file = path.join(questsDirectory, questId, "quest.json");
    if (!(yield* fs.exists(file).pipe(Effect.mapError(storageError)))) return null;
    const encoded = yield* fs.readFileString(file).pipe(Effect.mapError(storageError));
    const stored = yield* decodeIdentityFile(encoded).pipe(Effect.mapError(storageError));
    if (stored.id !== questId) return yield* storageError(`${file} names another Quest.`);
    return { id: stored.id, title: stored.title, historical: false } satisfies QuestIdentity;
  });

  const identities: Effect.Effect<ReadonlyArray<QuestIdentity>, QuestError> = Effect.gen(
    function* () {
      const exists = yield* fs.exists(questsDirectory).pipe(Effect.mapError(storageError));
      const names = exists
        ? yield* fs.readDirectory(questsDirectory).pipe(Effect.mapError(storageError))
        : [];
      const created = yield* Effect.forEach(names.toSorted(), (name) =>
        readIdentity(name).pipe(Effect.map((identity) => (identity ? [identity] : []))),
      );
      return [LEGACY_QUEST, ...created.flat()];
    },
  );

  const recordFor = (identity: QuestIdentity): QuestRecord => {
    const cached = records.get(identity.id);
    if (cached) return cached;
    const record = makeRecord(fs, path, {
      identity,
      directory: identity.historical ? root : path.join(questsDirectory, identity.id),
      mutex,
      memberElsewhere: Effect.fn("QuestStore.memberElsewhere")(function* (threadId: string) {
        for (const other of yield* identities) {
          if (other.id === identity.id) continue;
          const state = yield* recordFor(other).get;
          if (state.conversations.some((item) => item.threadId === threadId)) return other.title;
        }
        return null;
      }),
    });
    records.set(identity.id, record);
    return record;
  };

  const quest = Effect.fn("QuestStore.quest")(function* (questId: string) {
    if (questId === LEGACY_QUEST.id) return recordFor(LEGACY_QUEST);
    const identity = yield* readIdentity(questId);
    if (identity === null)
      return yield* new QuestError({
        reason: "unavailable",
        detail: `There is no Quest “${questId}” on this environment.`,
      });
    return recordFor(identity);
  });

  const all = Effect.map(identities, (list) => list.map(recordFor));

  const create = Effect.fn("QuestStore.create")(function* (input: QuestCreateInput) {
    const title = input.title.trim();
    if (!QUEST_ID.test(input.questId) || input.questId === QUEST_DEFAULT_ID || !title)
      return yield* new QuestError({
        reason: "invalid",
        detail:
          "A new Quest needs a title and an unused id of lowercase letters, digits and dashes.",
      });
    const existing = yield* readIdentity(input.questId);
    if (existing !== null) {
      if (existing.title !== title)
        return yield* new QuestError({
          reason: "invalid",
          detail: `The Quest “${input.questId}” already exists as “${existing.title}”.`,
        });
      return yield* recordFor(existing).get;
    }
    const directory = path.join(questsDirectory, input.questId);
    const at = DateTime.formatIso(yield* DateTime.now);
    const state = emptyQuest(title, at);
    const encoded = yield* encodeStoreFile({
      format: "t3-quest-store-3",
      state,
      archive: {
        baseline: {
          revision: 0,
          at,
          sourceSha256: null,
          backupFile: null,
          limit:
            "Structured history starts when this Quest was created in T3 Code. Earlier work is recorded only in the Quest's own documents and conversations, not as T3 revisions.",
          domain: questDomain(state),
        },
        records: [],
      },
    }).pipe(Effect.mapError(storageError));
    const identity = yield* encodeIdentityFile({
      format: "t3-quest-identity-1",
      id: input.questId,
      title,
      createdAt: at,
    }).pipe(Effect.mapError(storageError));
    // The identity file is written last: a Quest without one is not listed, and creating it again
    // replaces the unfinished state.
    yield* Effect.gen(function* () {
      yield* fs.makeDirectory(directory, { recursive: true });
      yield* fs.writeFileString(path.join(directory, "state.pending.json"), encoded);
      yield* fs.rename(
        path.join(directory, "state.pending.json"),
        path.join(directory, "state.json"),
      );
      yield* fs.writeFileString(path.join(directory, "quest.pending.json"), identity);
      yield* fs.rename(
        path.join(directory, "quest.pending.json"),
        path.join(directory, "quest.json"),
      );
    }).pipe(Effect.mapError(storageError));
    return state;
  }, mutex.withPermits(1));

  const catalog = Effect.gen(function* () {
    const quests = yield* Effect.forEach(yield* all, (record) => record.membership);
    return { quests } satisfies QuestCatalog;
  }).pipe(Effect.withSpan("QuestStore.catalog"));

  const threadLink = Effect.fn("QuestStore.threadLink")(function* (threadId: string) {
    for (const record of yield* all) {
      const link = yield* record.threadLink(threadId);
      if (link) return link;
    }
    return null;
  });

  const memberQuest = Effect.fn("QuestStore.memberQuest")(function* (threadId: string) {
    const matches: Array<QuestRecord> = [];
    for (const record of yield* all) {
      const state = yield* record.get;
      if (state.conversations.some((item) => item.threadId === threadId)) matches.push(record);
    }
    if (matches.length > 1)
      return yield* new QuestError({
        reason: "invalid",
        detail: `This thread is recorded in several Quests (${matches.map((item) => item.identity.title).join(", ")}). Remove it from all but one.`,
      });
    return matches[0] ?? null;
  });

  return QuestStore.of({ catalog, quest, create, threadLink, memberQuest });
});

export const layer = Layer.effect(QuestStore, make);

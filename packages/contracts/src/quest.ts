import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { ModelSelection } from "./modelSelection.ts";
import { ProviderInteractionMode, RuntimeMode } from "./providerPolicy.ts";

export const QuestWorkState = Schema.Literals([
  "planned",
  "active",
  "attention",
  "review",
  "deferred",
  "done",
]);
export type QuestWorkState = typeof QuestWorkState.Type;

/**
 * What a work record stands for in the plan. `workstream`: a continuing stream of work, never itself
 * an outcome. `milestone`: a significant outcome checkpoint, at any depth. Absent: ordinary work.
 */
export const QuestWorkRole = Schema.Literals(["workstream", "milestone"]);
export type QuestWorkRole = typeof QuestWorkRole.Type;

/**
 * The activity a scope is in, chosen per scope rather than as a global pipeline. It says what done
 * means there; it is neither the work's state nor anyone's acceptance.
 */
export const QuestPhase = Schema.Literals(["exploration", "prototype", "integration", "hardening"]);
export type QuestPhase = typeof QuestPhase.Type;

export const QuestWork = Schema.Struct({
  id: Schema.String,
  parentId: Schema.NullOr(Schema.String),
  /** An attempt is one try at its parent work; its outcome is history, not delivery progress. */
  kind: Schema.Literals(["work", "attempt"]),
  title: Schema.String,
  /** Short display name where space is tight, such as the overview; the title stays the full name. */
  shortTitle: Schema.optionalKey(Schema.String),
  state: QuestWorkState,
  owner: Schema.String,
  agent: Schema.String,
  understanding: Schema.String,
  documentIds: Schema.Array(Schema.String),
  priorAttempts: Schema.String,
  findings: Schema.String,
  handoff: Schema.String,
  /**
   * Relative planned focus from 1 (light) to 5 (main concentration). Absent means not set, which is
   * not zero. It is a plan, not measured effort, agent count, completion or confidence.
   */
  focus: Schema.optionalKey(Schema.Number),
  role: Schema.optionalKey(QuestWorkRole),
  /** Workstreams this work belongs to. Membership groups work; it is not a dependency. */
  workstreamIds: Schema.optionalKey(Schema.Array(Schema.String)),
  phase: Schema.optionalKey(QuestPhase),
});
export type QuestWork = typeof QuestWork.Type;

export const QUEST_FOCUS_LEVELS = [1, 2, 3, 4, 5] as const;

export function isQuestFocus(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 5;
}

export const QUEST_SHORT_TITLE_MAX = 32;

/** A short title is trimmed, not empty and short; it is a display name, not an id or slug. */
export function isQuestShortTitle(value: string): boolean {
  return value === value.trim() && value.length > 0 && value.length <= QUEST_SHORT_TITLE_MAX;
}

/** A non-decomposition link. `follows`: `from` comes after `to`. `retries`: `from` retries `to`. */
export const QuestRelation = Schema.Struct({
  id: Schema.String,
  type: Schema.Literals(["follows", "retries"]),
  from: Schema.String,
  to: Schema.String,
  /** `plan`: added by applying a plan proposal; its excerpt names the proposal. */
  provenance: Schema.Literals(["capture", "example", "plan"]),
  documentId: Schema.NullOr(Schema.String),
  excerpt: Schema.String,
});
export type QuestRelation = typeof QuestRelation.Type;

export const QuestDocument = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  body: Schema.String,
  kind: Schema.Literals(["living", "evidence"]),
  source: Schema.String,
  sha256: Schema.String,
});
export type QuestDocument = typeof QuestDocument.Type;

/** A discussion thread and, when known, the run a result came from. */
export const QuestResultSource = Schema.Struct({
  threadId: Schema.String,
  runId: Schema.NullOr(Schema.String),
});
export type QuestResultSource = typeof QuestResultSource.Type;

export const QuestQuestion = Schema.Struct({
  id: Schema.String,
  workId: Schema.String,
  title: Schema.String,
  context: Schema.String,
  alternatives: Schema.Array(Schema.String),
  answer: Schema.NullOr(Schema.String),
  rationale: Schema.NullOr(Schema.String),
  deferred: Schema.Boolean,
  applied: Schema.Boolean,
  proposal: Schema.Boolean,
  /** The discussion the recorded answer came from, when the owner named one. */
  answerSource: Schema.NullOr(QuestResultSource),
  /** The revision that applied the answer, so its exact edits can be read from history. */
  appliedRevision: Schema.NullOr(Schema.Number),
});
export type QuestQuestion = typeof QuestQuestion.Type;

/** Where a conversation's prepared input came from. A fork carries provider context; a packet is a new discussion. */
export const QuestConversationContext = Schema.Literals(["none", "packet", "fork"]);
export type QuestConversationContext = typeof QuestConversationContext.Type;

/**
 * `core` is the Quest's stable coordination place; `focused` discussions have a purpose and a
 * subject; `linked` threads were attached without either (earlier prototype links).
 */
export const QuestConversationRole = Schema.Literals(["core", "focused", "linked"]);
export type QuestConversationRole = typeof QuestConversationRole.Type;

export const QuestPurposeKind = Schema.Literals([
  "coordinate",
  "discuss-work",
  "decide",
  "intervene",
  "digress",
  "linked",
]);
export type QuestPurposeKind = typeof QuestPurposeKind.Type;

/** Exact bytes a discussion or result used, retained by hash even when the file changes later. */
export const QuestSourcePin = Schema.Struct({
  documentId: Schema.String,
  path: Schema.NullOr(Schema.String),
  sha256: Schema.NullOr(Schema.String),
  capturedAt: Schema.String,
  /** Null when the bytes are retained; otherwise why they could not be. */
  unavailable: Schema.NullOr(Schema.String),
});
export type QuestSourcePin = typeof QuestSourcePin.Type;

/**
 * A server-reserved thread identity. `reserved` survives a crash between the Quest file and the
 * orchestration database; the next ensure resolves it with the same command, never a new thread.
 */
export const QuestThreadCreation = Schema.Struct({
  commandId: Schema.String,
  status: Schema.Literals(["reserved", "ready"]),
  requested: Schema.Struct({
    modelSelection: ModelSelection,
    runtimeMode: RuntimeMode,
    interactionMode: ProviderInteractionMode,
    /** Where the requested selection came from; the effective one is what the thread recorded. */
    provenance: Schema.Literals(["client-default"]),
  }),
  effectiveModelSelection: Schema.NullOr(ModelSelection),
  reservedAt: Schema.String,
  readyAt: Schema.NullOr(Schema.String),
});
export type QuestThreadCreation = typeof QuestThreadCreation.Type;

/** A normal T3 thread in the Quest's environment that belongs to the Quest. */
export const QuestConversation = Schema.Struct({
  threadId: Schema.String,
  projectId: Schema.NullOr(Schema.String),
  title: Schema.String,
  workId: Schema.NullOr(Schema.String),
  questionId: Schema.NullOr(Schema.String),
  linkedAt: Schema.String,
  role: QuestConversationRole,
  purposeKind: QuestPurposeKind,
  purpose: Schema.String,
  /** The Quest revision its prepared context described; null when none was prepared. */
  sourceRevision: Schema.NullOr(Schema.Number),
  sources: Schema.Array(QuestSourcePin),
  context: QuestConversationContext,
  /** The prepared, unsent context. What was sent is the thread's own messages. */
  prepared: Schema.NullOr(Schema.String),
  origin: Schema.NullOr(QuestResultSource),
  creation: Schema.NullOr(QuestThreadCreation),
});
export type QuestConversation = typeof QuestConversation.Type;

/**
 * A conversation that belongs to this Quest's history but lives in another environment. It is
 * provenance only: it is not a member, local agents cannot act as it, and it opens only where that
 * environment is connected.
 */
export const QuestExternalConversation = Schema.Struct({
  environmentId: Schema.String,
  threadId: Schema.String,
  title: Schema.String,
  /** The thread it was forked from, when it is a fork. */
  forkOf: Schema.NullOr(Schema.String),
  workId: Schema.NullOr(Schema.String),
  purpose: Schema.String,
  recordedAt: Schema.String,
});
export type QuestExternalConversation = typeof QuestExternalConversation.Type;

export const QuestCorePredecessor = Schema.Struct({
  conversation: QuestConversation,
  replacedAt: Schema.String,
  reason: Schema.String,
});
export type QuestCorePredecessor = typeof QuestCorePredecessor.Type;

/** A Markdown file in the registered workspace. The file owns its bytes; this is only its identity. */
export const QuestFile = Schema.Struct({
  id: Schema.String,
  path: Schema.String,
  title: Schema.String,
  registeredAt: Schema.String,
});
export type QuestFile = typeof QuestFile.Type;

export const QuestWorkspace = Schema.Struct({
  root: Schema.String,
  registeredAt: Schema.String,
});
export type QuestWorkspace = typeof QuestWorkspace.Type;

/**
 * A T3 file write that has not been finalized. `pending`: the intent is durable and the file may
 * hold either version. `conflict`: the file held neither, so nothing is overwritten automatically.
 */
export const QuestPendingWrite = Schema.Struct({
  id: Schema.String,
  documentId: Schema.String,
  path: Schema.String,
  expectedSha256: Schema.String,
  desiredSha256: Schema.String,
  /** A third version found on disk, retained by hash. */
  actualSha256: Schema.NullOr(Schema.String),
  status: Schema.Literals(["pending", "conflict"]),
  createdAt: Schema.String,
  detail: Schema.String,
  /**
   * Canonical workspace root and file the save observed. Recovery only proceeds while both still
   * resolve the same way; saves recorded before this field existed are never recovered automatically.
   */
  target: Schema.optionalKey(Schema.Struct({ root: Schema.String, real: Schema.String })),
});
export type QuestPendingWrite = typeof QuestPendingWrite.Type;

/**
 * `observed`: the server knew the caller (an agent's own thread and run). `reported`: a client
 * supplied the attribution, which the server cannot confirm.
 */
export const QuestProvenance = Schema.Literals(["observed", "reported"]);
export type QuestProvenance = typeof QuestProvenance.Type;

/** An exact reference a result rests on: a commit, a file at a hash, a thread, a Quest revision. */
export const QuestEvidenceRef = Schema.Struct({
  kind: Schema.Literals(["commit", "file", "document", "thread", "revision", "other"]),
  ref: Schema.String,
  note: Schema.String,
});
export type QuestEvidenceRef = typeof QuestEvidenceRef.Type;

const QuestContributionFields = {
  title: Schema.String,
  /** What was delivered or learned, in the publisher's words. */
  summary: Schema.String,
  /** The candidate or artifact change it rests on, such as a commit range. */
  candidate: Schema.String,
  evidence: Schema.Array(QuestEvidenceRef),
  limitations: Schema.String,
  openQuestions: Schema.String,
  /** Work this result may change, beyond the work it was produced for. */
  affectedWorkIds: Schema.Array(Schema.String),
  /** An earlier result of the same discussion that this one replaces. */
  supersedes: Schema.NullOr(Schema.String),
  /** The Quest revision the publisher was working from, when it said so. */
  contextRevision: Schema.NullOr(Schema.Number),
};

export const QuestContributionDraft = Schema.Struct(QuestContributionFields);
export type QuestContributionDraft = typeof QuestContributionDraft.Type;

/**
 * A scoped result one discussion hands back to the Quest. Recording it changes no plan; a plan
 * proposal that uses it and its explicit application do. Changed inputs make it possibly stale,
 * not invalid.
 */
export const QuestContribution = Schema.Struct({
  id: Schema.String,
  ...QuestContributionFields,
  /** The work the publishing discussion was associated with when it recorded this. */
  workId: Schema.NullOr(Schema.String),
  source: Schema.NullOr(QuestResultSource),
  provenance: QuestProvenance,
  /** The publishing discussion's pinned sources, copied so later file changes stay visible. */
  sources: Schema.Array(QuestSourcePin),
  recordedAt: Schema.String,
  recordedRevision: Schema.Number,
  disposition: Schema.Literals(["open", "incorporated", "superseded", "set-aside"]),
  /** What last changed the disposition: a proposal's application, a successor or the owner. */
  dispositionBy: Schema.NullOr(
    Schema.Struct({
      proposalId: Schema.NullOr(Schema.String),
      contributionId: Schema.NullOr(Schema.String),
      revision: Schema.Number,
      note: Schema.String,
    }),
  ),
});
export type QuestContribution = typeof QuestContribution.Type;

const QuestPlanWorkPatch = Schema.Struct({
  title: Schema.optionalKey(Schema.String),
  shortTitle: Schema.optionalKey(Schema.NullOr(Schema.String)),
  state: Schema.optionalKey(QuestWorkState),
  parentId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  understanding: Schema.optionalKey(Schema.String),
  focus: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  role: Schema.optionalKey(Schema.NullOr(QuestWorkRole)),
  workstreamIds: Schema.optionalKey(Schema.Array(Schema.String)),
  phase: Schema.optionalKey(Schema.NullOr(QuestPhase)),
});
export type QuestPlanWorkPatch = typeof QuestPlanWorkPatch.Type;

const QuestPlanNewWork = Schema.Struct({
  id: Schema.String,
  parentId: Schema.NullOr(Schema.String),
  title: Schema.String,
  shortTitle: Schema.optionalKey(Schema.String),
  state: QuestWorkState,
  understanding: Schema.String,
  focus: Schema.NullOr(Schema.Number),
  role: Schema.optionalKey(QuestWorkRole),
  workstreamIds: Schema.optionalKey(Schema.Array(Schema.String)),
  phase: Schema.optionalKey(QuestPhase),
});

/** A plan edit as proposed. The server adds the base values each edit replaces. */
export const QuestPlanEditDraft = Schema.Union([
  Schema.Struct({ type: Schema.Literal("add-work"), work: QuestPlanNewWork }),
  Schema.Struct({
    type: Schema.Literal("change-work"),
    workId: Schema.String,
    after: QuestPlanWorkPatch,
  }),
  /** `from` comes after `to`. */
  Schema.Struct({ type: Schema.Literal("add-follows"), from: Schema.String, to: Schema.String }),
  Schema.Struct({ type: Schema.Literal("remove-relation"), relationId: Schema.String }),
  Schema.Struct({ type: Schema.Literal("set-current"), workId: Schema.String }),
  /** Moves a discussion's current work association; its fork origin is unchanged. */
  Schema.Struct({
    type: Schema.Literal("associate-conversation"),
    threadId: Schema.String,
    workId: Schema.NullOr(Schema.String),
  }),
]);
export type QuestPlanEditDraft = typeof QuestPlanEditDraft.Type;

/** One proposed edit with the exact values it replaces, so application can refuse a moved base. */
export const QuestPlanEdit = Schema.Union([
  Schema.Struct({ id: Schema.String, type: Schema.Literal("add-work"), work: QuestPlanNewWork }),
  Schema.Struct({
    id: Schema.String,
    type: Schema.Literal("change-work"),
    workId: Schema.String,
    before: QuestPlanWorkPatch,
    after: QuestPlanWorkPatch,
  }),
  Schema.Struct({
    id: Schema.String,
    type: Schema.Literal("add-follows"),
    from: Schema.String,
    to: Schema.String,
  }),
  Schema.Struct({
    id: Schema.String,
    type: Schema.Literal("remove-relation"),
    relationId: Schema.String,
    before: QuestRelation,
  }),
  Schema.Struct({
    id: Schema.String,
    type: Schema.Literal("set-current"),
    workId: Schema.String,
    before: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({
    id: Schema.String,
    type: Schema.Literal("associate-conversation"),
    threadId: Schema.String,
    workId: Schema.NullOr(Schema.String),
    before: Schema.NullOr(Schema.String),
  }),
]);
export type QuestPlanEdit = typeof QuestPlanEdit.Type;

export const QuestPlanProposalDraft = Schema.Struct({
  title: Schema.String,
  rationale: Schema.String,
  contributionIds: Schema.Array(Schema.String),
  /** An earlier open or deferred proposal this one replaces. */
  supersedes: Schema.NullOr(Schema.String),
  edits: Schema.Array(QuestPlanEditDraft),
});
export type QuestPlanProposalDraft = typeof QuestPlanProposalDraft.Type;

export const QuestPlanStatus = Schema.Literals([
  "proposed",
  "deferred",
  "declined",
  "applied",
  "superseded",
]);
export type QuestPlanStatus = typeof QuestPlanStatus.Type;

/**
 * A proposed plan revision. Its content never changes after it is recorded; a revision is a new
 * proposal that supersedes it. `decisions` keeps every owner decision, including what was selected.
 */
export const QuestPlanProposal = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  rationale: Schema.String,
  contributionIds: Schema.Array(Schema.String),
  supersedes: Schema.NullOr(Schema.String),
  edits: Schema.Array(QuestPlanEdit),
  baseRevision: Schema.Number,
  source: Schema.NullOr(QuestResultSource),
  provenance: QuestProvenance,
  proposedAt: Schema.String,
  status: QuestPlanStatus,
  decisions: Schema.Array(
    Schema.Struct({
      status: QuestPlanStatus,
      at: Schema.String,
      revision: Schema.Number,
      note: Schema.String,
      /** Edits the owner chose to apply; empty for every other decision. */
      selectedEditIds: Schema.Array(Schema.String),
      /** Set when a later proposal replaced this one. */
      byProposalId: Schema.NullOr(Schema.String),
    }),
  ),
});
export type QuestPlanProposal = typeof QuestPlanProposal.Type;

/** What the thread route needs to show a linked thread's Quest context, without the whole Quest. */
export const QuestThreadLink = Schema.Struct({
  questId: Schema.String,
  questTitle: Schema.String,
  threadId: Schema.String,
  workId: Schema.NullOr(Schema.String),
  questionId: Schema.NullOr(Schema.String),
  about: Schema.NullOr(Schema.String),
  role: QuestConversationRole,
  purpose: Schema.String,
});
export type QuestThreadLink = typeof QuestThreadLink.Type;

export const QuestThreadLinkInput = Schema.Struct({ threadId: Schema.String });
export type QuestThreadLinkInput = typeof QuestThreadLinkInput.Type;

/** One Quest-owned thread, enough for canonical sidebar placement on any client. */
export const QuestMember = Schema.Struct({
  threadId: Schema.String,
  role: QuestConversationRole,
  title: Schema.String,
});
export type QuestMember = typeof QuestMember.Type;

export const QuestMembership = Schema.Struct({
  questId: Schema.String,
  title: Schema.String,
  revision: Schema.Number,
  members: Schema.Array(QuestMember),
});
export type QuestMembership = typeof QuestMembership.Type;

/** Every Quest on the environment with its member threads. A thread belongs to at most one. */
export const QuestCatalog = Schema.Struct({ quests: Schema.Array(QuestMembership) });
export type QuestCatalog = typeof QuestCatalog.Type;

/** The Quest the environment kept before it held several; plain `/quests` URLs open it. */
export const QUEST_DEFAULT_ID = "market-tracking";

export const QuestId = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,63}$/));

/** Names the Quest a request reads or changes. An unknown id fails; it never selects another. */
export const QuestScope = Schema.Struct({ questId: QuestId });
export type QuestScope = typeof QuestScope.Type;

export const QuestCreateInput = Schema.Struct({
  questId: QuestId,
  title: Schema.String,
});
export type QuestCreateInput = typeof QuestCreateInput.Type;

export const QuestHistoryEntry = Schema.Struct({
  id: Schema.String,
  revision: Schema.Number,
  at: Schema.String,
  kind: Schema.Literals([
    "baseline",
    "work",
    "document",
    "answer",
    "defer",
    "apply",
    "reopen",
    "current",
    "link",
    "unlink",
    "question",
    "conversation",
    "core",
    "workspace",
    "file",
    "contribution",
    "proposal",
    "plan",
    "reference",
  ]),
  targetId: Schema.NullOr(Schema.String),
  summary: Schema.String,
  changes: Schema.Array(
    Schema.Struct({
      label: Schema.String,
      before: Schema.NullOr(Schema.String),
      after: Schema.NullOr(Schema.String),
    }),
  ),
});
export type QuestHistoryEntry = typeof QuestHistoryEntry.Type;

const QuestDomainFields = {
  currentWorkId: Schema.NullOr(Schema.String),
  work: Schema.Array(QuestWork),
  relations: Schema.Array(QuestRelation),
  /** Legacy living notes and frozen evidence kept inside the Quest. */
  documents: Schema.Array(QuestDocument),
  questions: Schema.Array(QuestQuestion),
  conversations: Schema.Array(QuestConversation),
  corePredecessors: Schema.Array(QuestCorePredecessor),
  workspace: Schema.NullOr(QuestWorkspace),
  files: Schema.Array(QuestFile),
  pendingWrites: Schema.Array(QuestPendingWrite),
  contributions: Schema.Array(QuestContribution).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  proposals: Schema.Array(QuestPlanProposal).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  externalConversations: Schema.Array(QuestExternalConversation).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
};
/** The saved meaning of a Quest at one revision, without its prose change log. */
export const QuestDomain = Schema.Struct(QuestDomainFields);
export type QuestDomain = typeof QuestDomain.Type;

export const QuestState = Schema.Struct({
  schemaVersion: Schema.Literal(3),
  revision: Schema.Number,
  ...QuestDomainFields,
  history: Schema.Array(QuestHistoryEntry),
});
export type QuestState = typeof QuestState.Type;

export const QuestActor = Schema.Struct({
  kind: Schema.Literals(["client", "agent", "server", "unknown"]),
  id: Schema.NullOr(Schema.String),
});
export type QuestActor = typeof QuestActor.Type;

/** One saved record before and after a revision; `null` on one side is creation or removal. */
export const QuestRecordChange = Schema.Struct({
  collection: Schema.String,
  id: Schema.String,
  before: Schema.NullOr(Schema.Unknown),
  after: Schema.NullOr(Schema.Unknown),
});
export type QuestRecordChange = typeof QuestRecordChange.Type;

export const QuestRevisionRecord = Schema.Struct({
  revision: Schema.Number,
  at: Schema.String,
  operationId: Schema.NullOr(Schema.String),
  operation: Schema.String,
  actor: QuestActor,
  source: Schema.NullOr(QuestResultSource),
  summary: Schema.String,
  changes: Schema.Array(QuestRecordChange),
  /** Record order per changed collection after the revision, so replay keeps it. */
  order: Schema.Record(Schema.String, Schema.Array(Schema.String)),
});
export type QuestRevisionRecord = typeof QuestRevisionRecord.Type;

export const QuestBaseline = Schema.Struct({
  revision: Schema.Number,
  at: Schema.String,
  /** SHA-256 of the exact saved bytes the baseline was taken from, retained as a backup file. */
  sourceSha256: Schema.NullOr(Schema.String),
  backupFile: Schema.NullOr(Schema.String),
  limit: Schema.String,
  domain: QuestDomain,
});
export type QuestBaseline = typeof QuestBaseline.Type;

export const QuestReconstructionInput = Schema.Struct({ revision: Schema.Number });
export type QuestReconstructionInput = typeof QuestReconstructionInput.Type;

export const QuestReconstruction = Schema.Struct({
  revision: Schema.Number,
  baselineRevision: Schema.Number,
  limit: Schema.String,
  domain: QuestDomain,
  /** Revision records after the baseline up to and including `revision`. */
  records: Schema.Array(QuestRevisionRecord),
});
export type QuestReconstruction = typeof QuestReconstruction.Type;

const QuestQuestionDraft = Schema.Struct({
  workId: Schema.String,
  title: Schema.String,
  context: Schema.String,
  alternatives: Schema.Array(Schema.String),
});

export const QuestUpdateInput = Schema.Struct({
  expectedRevision: Schema.Number,
  /** Repeating an accepted operation returns the saved state instead of applying it twice. */
  operationId: Schema.optionalKey(Schema.String),
  /** The discussion a result came from, when known. */
  source: Schema.optionalKey(QuestResultSource),
  change: Schema.Union([
    Schema.Struct({ type: Schema.Literal("work"), work: QuestWork }),
    /** Adds new work. Planning changes from discussions go through plan proposals instead. */
    Schema.Struct({ type: Schema.Literal("work-add"), work: QuestWork }),
    Schema.Struct({
      type: Schema.Literal("external-conversation"),
      conversation: Schema.Struct({
        environmentId: Schema.String,
        threadId: Schema.String,
        title: Schema.String,
        forkOf: Schema.NullOr(Schema.String),
        workId: Schema.NullOr(Schema.String),
        purpose: Schema.String,
      }),
    }),
    Schema.Struct({ type: Schema.Literal("document"), document: QuestDocument }),
    Schema.Struct({
      type: Schema.Literal("answer"),
      questionId: Schema.String,
      answer: Schema.NullOr(Schema.String),
      rationale: Schema.NullOr(Schema.String),
      deferred: Schema.Boolean,
    }),
    Schema.Struct({ type: Schema.Literal("apply"), questionId: Schema.String }),
    Schema.Struct({ type: Schema.Literal("reopen"), questionId: Schema.String }),
    Schema.Struct({ type: Schema.Literal("current"), workId: Schema.String }),
    Schema.Struct({ type: Schema.Literal("question-create"), question: QuestQuestionDraft }),
    Schema.Struct({
      type: Schema.Literal("question-edit"),
      questionId: Schema.String,
      question: QuestQuestionDraft,
    }),
    /** Attaches an existing thread, such as a fork made in the Quest. */
    Schema.Struct({
      type: Schema.Literal("link"),
      threadId: Schema.String,
      projectId: Schema.NullOr(Schema.String),
      title: Schema.String,
      workId: Schema.NullOr(Schema.String),
      questionId: Schema.NullOr(Schema.String),
      purposeKind: Schema.optionalKey(QuestPurposeKind),
      purpose: Schema.optionalKey(Schema.String),
      context: Schema.optionalKey(QuestConversationContext),
      origin: Schema.optionalKey(QuestResultSource),
    }),
    /** Detaches a discussion; the thread returns to its ordinary placement. The core cannot be detached. */
    Schema.Struct({ type: Schema.Literal("unlink"), threadId: Schema.String }),
    /** Retires the core thread as a predecessor; the next ensure reserves its replacement. */
    Schema.Struct({ type: Schema.Literal("core-replace"), reason: Schema.String }),
    Schema.Struct({ type: Schema.Literal("workspace-register"), root: Schema.String }),
    Schema.Struct({
      type: Schema.Literal("file-register"),
      path: Schema.String,
      title: Schema.String,
    }),
    /** Gives up a pending or conflicting write. Retained versions stay in the history. */
    Schema.Struct({ type: Schema.Literal("write-discard"), writeId: Schema.String }),
    Schema.Struct({
      type: Schema.Literal("contribution-record"),
      contribution: QuestContributionDraft,
    }),
    /** The owner sets a result aside or back to open; incorporation only comes from applying a plan. */
    Schema.Struct({
      type: Schema.Literal("contribution-dispose"),
      contributionId: Schema.String,
      disposition: Schema.Literals(["open", "set-aside"]),
      note: Schema.String,
    }),
    Schema.Struct({ type: Schema.Literal("plan-propose"), proposal: QuestPlanProposalDraft }),
    /** Owner only. `apply` applies exactly `selectedEditIds`; `reopen` returns a deferred or declined proposal. */
    Schema.Struct({
      type: Schema.Literal("plan-decide"),
      proposalId: Schema.String,
      decision: Schema.Literals(["apply", "defer", "decline", "reopen"]),
      selectedEditIds: Schema.Array(Schema.String),
      note: Schema.String,
    }),
  ]),
});
export type QuestUpdateInput = typeof QuestUpdateInput.Type;

export const QuestOpenConversationInput = Schema.Struct({
  operationId: Schema.String,
  role: Schema.Literals(["core", "focused"]),
  purposeKind: QuestPurposeKind,
  purpose: Schema.String,
  workId: Schema.NullOr(Schema.String),
  questionId: Schema.NullOr(Schema.String),
  /** Resume the newest discussion with the same purpose and subject instead of starting another. */
  resume: Schema.Boolean,
  /** Finish creating exactly this reserved conversation; subject matching does not apply. */
  threadId: Schema.optionalKey(Schema.String),
  projectId: Schema.String,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
});
export type QuestOpenConversationInput = typeof QuestOpenConversationInput.Type;

export const QuestOpenConversationResult = Schema.Struct({
  state: QuestState,
  threadId: Schema.String,
  created: Schema.Boolean,
});
export type QuestOpenConversationResult = typeof QuestOpenConversationResult.Type;

export const QuestDocumentInput = Schema.Struct({ documentId: Schema.String });
export type QuestDocumentInput = typeof QuestDocumentInput.Type;

export const QuestFileContent = Schema.Struct({
  documentId: Schema.String,
  path: Schema.String,
  /** Null when the file cannot be read; `unavailable` says why. */
  content: Schema.NullOr(Schema.String),
  sha256: Schema.NullOr(Schema.String),
  unavailable: Schema.NullOr(Schema.String),
});
export type QuestFileContent = typeof QuestFileContent.Type;

export const QuestWriteDocumentInput = Schema.Struct({
  operationId: Schema.String,
  documentId: Schema.String,
  expectedSha256: Schema.String,
  content: Schema.String,
});
export type QuestWriteDocumentInput = typeof QuestWriteDocumentInput.Type;

export const QuestRecoverWriteInput = Schema.Struct({
  operationId: Schema.String,
  writeId: Schema.String,
});
export type QuestRecoverWriteInput = typeof QuestRecoverWriteInput.Type;

export const QuestWriteResult = Schema.Struct({
  state: QuestState,
  /** `saved`: file written and finalized. `pending`: intent kept, finalization still due. `conflict`: nothing overwritten. */
  outcome: Schema.Literals(["saved", "pending", "conflict"]),
  file: QuestFileContent,
});
export type QuestWriteResult = typeof QuestWriteResult.Type;

export const QuestRetainedInput = Schema.Struct({ sha256: Schema.String });
export type QuestRetainedInput = typeof QuestRetainedInput.Type;

export const QuestRetained = Schema.Struct({
  sha256: Schema.String,
  content: Schema.NullOr(Schema.String),
});
export type QuestRetained = typeof QuestRetained.Type;

export const QuestWorkspaceFiles = Schema.Struct({
  root: Schema.NullOr(Schema.String),
  paths: Schema.Array(Schema.String),
  truncated: Schema.Boolean,
});
export type QuestWorkspaceFiles = typeof QuestWorkspaceFiles.Type;

export class QuestError extends Schema.TaggedError<QuestError>()("QuestError", {
  reason: Schema.Literals(["conflict", "invalid", "storage", "unavailable"]),
  detail: Schema.optional(Schema.String),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    switch (this.reason) {
      case "conflict":
        return "This Quest changed elsewhere. Reload it before saving again.";
      case "invalid":
        return this.detail ?? "This change is no longer valid for the current Quest.";
      case "storage":
        return "The Quest could not be read or saved. Your change has not been accepted.";
      case "unavailable":
        return this.detail ?? "That is not available for this Quest.";
    }
  }
}

export type QuestQuestionStatus = "open" | "deferred" | "recorded" | "applied";

export function questQuestionStatus(question: QuestQuestion): QuestQuestionStatus {
  if (question.applied) return "applied";
  if (question.deferred) return "deferred";
  return question.answer?.trim() ? "recorded" : "open";
}

/** The understanding a work record gets when a recorded answer is applied; the server and the preview share it. */
export function questAppliedUnderstanding(work: QuestWork, question: QuestQuestion): string {
  const rationale = question.rationale?.trim() ? `\nRationale: ${question.rationale.trim()}` : "";
  return `${work.understanding}\n\nApplied answer (${question.id}): ${question.answer ?? ""}${rationale}`;
}

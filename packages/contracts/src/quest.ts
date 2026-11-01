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

export const QuestWork = Schema.Struct({
  id: Schema.String,
  parentId: Schema.NullOr(Schema.String),
  /** An attempt is one try at its parent work; its outcome is history, not delivery progress. */
  kind: Schema.Literals(["work", "attempt"]),
  title: Schema.String,
  state: QuestWorkState,
  owner: Schema.String,
  agent: Schema.String,
  understanding: Schema.String,
  documentIds: Schema.Array(Schema.String),
  priorAttempts: Schema.String,
  findings: Schema.String,
  handoff: Schema.String,
});
export type QuestWork = typeof QuestWork.Type;

/** A non-decomposition link. `follows`: `from` comes after `to`. `retries`: `from` retries `to`. */
export const QuestRelation = Schema.Struct({
  id: Schema.String,
  type: Schema.Literals(["follows", "retries"]),
  from: Schema.String,
  to: Schema.String,
  provenance: Schema.Literals(["capture", "example"]),
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
});
export type QuestPendingWrite = typeof QuestPendingWrite.Type;

/** What the thread route needs to show a linked thread's Quest context, without the whole Quest. */
export const QuestThreadLink = Schema.Struct({
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

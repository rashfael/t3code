import * as Schema from "effect/Schema";

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
});
export type QuestQuestion = typeof QuestQuestion.Type;

/** A normal T3 thread in the Quest's environment, linked for discussion. */
export const QuestConversation = Schema.Struct({
  threadId: Schema.String,
  projectId: Schema.NullOr(Schema.String),
  title: Schema.String,
  workId: Schema.NullOr(Schema.String),
  questionId: Schema.NullOr(Schema.String),
  linkedAt: Schema.String,
});
export type QuestConversation = typeof QuestConversation.Type;

/** What the thread route needs to show a linked thread's Quest context, without the whole Quest. */
export const QuestThreadLink = Schema.Struct({
  threadId: Schema.String,
  workId: Schema.NullOr(Schema.String),
  questionId: Schema.NullOr(Schema.String),
  about: Schema.NullOr(Schema.String),
});
export type QuestThreadLink = typeof QuestThreadLink.Type;

export const QuestThreadLinkInput = Schema.Struct({ threadId: Schema.String });
export type QuestThreadLinkInput = typeof QuestThreadLinkInput.Type;

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

export const QuestState = Schema.Struct({
  schemaVersion: Schema.Literal(2),
  revision: Schema.Number,
  currentWorkId: Schema.NullOr(Schema.String),
  work: Schema.Array(QuestWork),
  relations: Schema.Array(QuestRelation),
  documents: Schema.Array(QuestDocument),
  questions: Schema.Array(QuestQuestion),
  conversations: Schema.Array(QuestConversation),
  history: Schema.Array(QuestHistoryEntry),
});
export type QuestState = typeof QuestState.Type;

export const QuestUpdateInput = Schema.Struct({
  expectedRevision: Schema.Number,
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
    Schema.Struct({
      type: Schema.Literal("link"),
      threadId: Schema.String,
      projectId: Schema.NullOr(Schema.String),
      title: Schema.String,
      workId: Schema.NullOr(Schema.String),
      questionId: Schema.NullOr(Schema.String),
    }),
    Schema.Struct({ type: Schema.Literal("unlink"), threadId: Schema.String }),
  ]),
});
export type QuestUpdateInput = typeof QuestUpdateInput.Type;

export class QuestError extends Schema.TaggedError<QuestError>()("QuestError", {
  reason: Schema.Literals(["conflict", "invalid", "storage"]),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    switch (this.reason) {
      case "conflict":
        return "This Quest changed elsewhere. Reload it before saving again.";
      case "invalid":
        return "This change is no longer valid for the current Quest.";
      case "storage":
        return "The Quest could not be read or saved. Your change has not been accepted.";
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

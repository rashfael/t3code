import * as Schema from "effect/Schema";

export const QuestWork = Schema.Struct({
  id: Schema.String,
  parentId: Schema.NullOr(Schema.String),
  title: Schema.String,
  state: Schema.Literals(["active", "attention", "review", "deferred", "done"]),
  owner: Schema.String,
  agent: Schema.String,
  understanding: Schema.String,
  documentIds: Schema.Array(Schema.String),
  priorAttempts: Schema.String,
  findings: Schema.String,
  handoff: Schema.String,
});
export type QuestWork = typeof QuestWork.Type;

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
  deferred: Schema.Boolean,
  applied: Schema.Boolean,
  proposal: Schema.Boolean,
});
export type QuestQuestion = typeof QuestQuestion.Type;

export const QuestState = Schema.Struct({
  revision: Schema.Number,
  work: Schema.Array(QuestWork),
  documents: Schema.Array(QuestDocument),
  questions: Schema.Array(QuestQuestion),
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
      deferred: Schema.Boolean,
    }),
    Schema.Struct({ type: Schema.Literal("apply"), questionId: Schema.String }),
    Schema.Struct({ type: Schema.Literal("reopen"), questionId: Schema.String }),
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

import {
  OrchestratorMcpEnvironmentTarget,
  OrchestratorMcpFailure,
  QuestEvidenceRef,
  QuestPlanEditDraft,
  ThreadId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import * as ServerEnvironment from "../../../environment/ServerEnvironment.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as QuestStore from "../../../quest/QuestStore.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const QuestContextTool = Tool.make("t3_quest_context", {
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    ServerEnvironment.ServerEnvironment,
    QuestStore.QuestStore,
  ],
  description:
    "Read the Quest a thread belongs to: its role and purpose there, subject work, open decisions, pinned sources, the workspace and its registered documents, sibling conversations, the current plan, and results and plan proposals other discussions recorded. Without selectors it returns a bounded orientation with excerpts and titled links; pass `resultIds` or `proposalIds` for full records with exact edit before-values, `plan: true` for dependencies, or `revision` for one earlier saved revision. Read sibling discussions with `t3_thread_read`. Nothing here sends messages or applies answers.",
  parameters: Schema.Struct({
    environmentId: OrchestratorMcpEnvironmentTarget,
    threadId: Schema.optional(
      ThreadId.annotate({ description: "Thread whose Quest membership to read. Omit for yours." }),
    ),
    revision: Schema.optional(
      Schema.Int.annotate({
        description: "Earlier saved revision to reconstruct. Omit for current.",
      }),
    ),
    resultIds: Schema.optional(
      Schema.Array(Schema.String).annotate({ description: "Results to read in full." }),
    ),
    proposalIds: Schema.optional(
      Schema.Array(Schema.String).annotate({
        description: "Plan proposals to read in full, with each edit's exact before and after.",
      }),
    ),
    plan: Schema.optional(
      Schema.Boolean.annotate({ description: "Every work item with its dependencies." }),
    ),
  }),
  success: Schema.Record(Schema.String, Schema.Unknown),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const questWriteDependencies = [
  McpInvocationContext.McpInvocationContext,
  ThreadManagementService.ThreadManagementService,
  ServerEnvironment.ServerEnvironment,
  QuestStore.QuestStore,
];

const QuestRecorded = Schema.Struct({
  id: Schema.String,
  revision: Schema.Number,
  title: Schema.String,
  status: Schema.Literals(["recorded", "proposed"]),
  /** A titled link that opens this record in the Quest; cite it to the user. */
  link: Schema.String,
  note: Schema.String,
  overlapsOpenProposals: Schema.optional(
    Schema.Array(Schema.Struct({ proposalId: Schema.String, fields: Schema.Array(Schema.String) })),
  ),
});

const QuestPublishResultTool = Tool.make("t3_quest_publish_result", {
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies: questWriteDependencies,
  description:
    "Record a result of your Quest discussion for the Quest: what was delivered or learned, exact evidence, limitations and the work it affects. Other discussions see it on their next t3_quest_context read; nothing is sent to them. It changes no plan. Give the user the returned link.",
  parameters: Schema.Struct({
    title: Schema.String,
    summary: Schema.String.annotate({ description: "What was delivered or learned." }),
    candidate: Schema.optional(
      Schema.String.annotate({ description: "The candidate change, e.g. a commit range." }),
    ),
    evidence: Schema.optional(Schema.Array(QuestEvidenceRef)),
    limitations: Schema.optional(Schema.String),
    openQuestions: Schema.optional(Schema.String),
    affectedWorkIds: Schema.optional(
      Schema.Array(Schema.String).annotate({ description: "Quest work ids it may change." }),
    ),
    supersedes: Schema.optional(
      Schema.String.annotate({ description: "Your earlier result id this replaces." }),
    ),
    contextRevision: Schema.optional(
      Schema.Int.annotate({ description: "Quest revision you worked from." }),
    ),
  }),
  success: QuestRecorded,
})
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false);

const QuestProposePlanTool = Tool.make("t3_quest_propose_plan", {
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies: questWriteDependencies,
  description:
    "Propose concrete Quest plan edits from your discussion, citing the results they use. Only the owner applies, defers or declines it in Decisions; proposing changes no work. Give the user the returned link; reconcile any listed overlapping open proposal instead of leaving both.",
  parameters: Schema.Struct({
    title: Schema.String,
    rationale: Schema.String,
    contributionIds: Schema.optional(
      Schema.Array(Schema.String).annotate({ description: "Result ids this uses." }),
    ),
    supersedes: Schema.optional(
      Schema.String.annotate({ description: "Open proposal id this replaces." }),
    ),
    edits: Schema.Array(QuestPlanEditDraft),
  }),
  success: QuestRecorded,
})
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false);

export const QuestToolkit = Toolkit.make(
  QuestContextTool,
  QuestPublishResultTool,
  QuestProposePlanTool,
);

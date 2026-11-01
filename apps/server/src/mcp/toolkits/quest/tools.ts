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
    "Read the Quest a thread belongs to: its role and purpose there, subject work, open decisions, pinned sources, sibling conversations, the current plan, and results and plan proposals other discussions recorded. Current state only; pass `revision` to read one earlier saved revision. Read sibling discussions with `t3_thread_read`. Nothing here sends messages or applies answers.",
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

const QuestRecorded = Schema.Struct({ id: Schema.String, revision: Schema.Number });

const QuestPublishResultTool = Tool.make("t3_quest_publish_result", {
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies: questWriteDependencies,
  description:
    "Record a result of your Quest discussion for the Quest: what was delivered or learned, exact evidence, limitations and the work it affects. Other discussions see it on their next t3_quest_context read; nothing is sent to them. It changes no plan.",
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
    "Propose concrete Quest plan edits from your discussion, citing the results they use. Only the owner applies, defers or declines it in Decisions; proposing changes no work.",
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

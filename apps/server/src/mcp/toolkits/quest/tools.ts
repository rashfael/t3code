import {
  OrchestratorMcpEnvironmentTarget,
  OrchestratorMcpFailure,
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
    "Read the Quest a thread belongs to: its role and purpose there, subject work, open decisions, pinned sources and sibling conversations. Current state only; pass `revision` to read one earlier saved revision. Read sibling discussions with `t3_thread_read`. Nothing here sends messages or applies answers.",
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

export const QuestToolkit = Toolkit.make(QuestContextTool);

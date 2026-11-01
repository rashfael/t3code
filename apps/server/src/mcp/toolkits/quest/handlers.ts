import { OrchestratorMcpFailure, questQuestionStatus, type QuestError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as Environment from "../../../environment/ServerEnvironment.ts";
import { questAgentContext } from "../../../quest/questContext.ts";
import * as QuestStore from "../../../quest/QuestStore.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { readCaller } from "../../threadAccess.ts";
import { QuestToolkit } from "./tools.ts";

const toFailure = (error: QuestError) =>
  new OrchestratorMcpFailure({
    code:
      error.reason === "unavailable" || error.reason === "invalid"
        ? "invalid_request"
        : "orchestration_error",
    message: error.message,
  });

export const layer = McpToolAccess.toLayer(QuestToolkit, {
  t3_quest_context: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      const context = yield* readCaller();
      const environment = yield* Environment.ServerEnvironment;
      const descriptor = yield* environment.getDescriptor;
      if (descriptor.environmentId !== context.scope.environmentId)
        return yield* new OrchestratorMcpFailure({
          code: "capability_denied",
          message: "This credential belongs to another environment.",
        });
      const store = yield* QuestStore.QuestStore;
      const threadId = input.threadId ?? context.scope.thread?.threadId ?? null;
      if (input.revision === undefined) {
        const state = yield* store.get.pipe(Effect.mapError(toFailure));
        return questAgentContext(state, threadId);
      }
      const past = yield* store.reconstruct(input.revision).pipe(Effect.mapError(toFailure));
      return {
        revision: past.revision,
        limit: past.limit,
        currentWorkId: past.domain.currentWorkId,
        work: past.domain.work.map((item) => ({
          id: item.id,
          parentId: item.parentId,
          title: item.title,
          state: item.state,
        })),
        questions: past.domain.questions.map((item) => ({
          id: item.id,
          workId: item.workId,
          title: item.title,
          status: questQuestionStatus(item),
          answer: item.answer,
        })),
        conversations: past.domain.conversations.map((item) => ({
          threadId: item.threadId,
          role: item.role,
          purpose: item.purpose,
          workId: item.workId,
          questionId: item.questionId,
        })),
        changes:
          past.records.at(-1)?.changes.map((change) => ({
            collection: change.collection,
            id: change.id,
            created: change.before === null,
            removed: change.after === null,
          })) ?? [],
      };
    }),
  ),
});

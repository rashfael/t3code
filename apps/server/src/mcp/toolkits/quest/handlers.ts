// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";

import { OrchestratorMcpFailure, questQuestionStatus, type QuestError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as Environment from "../../../environment/ServerEnvironment.ts";
import { questAgentContext } from "../../../quest/questContext.ts";
import * as QuestStore from "../../../quest/QuestStore.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { loadCaller, readCaller } from "../../threadAccess.ts";
import { QuestToolkit } from "./tools.ts";

const toFailure = (error: QuestError) =>
  new OrchestratorMcpFailure({
    code:
      error.reason === "unavailable" || error.reason === "invalid"
        ? "invalid_request"
        : "orchestration_error",
    message: error.message,
  });

const encodeParams = Schema.encodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

/**
 * The calling discussion as the server knows it: its own thread and active run, never a thread the
 * agent names. The operation id makes a repeated identical call in one run a no-op.
 */
const contribute = Effect.fn("QuestMcp.contribute")(function* (
  name: string,
  params: unknown,
  change: QuestStore.QuestContributeInput["change"],
) {
  const { scope, caller } = yield* loadCaller();
  const threadId = scope.thread?.threadId;
  if (threadId === undefined || caller === undefined)
    return yield* new OrchestratorMcpFailure({
      code: "capability_denied",
      message: "Only a Quest discussion's own agent can record this.",
    });
  const store = yield* (yield* QuestStore.QuestStore)
    .memberQuest(threadId)
    .pipe(Effect.mapError(toFailure));
  if (store === null)
    return yield* new OrchestratorMcpFailure({
      code: "invalid_request",
      message: "This thread is not a discussion in any Quest.",
    });
  const runId = caller.activeRunId ?? null;
  const digest = NodeCrypto.createHash("sha256").update(encodeParams(params)).digest("hex");
  const operationId = `${name}:${threadId}:${runId ?? "no-run"}:${digest.slice(0, 32)}`;
  const saved = yield* store
    .contribute(
      { operationId, source: { threadId, runId }, change },
      { kind: "agent", id: threadId },
    )
    .pipe(Effect.mapError(toFailure));
  if (saved.id === null)
    return yield* new OrchestratorMcpFailure({
      code: "orchestration_error",
      message: "The record was not found after saving.",
    });
  return { id: saved.id, revision: saved.state.revision };
});

export const layer = McpToolAccess.toLayer(QuestToolkit, {
  t3_quest_publish_result: McpToolAccess.actsAsCaller((params) =>
    contribute("t3_quest_publish_result", params, {
      type: "contribution-record",
      contribution: {
        title: params.title,
        summary: params.summary,
        candidate: params.candidate ?? "",
        evidence: params.evidence ?? [],
        limitations: params.limitations ?? "",
        openQuestions: params.openQuestions ?? "",
        affectedWorkIds: params.affectedWorkIds ?? [],
        supersedes: params.supersedes ?? null,
        contextRevision: params.contextRevision ?? null,
      },
    }),
  ),
  t3_quest_propose_plan: McpToolAccess.actsAsCaller((params) =>
    contribute("t3_quest_propose_plan", params, {
      type: "plan-propose",
      proposal: {
        title: params.title,
        rationale: params.rationale,
        contributionIds: params.contributionIds ?? [],
        supersedes: params.supersedes ?? null,
        edits: params.edits,
      },
    }),
  ),
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
      const threadId = input.threadId ?? context.scope.thread?.threadId ?? null;
      // The thread's own membership selects the Quest, never what a client is showing.
      const store =
        threadId === null
          ? null
          : yield* (yield* QuestStore.QuestStore)
              .memberQuest(threadId)
              .pipe(Effect.mapError(toFailure));
      if (store === null)
        return yield* new OrchestratorMcpFailure({
          code: "invalid_request",
          message:
            input.threadId === undefined
              ? "This thread is not a discussion in any Quest on this environment."
              : `Thread "${input.threadId}" is not a discussion in any Quest on this environment. Omit threadId to read your own thread's Quest.`,
        });
      if (input.revision === undefined) {
        const state = yield* store.get.pipe(Effect.mapError(toFailure));
        return questAgentContext(state, threadId, store.identity);
      }
      const past = yield* store.reconstruct(input.revision).pipe(Effect.mapError(toFailure));
      return {
        questId: store.identity.id,
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

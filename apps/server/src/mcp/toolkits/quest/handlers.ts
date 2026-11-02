// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";

import {
  OrchestratorMcpFailure,
  questQuestionStatus,
  type QuestError,
  type QuestPlanProposal,
} from "@t3tools/contracts";
import { formatQuestLink } from "@t3tools/shared/questLinks";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as Environment from "../../../environment/ServerEnvironment.ts";
import {
  questAgentContext,
  questAgentDetails,
  questProposalOverlaps,
  type QuestLinker,
} from "../../../quest/questContext.ts";
import * as QuestStore from "../../../quest/QuestStore.ts";
import type { McpInvocationScope } from "../../McpInvocationContext.ts";
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

/** Links into the Quest the caller can open: T3 links, or web URLs on a client's own origin. */
function questLinker(
  scope: Pick<McpInvocationScope, "environmentId" | "client">,
  questId: string,
): QuestLinker {
  return (kind, id, label) =>
    formatQuestLink(
      { environmentId: scope.environmentId, questId, kind, id },
      label,
      scope.client?.webOrigin,
    );
}

/**
 * The calling discussion as the server knows it: its own thread and active run, never a thread the
 * agent names. The operation id makes a repeated identical call in one run a no-op.
 */
const saveAsCaller = Effect.fn("QuestMcp.saveAsCaller")(function* (
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
  return { saved, link: questLinker(scope, store.identity.id) };
});

const contribute = Effect.fn("QuestMcp.contribute")(function* (
  name: string,
  params: unknown,
  change: Extract<
    QuestStore.QuestContributeInput["change"],
    { readonly type: "contribution-record" | "plan-propose" }
  >,
) {
  const { saved, link } = yield* saveAsCaller(name, params, change);
  const result = saved.state.contributions.find((item) => item.id === saved.id);
  if (result)
    return {
      id: result.id,
      revision: saved.state.revision,
      title: result.title,
      status: "recorded" as const,
      link: link("result", result.id, result.title),
      note: "Recorded for the owner and other discussions. Nothing is accepted or applied until the owner applies a plan change that uses it.",
    };
  const proposal = saved.state.proposals.find((item) => item.id === saved.id);
  if (proposal) {
    const overlaps = questProposalOverlaps(saved.state, proposal);
    return {
      id: proposal.id,
      revision: saved.state.revision,
      title: proposal.title,
      status: "proposed" as const,
      link: link("proposal", proposal.id, proposal.title),
      note: "Waiting for the owner in Decisions. Nothing in the plan changed.",
      ...(overlaps.length > 0 ? { overlapsOpenProposals: overlaps } : {}),
    };
  }
  return yield* new OrchestratorMcpFailure({
    code: "orchestration_error",
    message: "The record was not found after saving.",
  });
});

/** An author's own withdrawal or restore, answered with titled links and current statuses. */
const withdraw = Effect.fn("QuestMcp.withdraw")(function* (
  params: unknown,
  change: Extract<
    QuestStore.QuestContributeInput["change"],
    { readonly type: "plan-withdraw" | "plan-restore" }
  >,
) {
  const { saved, link } = yield* saveAsCaller("t3_quest_withdraw_proposals", params, change);
  const describe = (item: QuestPlanProposal) => ({
    id: item.id,
    title: item.title,
    status: item.status,
    link: link("proposal", item.id, item.title),
  });
  const replacement =
    change.type === "plan-withdraw" && change.replacementId !== null
      ? saved.state.proposals.find((item) => item.id === change.replacementId)
      : undefined;
  const meaning =
    change.type === "plan-withdraw"
      ? "Withdrawn by you as their author, with content and history kept. The owner has not declined them, and the replacement keeps its own status: nothing is accepted or applied."
      : "Back with the owner in Decisions with their earlier status. Nothing is accepted or applied.";
  return {
    revision: saved.state.revision,
    changed: saved.changed,
    note: saved.changed ? meaning : `Already in that state; nothing changed. ${meaning}`,
    proposals: saved.state.proposals
      .filter((item) => change.proposalIds.includes(item.id))
      .map(describe),
    ...(replacement ? { replacement: describe(replacement) } : {}),
  };
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
  t3_quest_withdraw_proposals: McpToolAccess.actsAsCaller((params) =>
    params.restore && params.replacementId !== undefined
      ? Effect.fail(
          new OrchestratorMcpFailure({
            code: "invalid_request",
            message: "replacementId applies only when withdrawing. Nothing changed.",
          }),
        )
      : withdraw(
          params,
          params.restore
            ? { type: "plan-restore", proposalIds: params.proposalIds, note: params.reason }
            : {
                type: "plan-withdraw",
                proposalIds: params.proposalIds,
                reason: params.reason,
                replacementId: params.replacementId ?? null,
              },
        ),
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
        const link = questLinker(context.scope, store.identity.id);
        if (input.resultIds || input.proposalIds || input.plan)
          return questAgentDetails(state, store.identity, link, input);
        return questAgentContext(state, threadId, store.identity, link);
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

import {
  QUEST_DEFAULT_ID,
  questQuestionStatus,
  type QuestContribution,
  type QuestConversation,
  type QuestSourcePin,
  type QuestState,
} from "@t3tools/contracts";
import { questPlanEditChecks, questPlanEditSummary } from "@t3tools/shared/questPlan";

export interface QuestIdentity {
  readonly id: string;
  readonly title: string;
  /** The captured historical example, which must not be resumed as real work. */
  readonly historical: boolean;
}

export const LEGACY_QUEST: QuestIdentity = {
  id: QUEST_DEFAULT_ID,
  title: "Market tracking",
  historical: true,
};
const FIELD_LIMIT = 1500;

function bounded(text: string): string {
  const trimmed = text.trim();
  return trimmed.length <= FIELD_LIMIT ? trimmed : `${trimmed.slice(0, FIELD_LIMIT)}…`;
}

function subjectWorkId(state: QuestState, workId: string | null, questionId: string | null) {
  return workId ?? state.questions.find((item) => item.id === questionId)?.workId ?? null;
}

/** Document ids a discussion of this subject reads; their bytes are pinned when it opens. */
export function questSourceIds(
  state: QuestState,
  workId: string | null,
  questionId: string | null,
): ReadonlyArray<string> {
  const id = subjectWorkId(state, workId, questionId);
  return state.work.find((item) => item.id === id)?.documentIds ?? [];
}

/**
 * The unsent opening of a new discussion: purpose, subject, open obligations and the exact
 * source versions. The owner edits or discards it before anything reaches a provider.
 */
export function questContextPacket(
  state: QuestState,
  conversation: Pick<QuestConversation, "role" | "purpose" | "workId" | "questionId" | "context">,
  sources: ReadonlyArray<QuestSourcePin>,
  revision: number,
  identity: QuestIdentity,
): string {
  const lines = [
    identity.historical
      ? `Quest: ${identity.title} (historical example; do not resume the original market-tracking work).`
      : `Quest: ${identity.title}.`,
    `Quest revision ${revision}. Role: ${conversation.role === "core" ? "core coordination conversation" : "focused discussion"}.`,
  ];
  if (conversation.context === "packet" && conversation.role === "focused")
    lines.push(
      "This is a new discussion with prepared context, not a fork of another conversation.",
    );
  if (conversation.purpose.trim()) lines.push(`Purpose: ${conversation.purpose.trim()}`);
  const question = state.questions.find((item) => item.id === conversation.questionId);
  const workId = subjectWorkId(state, conversation.workId, conversation.questionId);
  const work = state.work.find((item) => item.id === workId);
  const current = state.work.find((item) => item.id === state.currentWorkId);
  if (conversation.role === "core" && current)
    lines.push("", `Current milestone: ${current.title} (${current.state})`);
  if (work) {
    lines.push(
      "",
      `Work: ${work.title} (${work.state})`,
      "Current understanding:",
      bounded(work.understanding),
    );
    if (work.findings.trim()) lines.push("Unresolved findings:", bounded(work.findings));
    if (work.handoff.trim()) lines.push("Prepared handoff:", bounded(work.handoff));
  }
  if (question) {
    lines.push(
      "",
      `Decision: ${question.title} (${questQuestionStatus(question)})`,
      bounded(question.context),
    );
    if (question.alternatives.length > 0)
      lines.push("Alternatives:", ...question.alternatives.map((item) => `- ${item}`));
  }
  const open = state.questions.filter(
    (item) =>
      item.id !== question?.id &&
      (workId === null || item.workId === workId) &&
      ["open", "recorded"].includes(questQuestionStatus(item)),
  );
  if (open.length > 0)
    lines.push(
      "",
      "Open decisions:",
      ...open.map((item) => `- ${item.title} (${questQuestionStatus(item)})`),
    );
  if (sources.length > 0)
    lines.push(
      "",
      "Sources, as pinned when this discussion opened:",
      ...sources.map((pin) => {
        const title =
          state.files.find((file) => file.id === pin.documentId)?.path ??
          state.documents.find((doc) => doc.id === pin.documentId)?.title ??
          pin.documentId;
        return pin.sha256
          ? `- ${title} (sha256 ${pin.sha256.slice(0, 12)})`
          : `- ${title} (not retained: ${pin.unavailable ?? "unknown"})`;
      }),
    );
  lines.push(
    "",
    "Answers and plan changes are recorded in the Quest by the owner; finishing this conversation does not apply them.",
  );
  return `${lines.join("\n")}\n\n`;
}

const RESULT_LIMIT = 20;
const PROPOSAL_LIMIT = 10;

/** Work ids on the path from `workId` to the root, so results about a parent or child count. */
function lineage(state: QuestState, workId: string | null): ReadonlySet<string> {
  const ids = new Set<string>();
  let id = workId;
  while (id !== null && !ids.has(id)) {
    ids.add(id);
    id = state.work.find((item) => item.id === id)?.parentId ?? null;
  }
  return ids;
}

function touches(state: QuestState, result: QuestContribution, workId: string | null): boolean {
  if (workId === null) return false;
  const mine = lineage(state, workId);
  return [result.workId, ...result.affectedWorkIds].some(
    (id) => id !== null && (mine.has(id) || lineage(state, id).has(workId)),
  );
}

/**
 * Results, plan proposals and the plan itself as one discussion sees them. Everything here is
 * read on request; nothing is pushed to a discussion when another one records something.
 */
function questCoordination(state: QuestState, threadId: string | null, workId: string | null) {
  const member = state.conversations.find((item) => item.threadId === threadId) ?? null;
  const since = member?.sourceRevision ?? null;
  const proposals = state.proposals.slice(-PROPOSAL_LIMIT);
  return {
    plan: {
      currentWorkId: state.currentWorkId,
      work: state.work
        .filter((item) => item.kind === "work")
        .map((item) => ({
          id: item.id,
          parentId: item.parentId,
          title: item.title,
          state: item.state,
          ...(item.focus === undefined ? {} : { focus: item.focus }),
        })),
      follows: state.relations
        .filter((item) => item.type === "follows")
        .map((item) => ({ id: item.id, from: item.from, to: item.to })),
    },
    results: state.contributions.slice(-RESULT_LIMIT).map((item) => ({
      id: item.id,
      title: item.title,
      disposition: item.disposition,
      dispositionBy: item.dispositionBy,
      fromYou: threadId !== null && item.source?.threadId === threadId,
      affectsYourWork: touches(state, item, workId),
      newSinceYourContext: since !== null && item.recordedRevision > since,
      source: item.source,
      provenance: item.provenance,
      workId: item.workId,
      affectedWorkIds: item.affectedWorkIds,
      recordedRevision: item.recordedRevision,
      contextRevision: item.contextRevision,
      summary: bounded(item.summary),
      candidate: bounded(item.candidate),
      evidence: item.evidence,
      limitations: bounded(item.limitations),
      openQuestions: bounded(item.openQuestions),
      supersedes: item.supersedes,
      sources: item.sources.map((pin) => ({
        documentId: pin.documentId,
        path: pin.path,
        pinnedSha256: pin.sha256,
      })),
    })),
    proposals: proposals.map((item) => {
      const decided = item.decisions.at(-1) ?? null;
      const open = item.status === "proposed" || item.status === "deferred";
      const checks = open
        ? questPlanEditChecks(state, item.edits, new Set(item.edits.map((edit) => edit.id)))
        : null;
      return {
        id: item.id,
        title: item.title,
        status: item.status,
        fromYou: threadId !== null && item.source?.threadId === threadId,
        source: item.source,
        provenance: item.provenance,
        baseRevision: item.baseRevision,
        rationale: bounded(item.rationale),
        contributionIds: item.contributionIds,
        supersedes: item.supersedes,
        edits: item.edits.map((edit) => ({
          id: edit.id,
          ...questPlanEditSummary(state, edit),
          ...(checks ? { check: checks.get(edit.id)?.status ?? null } : {}),
          ...(decided?.status === "applied"
            ? { applied: decided.selectedEditIds.includes(edit.id) }
            : {}),
        })),
        lastDecision: decided,
      };
    }),
    sinceYourContext:
      since === null
        ? null
        : {
            sourceRevision: since,
            appliedPlanChanges: state.proposals
              .filter((item) =>
                item.decisions.some(
                  (decision) => decision.status === "applied" && decision.revision > since,
                ),
              )
              .map((item) => item.id),
          },
  };
}

/** Current, bounded context for an agent in a Quest conversation. History is a separate read. */
export function questAgentContext(
  state: QuestState,
  threadId: string | null,
  identity: QuestIdentity,
) {
  const member = state.conversations.find((item) => item.threadId === threadId) ?? null;
  // The core coordinates whatever is current now; a focused discussion keeps its own subject.
  const workId =
    member && member.role !== "core"
      ? subjectWorkId(state, member.workId, member.questionId)
      : state.currentWorkId;
  const work = state.work.find((item) => item.id === workId) ?? null;
  const core = state.conversations.find((item) => item.role === "core") ?? null;
  return {
    questId: identity.id,
    title: identity.title,
    revision: state.revision,
    currentWorkId: state.currentWorkId,
    caller: member
      ? {
          threadId: member.threadId,
          role: member.role,
          purposeKind: member.purposeKind,
          purpose: member.purpose,
          workId: member.workId,
          questionId: member.questionId,
          sourceRevision: member.sourceRevision,
          context: member.context,
          origin: member.origin,
          sources: member.sources.map((pin) => ({
            documentId: pin.documentId,
            path: pin.path,
            pinnedSha256: pin.sha256,
            unavailable: pin.unavailable,
          })),
        }
      : null,
    coreThreadId: core?.creation?.status === "reserved" ? null : (core?.threadId ?? null),
    work: work
      ? {
          id: work.id,
          title: work.title,
          state: work.state,
          understanding: bounded(work.understanding),
          findings: bounded(work.findings),
          handoff: bounded(work.handoff),
          documentIds: work.documentIds,
        }
      : null,
    obligations: state.questions
      .filter(
        (item) =>
          (workId === null || item.workId === workId || item.id === member?.questionId) &&
          questQuestionStatus(item) !== "applied",
      )
      .map((item) => ({
        questionId: item.id,
        title: item.title,
        status: questQuestionStatus(item),
        answer: item.answer,
        answerSource: item.answerSource,
      })),
    applied: state.questions
      .filter((item) => item.applied && (workId === null || item.workId === workId))
      .map((item) => ({
        questionId: item.id,
        appliedRevision: item.appliedRevision,
        answerSource: item.answerSource,
      })),
    conversations: state.conversations.map((item) => ({
      threadId: item.threadId,
      role: item.role,
      purposeKind: item.purposeKind,
      purpose: item.purpose,
      workId: item.workId,
      questionId: item.questionId,
      sourceRevision: item.sourceRevision,
      ready: item.creation?.status !== "reserved",
    })),
    // Provenance only: these threads live in another environment and are not members here.
    externalConversations: state.externalConversations.map((item) => ({
      environmentId: item.environmentId,
      threadId: item.threadId,
      title: item.title,
      forkOf: item.forkOf,
      workId: item.workId,
      purpose: item.purpose,
    })),
    pendingWrites: state.pendingWrites.map((item) => ({
      documentId: item.documentId,
      path: item.path,
      status: item.status,
    })),
    ...questCoordination(state, threadId, workId),
  };
}

import {
  questQuestionStatus,
  type QuestConversation,
  type QuestSourcePin,
  type QuestState,
} from "@t3tools/contracts";

export const QUEST_ID = "market-tracking";
export const QUEST_TITLE = "Market tracking";
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
): string {
  const lines = [
    `Quest: ${QUEST_TITLE} (historical example; do not resume the original market-tracking work).`,
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

/** Current, bounded context for an agent in a Quest conversation. History is a separate read. */
export function questAgentContext(state: QuestState, threadId: string | null) {
  const member = state.conversations.find((item) => item.threadId === threadId) ?? null;
  // The core coordinates whatever is current now; a focused discussion keeps its own subject.
  const workId =
    member && member.role !== "core"
      ? subjectWorkId(state, member.workId, member.questionId)
      : state.currentWorkId;
  const work = state.work.find((item) => item.id === workId) ?? null;
  const core = state.conversations.find((item) => item.role === "core") ?? null;
  return {
    questId: QUEST_ID,
    title: QUEST_TITLE,
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
    pendingWrites: state.pendingWrites.map((item) => ({
      documentId: item.documentId,
      path: item.path,
      status: item.status,
    })),
  };
}

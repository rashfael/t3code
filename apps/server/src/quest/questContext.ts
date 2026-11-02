import {
  QUEST_DEFAULT_ID,
  questQuestionStatus,
  type QuestContribution,
  type QuestConversation,
  type QuestPlanProposal,
  type QuestSourcePin,
  type QuestState,
} from "@t3tools/contracts";
import type { QuestLinkKind } from "@t3tools/shared/questLinks";
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

export interface QuestOrientationInput {
  readonly questId: string;
  readonly title: string;
  readonly historical: boolean;
  readonly role: QuestConversation["role"];
  readonly purpose: string;
  /** What a focused discussion is about, or the work the core coordinates now. */
  readonly subject: string | null;
}

const oneLine = (text: string, limit: number) => {
  const flat = text.replaceAll(/\s+/g, " ").trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit)}…`;
};

/**
 * Per-turn orientation for a Quest member, derived from recorded membership. It names the
 * Quest and subject and points at `t3_quest_context`; the plan and documents stay out of it.
 */
export function questOrientationText(input: QuestOrientationInput): string {
  const quest = `"${oneLine(input.title, 120)}" (questId ${input.questId})`;
  const lines = [
    input.role === "core"
      ? `This thread is the core coordination conversation of the T3 Code Quest ${quest}.`
      : `This thread is a focused discussion in the T3 Code Quest ${quest}.`,
  ];
  if (input.historical) lines.push("It is a historical example; do not resume its original work.");
  if (input.purpose.trim()) lines.push(`Purpose: ${oneLine(input.purpose, 300)}`);
  if (input.subject) lines.push(`Subject: ${oneLine(input.subject, 200)}`);
  lines.push(
    "Before Quest work, such as answering about the subject, planning, deciding or changing code for it, call `t3_quest_context` without arguments for the plan, decisions, pinned sources and other discussions' results. Call it again before you reconcile their results or plan changes. Nothing from other discussions reaches this thread unless you read it.",
    "Record what you deliver or learn with `t3_quest_publish_result` and plan edits with `t3_quest_propose_plan`; only the owner applies answers and plan changes.",
    "T3 Code adds this note to every turn while the thread is a Quest member. A later turn without it means the thread has left the Quest; then ignore earlier Quest notes.",
  );
  return `<t3_quest_membership>\n${lines.join("\n")}\n</t3_quest_membership>`;
}

/** Orientation for `threadId` from current state, or undefined when it is not a member. */
export function questTurnOrientation(
  state: QuestState,
  threadId: string,
  identity: QuestIdentity,
): string | undefined {
  const member = state.conversations.find((item) => item.threadId === threadId);
  if (member === undefined) return undefined;
  const question = state.questions.find((item) => item.id === member.questionId);
  const work = state.work.find(
    (item) =>
      item.id ===
      (member.role === "core"
        ? state.currentWorkId
        : subjectWorkId(state, member.workId, member.questionId)),
  );
  const subject =
    member.role === "core"
      ? work && `current work "${work.title}"`
      : question
        ? `decision "${question.title}"${work ? ` in work "${work.title}"` : ""}`
        : work && `work "${work.title}"`;
  return questOrientationText({
    questId: identity.id,
    title: identity.title,
    historical: identity.historical,
    role: member.role,
    purpose: member.purpose,
    subject: subject ?? null,
  });
}

const RESULT_LIMIT = 20;
const PROPOSAL_LIMIT = 10;
const EXCERPT_LIMIT = 280;

/** Writes a titled link to one Quest record; T3 clients open it, others still read the label. */
export type QuestLinker = (kind: QuestLinkKind, id: string, label: string) => string;

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

const isOpenProposal = (item: QuestPlanProposal) =>
  item.status === "proposed" || item.status === "deferred";

/** Field-level targets of a proposal's work changes, e.g. `p-nav.understanding`. */
function changedFields(proposal: QuestPlanProposal): ReadonlyArray<string> {
  return proposal.edits.flatMap((edit) =>
    edit.type === "change-work"
      ? Object.keys(edit.after).map((key) => `${edit.workId}.${key}`)
      : [],
  );
}

/**
 * Open proposals that replace the same work field. Applying one makes the other's recorded
 * before-value stale, so they need one reconciled proposal, not both.
 */
export function questProposalOverlaps(
  state: QuestState,
  proposal: QuestPlanProposal,
): ReadonlyArray<{ readonly proposalId: string; readonly fields: ReadonlyArray<string> }> {
  const mine = new Set(changedFields(proposal));
  return state.proposals
    .filter((item) => item.id !== proposal.id && isOpenProposal(item))
    .map((item) => ({
      proposalId: item.id,
      fields: changedFields(item).filter((field) => mine.has(field)),
    }))
    .filter((item) => item.fields.length > 0);
}

/**
 * Results, plan proposals and the plan as one discussion first sees them: titles, status and
 * links, with full records behind `questAgentDetails`. Nothing is pushed to a discussion.
 */
function questCoordination(
  state: QuestState,
  threadId: string | null,
  workId: string | null,
  link: QuestLinker,
) {
  const member = state.conversations.find((item) => item.threadId === threadId) ?? null;
  const since = member?.sourceRevision ?? null;
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
          ...(item.role === "workstream" ? { role: item.role } : {}),
        })),
      follows: state.relations.filter((item) => item.type === "follows").length,
    },
    results: state.contributions.slice(-RESULT_LIMIT).map((item) => ({
      id: item.id,
      link: link("result", item.id, item.title),
      disposition: item.disposition,
      fromYou: threadId !== null && item.source?.threadId === threadId,
      affectsYourWork: touches(state, item, workId),
      newSinceYourContext: since !== null && item.recordedRevision > since,
      sourceThreadId: item.source?.threadId ?? null,
      provenance: item.provenance,
      workId: item.workId,
      affectedWorkIds: item.affectedWorkIds,
      recordedRevision: item.recordedRevision,
      supersedes: item.supersedes,
      ...(item.disposition === "open"
        ? { summaryExcerpt: oneLine(item.summary, EXCERPT_LIMIT) }
        : {}),
    })),
    proposals: state.proposals.slice(-PROPOSAL_LIMIT).map((item) => {
      const decided = item.decisions.at(-1) ?? null;
      if (!isOpenProposal(item)) {
        const replacement =
          item.status === "withdrawn" && decided?.byProposalId
            ? state.proposals.find((other) => other.id === decided.byProposalId)
            : undefined;
        return {
          id: item.id,
          link: link("proposal", item.id, item.title),
          status: item.status,
          decidedRevision: decided?.revision ?? null,
          ...(item.status === "withdrawn"
            ? {
                fromYou: threadId !== null && item.source?.threadId === threadId,
                withdrawnReason: oneLine(decided?.note ?? "", EXCERPT_LIMIT),
                ...(replacement
                  ? { replacedBy: link("proposal", replacement.id, replacement.title) }
                  : {}),
              }
            : {}),
        };
      }
      const checks = questPlanEditChecks(
        state,
        item.edits,
        new Set(item.edits.map((edit) => edit.id)),
      );
      const overlaps = questProposalOverlaps(state, item);
      return {
        id: item.id,
        link: link("proposal", item.id, item.title),
        status: item.status,
        fromYou: threadId !== null && item.source?.threadId === threadId,
        sourceThreadId: item.source?.threadId ?? null,
        baseRevision: item.baseRevision,
        contributionIds: item.contributionIds,
        supersedes: item.supersedes,
        edits: item.edits.map((edit) => {
          const summary = questPlanEditSummary(state, edit);
          return {
            id: edit.id,
            label:
              edit.type === "add-follows" ? `${summary.label}: ${summary.after}` : summary.label,
            check: checks.get(edit.id)?.status ?? null,
          };
        }),
        ...(overlaps.length > 0 ? { overlapsOpenProposals: overlaps } : {}),
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
    more: "Excerpts only. Read full records with t3_quest_context resultIds or proposalIds (summary, evidence, limitations, exact edit before/after values), plan: true for dependencies, revision for an earlier saved state, and documents with Read at workspace.root + path.",
  };
}

/** Bounded orientation for an agent in a Quest conversation. Full records are a separate read. */
export function questAgentContext(
  state: QuestState,
  threadId: string | null,
  identity: QuestIdentity,
  link: QuestLinker,
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
          link: link("work", work.id, work.title),
          title: work.title,
          state: work.state,
          understanding: bounded(work.understanding),
          findings: bounded(work.findings),
          handoff: bounded(work.handoff),
          documentIds: work.documentIds,
        }
      : null,
    // Registered documents live in the workspace; their current bytes are read from disk.
    workspace: {
      root: state.workspace?.root ?? null,
      documents: state.files.map((file) => ({
        id: file.id,
        path: file.path,
        link: link("document", file.id, file.title),
        usedBy: state.work
          .filter((item) => item.documentIds.includes(file.id))
          .map((item) => item.id),
      })),
    },
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
      title: item.title,
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
    ...questCoordination(state, threadId, workId, link),
  };
}

interface QuestDetailSelection {
  readonly resultIds?: ReadonlyArray<string> | undefined;
  readonly proposalIds?: ReadonlyArray<string> | undefined;
  readonly plan?: boolean | undefined;
}

/** Full records the orientation only lists, including the exact values each edit replaces. */
export function questAgentDetails(
  state: QuestState,
  identity: QuestIdentity,
  link: QuestLinker,
  selection: QuestDetailSelection,
) {
  const resultIds = selection.resultIds ?? [];
  const proposalIds = selection.proposalIds ?? [];
  const results = state.contributions.filter((item) => resultIds.includes(item.id));
  const proposals = state.proposals.filter((item) => proposalIds.includes(item.id));
  const missing = [
    ...resultIds.filter((id) => !results.some((item) => item.id === id)),
    ...proposalIds.filter((id) => !proposals.some((item) => item.id === id)),
  ];
  return {
    questId: identity.id,
    revision: state.revision,
    ...(missing.length > 0 ? { missing } : {}),
    ...(results.length > 0
      ? {
          results: results.map((item) => ({
            ...item,
            link: link("result", item.id, item.title),
            sources: item.sources.map((pin) => ({
              documentId: pin.documentId,
              path: pin.path,
              pinnedSha256: pin.sha256,
              unavailable: pin.unavailable,
            })),
          })),
        }
      : {}),
    ...(proposals.length > 0
      ? {
          proposals: proposals.map((item) => {
            const checks = isOpenProposal(item)
              ? questPlanEditChecks(state, item.edits, new Set(item.edits.map((edit) => edit.id)))
              : null;
            return {
              ...item,
              link: link("proposal", item.id, item.title),
              edits: item.edits.map((edit) => ({
                ...edit,
                label: questPlanEditSummary(state, edit).label,
                ...(checks ? { check: checks.get(edit.id) ?? null } : {}),
              })),
              ...(isOpenProposal(item)
                ? { overlapsOpenProposals: questProposalOverlaps(state, item) }
                : {}),
            };
          }),
        }
      : {}),
    ...(selection.plan
      ? {
          plan: {
            currentWorkId: state.currentWorkId,
            work: state.work.map((item) => ({
              id: item.id,
              parentId: item.parentId,
              kind: item.kind,
              title: item.title,
              state: item.state,
              ...(item.focus === undefined ? {} : { focus: item.focus }),
              ...(item.role === undefined ? {} : { role: item.role }),
              ...(item.phase === undefined ? {} : { phase: item.phase }),
              ...(item.workstreamIds === undefined ? {} : { workstreamIds: item.workstreamIds }),
            })),
            follows: state.relations
              .filter((item) => item.type === "follows")
              .map((item) => ({ id: item.id, from: item.from, to: item.to })),
          },
        }
      : {}),
  };
}

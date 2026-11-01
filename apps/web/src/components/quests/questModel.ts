import {
  questQuestionStatus,
  type QuestPhase,
  type QuestQuestion,
  type QuestQuestionStatus,
  type QuestState,
  type QuestWork,
  type QuestWorkState,
} from "@t3tools/contracts";

export const workStateLabels: Record<QuestWorkState, string> = {
  planned: "Planned",
  active: "Active",
  attention: "Needs human attention",
  review: "Awaiting review",
  deferred: "Deferred",
  done: "Recorded outcome",
};

export const phaseLabels: Record<QuestPhase, string> = {
  exploration: "Exploration",
  prototype: "Prototype",
  integration: "Integration and use",
  hardening: "Hardening",
};

/** Palette slots for workstream identity colours, `--stream-1` to `--stream-6` in the theme. */
const WORKSTREAM_SLOTS = 6;

/** Each workstream's palette slot (0-based), in the order the workstreams were recorded. */
export function workstreamSlots(state: QuestState): ReadonlyMap<string, number> {
  return new Map(
    state.work
      .filter((item) => item.role === "workstream")
      .map((item, index) => [item.id, index % WORKSTREAM_SLOTS]),
  );
}

export const workStateVariants = {
  planned: "outline",
  active: "info",
  attention: "warning",
  review: "secondary",
  deferred: "outline",
  done: "success",
} as const satisfies Record<QuestWorkState, string>;

export const questionStatusLabels: Record<QuestQuestionStatus, string> = {
  open: "Open",
  recorded: "Answer recorded · not applied",
  deferred: "Deferred",
  applied: "Applied",
};

export const questionStatusOrder: ReadonlyArray<QuestQuestionStatus> = [
  "open",
  "recorded",
  "deferred",
  "applied",
];

export function childrenOf(state: QuestState, parentId: string | null): ReadonlyArray<QuestWork> {
  return state.work.filter((item) => item.parentId === parentId);
}

export function workPath(state: QuestState, workId: string): ReadonlyArray<QuestWork> {
  const path: Array<QuestWork> = [];
  const seen = new Set<string>();
  let current = state.work.find((item) => item.id === workId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current);
    const parentId = current.parentId;
    current = parentId === null ? undefined : state.work.find((item) => item.id === parentId);
  }
  return path;
}

/**
 * Delivery work below `rootId` that has no delivery parts of its own. Parents summarize their
 * parts, and attempts are history, so counting either would count the same work twice.
 */
export function deliveryLeaves(state: QuestState, rootId: string): ReadonlyArray<QuestWork> {
  const leaves: Array<QuestWork> = [];
  const visit = (id: string, seen: Set<string>) => {
    const parts = state.work.filter((item) => item.parentId === id && item.kind === "work");
    for (const part of parts) {
      if (seen.has(part.id)) continue;
      seen.add(part.id);
      if (state.work.some((item) => item.parentId === part.id && item.kind === "work"))
        visit(part.id, seen);
      else leaves.push(part);
    }
  };
  visit(rootId, new Set([rootId]));
  return leaves;
}

function countByState(
  work: ReadonlyArray<QuestWork>,
): ReadonlyArray<{ state: QuestWorkState; count: number }> {
  return (Object.keys(workStateLabels) as Array<QuestWorkState>)
    .map((state) => ({ state, count: work.filter((item) => item.state === state).length }))
    .filter((entry) => entry.count > 0);
}

export function describeCounts(work: ReadonlyArray<QuestWork>): string {
  const counts = countByState(work);
  if (counts.length === 0) return "No parts recorded";
  return counts
    .map(({ state, count }) => `${count} ${workStateLabels[state].toLowerCase()}`)
    .join(" · ");
}

export function questionsByStatus(
  questions: ReadonlyArray<QuestQuestion>,
): Record<QuestQuestionStatus, ReadonlyArray<QuestQuestion>> {
  const groups: Record<QuestQuestionStatus, Array<QuestQuestion>> = {
    open: [],
    recorded: [],
    deferred: [],
    applied: [],
  };
  for (const question of questions) groups[questQuestionStatus(question)].push(question);
  return groups;
}

export function rootWork(state: QuestState): ReadonlyArray<QuestWork> {
  return childrenOf(state, null);
}

/** Review obligations grouped under the work that holds them. */
export function reviewGroups(
  state: QuestState,
): ReadonlyArray<{ parent: QuestWork | null; items: ReadonlyArray<QuestWork> }> {
  const groups = new Map<string | null, Array<QuestWork>>();
  for (const item of state.work) {
    if (item.kind !== "work" || item.state !== "review") continue;
    if (state.work.some((child) => child.parentId === item.id && child.kind === "work")) continue;
    const list = groups.get(item.parentId) ?? [];
    list.push(item);
    groups.set(item.parentId, list);
  }
  return [...groups].map(([parentId, items]) => ({
    parent: state.work.find((item) => item.id === parentId) ?? null,
    items,
  }));
}

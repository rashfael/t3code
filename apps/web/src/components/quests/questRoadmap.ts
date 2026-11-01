import { questQuestionStatus, type QuestState, type QuestWork } from "@t3tools/contracts";

import { deliveryLeaves } from "./questModel";

const ROADMAP_COLUMN = 280;
/** Labels end well before the next column so forks and joins bend in clear space. */
export const ROADMAP_LABEL = 220;
const ROADMAP_ROW = 32;
const PADDING_X = 16;
const PADDING_Y = 20;

export type RoadmapStopRole = "milestone" | "part" | "successor";

export interface RoadmapStop {
  readonly work: QuestWork;
  readonly role: RoadmapStopRole;
  readonly x: number;
  readonly y: number;
  /** Open or recorded decisions, then attention work without one, inside this stop's scope. */
  readonly needs: ReadonlyArray<RoadmapNeed>;
  /** Delivery leaves in scope that await review; parents and attempts are not counted again. */
  readonly reviewCount: number;
  /** Conversation threads linked to work in this stop's scope. */
  readonly threadIds: ReadonlyArray<string>;
}

export type RoadmapNeed =
  | { readonly type: "question"; readonly id: string; readonly title: string }
  | { readonly type: "work"; readonly id: string; readonly title: string };

export interface RoadmapPath {
  readonly id: string;
  readonly kind: "fork" | "follows";
  readonly source: string;
  readonly target: string;
}

export interface Roadmap {
  readonly milestone: QuestWork;
  readonly stops: ReadonlyArray<RoadmapStop>;
  readonly paths: ReadonlyArray<RoadmapPath>;
  /** Where the missing later milestone is shown when no recorded work follows this one. */
  readonly gap: { readonly x: number; readonly y: number } | null;
  readonly width: number;
  readonly height: number;
}

/**
 * The current milestone, its direct delivery parts and recorded work that follows it. Only
 * `follows` relations order parts; parts without one run side by side from the milestone.
 * Relations between deeper work are lifted to the parts that contain it.
 */
export function layoutRoadmap(state: QuestState): Roadmap | null {
  const milestone = state.work.find((item) => item.id === state.currentWorkId);
  if (!milestone) return null;
  const byId = new Map(state.work.map((item) => [item.id, item]));
  const parts = state.work.filter((item) => item.parentId === milestone.id && item.kind === "work");
  const partIds = new Set(parts.map((part) => part.id));

  // The part containing `id`, the milestone itself, or null when outside the milestone.
  const scopeOf = (id: string): string | null => {
    const seen = new Set<string>();
    let current = byId.get(id);
    while (current && !seen.has(current.id)) {
      if (partIds.has(current.id) || current.id === milestone.id) return current.id;
      seen.add(current.id);
      current = current.parentId === null ? undefined : byId.get(current.parentId);
    }
    return null;
  };

  const prerequisites = new Map<string, Set<string>>();
  const successors = new Map<string, Set<string>>();
  for (const relation of state.relations) {
    if (relation.type !== "follows") continue;
    const before = scopeOf(relation.to);
    const after = scopeOf(relation.from);
    if (before === null || before === after) continue;
    if (after === null) {
      // Work outside the milestone that follows it, or one of its parts, is its known next step.
      if (!byId.has(relation.from)) continue;
      const set = successors.get(relation.from) ?? new Set();
      set.add(before);
      successors.set(relation.from, set);
      continue;
    }
    if (after === milestone.id || before === milestone.id) continue;
    const set = prerequisites.get(after) ?? new Set();
    set.add(before);
    prerequisites.set(after, set);
  }

  const ranks = new Map<string, number>();
  const rankOf = (id: string, visiting: Set<string>): number => {
    const known = ranks.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    let rank = 0;
    for (const before of prerequisites.get(id) ?? [])
      rank = Math.max(rank, rankOf(before, visiting) + 1);
    visiting.delete(id);
    ranks.set(id, rank);
    return rank;
  };
  for (const part of parts) rankOf(part.id, new Set());

  const hasDependents = new Set([...prerequisites.values()].flatMap((set) => [...set]));
  for (const set of successors.values()) for (const id of set) hasDependents.add(id);
  // Lanes that lead somewhere sit together so their joins stay short; unrelated lanes follow.
  const lanes = parts
    .filter((part) => ranks.get(part.id) === 0)
    .toSorted((a, b) => Number(hasDependents.has(b.id)) - Number(hasDependents.has(a.id)));

  const rows = new Map<string, number>();
  lanes.forEach((part, index) => rows.set(part.id, index));
  const maxRank = Math.max(0, ...ranks.values());
  const columnRows = new Map<number, Array<number>>();
  const placeRow = (column: number, wanted: number) => {
    const taken = columnRows.get(column) ?? [];
    let row = wanted;
    for (let step = 1; taken.some((other) => Math.abs(other - row) < 1); step += 1)
      row = wanted + (step % 2 === 1 ? Math.ceil(step / 2) : -step / 2);
    taken.push(row);
    columnRows.set(column, taken);
    return row;
  };
  const meanRow = (ids: Iterable<string>) => {
    const values = [...ids].map((id) => rows.get(id)).filter((row) => row !== undefined);
    return values.length > 0 ? values.reduce((sum, row) => sum + row, 0) / values.length : 0;
  };
  for (let rank = 1; rank <= maxRank; rank += 1) {
    for (const part of parts) {
      if (ranks.get(part.id) !== rank) continue;
      rows.set(part.id, placeRow(rank, meanRow(prerequisites.get(part.id) ?? [])));
    }
  }
  const milestoneRow = lanes.length > 0 ? (lanes.length - 1) / 2 : 0;
  rows.set(milestone.id, milestoneRow);
  const nextColumn = maxRank + 1;
  for (const [id, sources] of successors) rows.set(id, placeRow(nextColumn, meanRow(sources)));

  const allRows = [...rows.values()];
  const minRow = Math.min(...allRows);
  const maxRow = Math.max(...allRows);
  const yOf = (row: number) => PADDING_Y + (row - minRow) * ROADMAP_ROW;
  const xOf = (column: number) => PADDING_X + column * ROADMAP_COLUMN;

  const scopes = new Map<string, Array<QuestWork>>();
  for (const item of state.work) {
    const scope = scopeOf(item.id);
    if (scope === null) continue;
    const list = scopes.get(scope) ?? [];
    list.push(item);
    scopes.set(scope, list);
  }
  const describe = (work: QuestWork, role: RoadmapStopRole, x: number, y: number): RoadmapStop => {
    // The milestone's parts are stops of their own, so the milestone covers only itself.
    const scope = role === "part" ? (scopes.get(work.id) ?? [work]) : [work];
    const scopeIds = new Set(scope.map((item) => item.id));
    const waiting = state.questions.filter((question) => {
      const status = questQuestionStatus(question);
      return scopeIds.has(question.workId) && (status === "open" || status === "recorded");
    });
    const waitingWork = new Set(waiting.map((question) => question.workId));
    const leaves = role === "part" ? deliveryLeaves(state, work.id) : [];
    return {
      work,
      role,
      x,
      y,
      needs: [
        ...waiting.map((question) => ({
          type: "question" as const,
          id: question.id,
          title: question.title,
        })),
        ...scope
          .filter((item) => item.state === "attention" && !waitingWork.has(item.id))
          .map((item) => ({ type: "work" as const, id: item.id, title: item.title })),
      ],
      reviewCount: leaves.filter((leaf) => leaf.state === "review").length,
      threadIds: state.conversations
        .filter((conversation) => conversation.workId !== null && scopeIds.has(conversation.workId))
        .map((conversation) => conversation.threadId),
    };
  };

  const stops: Array<RoadmapStop> = [
    describe(milestone, "milestone", xOf(0), yOf(milestoneRow)),
    ...parts.map((part) =>
      describe(part, "part", xOf(1 + (ranks.get(part.id) ?? 0)), yOf(rows.get(part.id) ?? 0)),
    ),
    ...[...successors.keys()].map((id) =>
      describe(byId.get(id)!, "successor", xOf(1 + nextColumn), yOf(rows.get(id) ?? 0)),
    ),
  ];
  const paths: Array<RoadmapPath> = [
    ...lanes.map((part) => ({
      id: `fork:${part.id}`,
      kind: "fork" as const,
      source: milestone.id,
      target: part.id,
    })),
    ...[...prerequisites, ...successors].flatMap(([target, sources]) =>
      [...sources].map((source) => ({
        id: `follows:${source}:${target}`,
        kind: "follows" as const,
        source,
        target,
      })),
    ),
  ];
  const columns = 2 + nextColumn;
  return {
    milestone,
    stops,
    paths,
    gap: successors.size === 0 ? { x: xOf(1 + nextColumn), y: yOf(milestoneRow) } : null,
    width: PADDING_X * 2 + (columns - 1) * ROADMAP_COLUMN + ROADMAP_LABEL,
    height: PADDING_Y * 2 + (maxRow - minRow) * ROADMAP_ROW,
  };
}

/** A horizontal lane from `source` that bends into `target`'s row just before its column. */
export function roadmapPathD(source: RoadmapStop, target: RoadmapStop): string {
  if (source.y === target.y) return `M ${source.x} ${source.y} H ${target.x}`;
  const bend = 20;
  const start = Math.max(source.x, target.x - bend * 2);
  const mid = (start + target.x) / 2;
  return `M ${source.x} ${source.y} H ${start} C ${mid} ${source.y}, ${mid} ${target.y}, ${target.x} ${target.y}`;
}

import { questQuestionStatus, type QuestState, type QuestWork } from "@t3tools/contracts";

import { deliveryLeaves } from "./questModel";

/** Column spacing narrows to fit the available width, down to where angled labels stay apart. */
const ROADMAP_COLUMN = 200;
const ROADMAP_COLUMN_MIN = 110;
/** Room after the last column for its angled labels. */
const ROADMAP_LABEL = 200;
const PADDING_X = 24;
const PADDING_Y = 12;

export type RoadmapStopRole = "milestone" | "part" | "successor";

export interface RoadmapStop {
  readonly work: QuestWork;
  readonly role: RoadmapStopRole;
  /** The current milestone, or the milestone holding the current work. */
  readonly isCurrent: boolean;
  readonly column: number;
  readonly row: number;
  /** Bar centre. */
  readonly x: number;
  readonly y: number;
  /** Bar extent on each side; they differ when what enters and what leaves are not the same. */
  readonly inHeight: number;
  readonly outHeight: number;
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
  /** `within`: a milestone inside a larger one leads into it, as decomposition rather than order. */
  readonly kind: "fork" | "follows" | "within";
  readonly source: string;
  readonly target: string;
  readonly width: number;
  /** Ribbon centre where it leaves the source bar and enters the target bar. */
  readonly sourceY: number;
  readonly targetY: number;
}

export interface Roadmap {
  /** Distance between columns. */
  readonly column: number;
  readonly stops: ReadonlyArray<RoadmapStop>;
  readonly paths: ReadonlyArray<RoadmapPath>;
  /** Where the missing later milestone is shown when no recorded work follows this one. */
  readonly gap: { readonly x: number; readonly y: number } | null;
  readonly width: number;
  readonly height: number;
}

type PlacedStop = Omit<RoadmapStop, "x" | "y" | "inHeight" | "outHeight">;
type PlacedLink = Omit<RoadmapPath, "width" | "sourceY" | "targetY">;

/**
 * With explicit milestones, the whole plan's milestone network; otherwise the current work and
 * its parts, so Quests recorded before milestones were explicit keep their view.
 */
export function layoutRoadmap(state: QuestState, available: number | null = null): Roadmap | null {
  const roadmap = state.work.some((item) => item.kind === "work" && item.role === "milestone")
    ? layoutMilestones(state)
    : layoutCurrentWork(state);
  return roadmap && arrange(...roadmap, available);
}

type Gap = { readonly column: number; readonly row: number };
/** Stops and paths in columns and rows, before they get pixel positions. */
type Placement = readonly [
  placed: ReadonlyArray<PlacedStop>,
  links: ReadonlyArray<PlacedLink>,
  columns: number,
  gap: Gap | null,
];

/**
 * Every milestone at any depth, past, current and planned. Order comes only from `follows`
 * relations lifted to the nearest milestone holding each end, and from a milestone leading into
 * the larger milestone that contains it. Milestones nothing relates to stand alone; workstream
 * membership groups rows but never adds a path.
 */
function layoutMilestones(state: QuestState): Placement {
  const byId = new Map(state.work.map((item) => [item.id, item]));
  const milestones = state.work.filter((item) => item.kind === "work" && item.role === "milestone");
  const milestoneIds = new Set(milestones.map((item) => item.id));
  const milestoneOf = (id: string | null): string | null => {
    const seen = new Set<string>();
    let current = id === null ? undefined : byId.get(id);
    while (current && !seen.has(current.id)) {
      if (milestoneIds.has(current.id)) return current.id;
      seen.add(current.id);
      current = current.parentId === null ? undefined : byId.get(current.parentId);
    }
    return null;
  };
  const enclosing = (id: string) => milestoneOf(byId.get(id)?.parentId ?? null);
  const contains = (outer: string, inner: string) => {
    const seen = new Set<string>();
    for (let at = enclosing(inner); at !== null && !seen.has(at); at = enclosing(at)) {
      if (at === outer) return true;
      seen.add(at);
    }
    return false;
  };
  const current = milestoneOf(state.currentWorkId);

  const links = new Map<string, PlacedLink>();
  const prerequisites = new Map<string, Set<string>>();
  const link = (kind: "follows" | "within", source: string, target: string) => {
    const id = `${kind}:${source}:${target}`;
    if (links.has(id)) return;
    links.set(id, { id, kind, source, target });
    const set = prerequisites.get(target) ?? new Set();
    set.add(source);
    prerequisites.set(target, set);
  };
  for (const milestone of milestones) {
    const outer = enclosing(milestone.id);
    if (outer !== null) link("within", milestone.id, outer);
  }
  for (const relation of state.relations) {
    if (relation.type !== "follows") continue;
    const before = milestoneOf(relation.to);
    const after = milestoneOf(relation.from);
    if (before === null || after === null || before === after) continue;
    if (contains(before, after) || contains(after, before)) continue;
    link("follows", before, after);
  }

  const ranks = longestRanks(
    milestones.map((item) => item.id),
    prerequisites,
  );

  // Starting milestones of one workstream sit together; those that lead somewhere come first.
  const streamOrder = new Map(
    state.work.filter((item) => item.role === "workstream").map((item, index) => [item.id, index]),
  );
  const streamIndex = (work: QuestWork) =>
    Math.min(
      Number.MAX_SAFE_INTEGER,
      ...(work.workstreamIds ?? []).map((id) => streamOrder.get(id) ?? Number.MAX_SAFE_INTEGER),
    );
  const leads = new Set([...links.values()].map((item) => item.source));
  const starts = milestones
    .filter((item) => ranks.get(item.id) === 0)
    .toSorted(
      (a, b) =>
        Number(leads.has(b.id)) - Number(leads.has(a.id)) || streamIndex(a) - streamIndex(b),
    );
  const rows = new Map<string, number>();
  starts.forEach((item, index) => rows.set(item.id, index));
  const place = rowPlacer(rows);
  const maxRank = Math.max(0, ...ranks.values());
  for (let rank = 1; rank <= maxRank; rank += 1)
    for (const milestone of milestones)
      if (ranks.get(milestone.id) === rank)
        rows.set(milestone.id, place.at(rank, place.mean(prerequisites.get(milestone.id) ?? [])));

  const scope = new Map<string, Array<QuestWork>>();
  for (const item of state.work) {
    const owner = milestoneOf(item.id);
    if (owner === null) continue;
    const list = scope.get(owner) ?? [];
    list.push(item);
    scope.set(owner, list);
  }
  const placed = milestones.map((milestone) => {
    const own = scope.get(milestone.id) ?? [milestone];
    return describeStop(state, milestone, "milestone", ranks.get(milestone.id) ?? 0, {
      row: rows.get(milestone.id) ?? 0,
      isCurrent: milestone.id === current,
      scope: own,
      leaves: deliveryLeaves(state, milestone.id).filter(
        (leaf) => milestoneOf(leaf.id) === milestone.id,
      ),
    });
  });
  const hasNext = current !== null && [...links.values()].some((item) => item.source === current);
  const gap =
    current === null || hasNext
      ? null
      : { column: (ranks.get(current) ?? 0) + 1, row: rows.get(current) ?? 0 };
  return [placed, [...links.values()], Math.max(maxRank, gap?.column ?? 0) + 1, gap];
}

/** Column of each id: one past its latest prerequisite. A cycle is cut where it is found. */
function longestRanks(
  ids: ReadonlyArray<string>,
  prerequisites: ReadonlyMap<string, ReadonlySet<string>>,
): ReadonlyMap<string, number> {
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
  for (const id of ids) rankOf(id, new Set());
  return ranks;
}

/** Places rows in a column without overlap, starting from the wanted row. */
function rowPlacer(rows: ReadonlyMap<string, number>) {
  const columnRows = new Map<number, Array<number>>();
  return {
    at(column: number, wanted: number) {
      const taken = columnRows.get(column) ?? [];
      let row = wanted;
      for (let step = 1; taken.some((other) => Math.abs(other - row) < 1); step += 1)
        row = wanted + (step % 2 === 1 ? Math.ceil(step / 2) : -step / 2);
      taken.push(row);
      columnRows.set(column, taken);
      return row;
    },
    mean(ids: Iterable<string>) {
      const values = [...ids].map((id) => rows.get(id)).filter((row) => row !== undefined);
      return values.length > 0 ? values.reduce((sum, row) => sum + row, 0) / values.length : 0;
    },
  };
}

/** Open or recorded decisions, then attention work without one, and reviews and threads in scope. */
function describeStop(
  state: QuestState,
  work: QuestWork,
  role: RoadmapStopRole,
  column: number,
  {
    row,
    isCurrent,
    scope,
    leaves,
  }: {
    row: number;
    isCurrent: boolean;
    scope: ReadonlyArray<QuestWork>;
    leaves: ReadonlyArray<QuestWork>;
  },
): PlacedStop {
  const scopeIds = new Set(scope.map((item) => item.id));
  const waiting = state.questions.filter((question) => {
    const status = questQuestionStatus(question);
    return scopeIds.has(question.workId) && (status === "open" || status === "recorded");
  });
  const waitingWork = new Set(waiting.map((question) => question.workId));
  return {
    work,
    role,
    isCurrent,
    column,
    row,
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
}

/**
 * The current work, its direct delivery parts and recorded work that follows it. Only `follows`
 * relations order parts; parts without one run side by side from the current work. Relations
 * between deeper work are lifted to the parts that contain it.
 */
function layoutCurrentWork(state: QuestState): Placement | null {
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

  const ranks = longestRanks(
    parts.map((part) => part.id),
    prerequisites,
  );

  const hasDependents = new Set([...prerequisites.values()].flatMap((set) => [...set]));
  for (const set of successors.values()) for (const id of set) hasDependents.add(id);
  // Lanes that lead somewhere sit together so their joins stay short; unrelated lanes follow.
  const lanes = parts
    .filter((part) => ranks.get(part.id) === 0)
    .toSorted((a, b) => Number(hasDependents.has(b.id)) - Number(hasDependents.has(a.id)));

  const rows = new Map<string, number>();
  lanes.forEach((part, index) => rows.set(part.id, index));
  const maxRank = Math.max(0, ...ranks.values());
  const place = rowPlacer(rows);
  for (let rank = 1; rank <= maxRank; rank += 1) {
    for (const part of parts) {
      if (ranks.get(part.id) !== rank) continue;
      rows.set(part.id, place.at(rank, place.mean(prerequisites.get(part.id) ?? [])));
    }
  }
  const milestoneRow = lanes.length > 0 ? (lanes.length - 1) / 2 : 0;
  rows.set(milestone.id, milestoneRow);
  const nextColumn = maxRank + 1;
  for (const [id, sources] of successors) rows.set(id, place.at(nextColumn, place.mean(sources)));

  const scopes = new Map<string, Array<QuestWork>>();
  for (const item of state.work) {
    const scope = scopeOf(item.id);
    if (scope === null) continue;
    const list = scopes.get(scope) ?? [];
    list.push(item);
    scopes.set(scope, list);
  }
  const describe = (work: QuestWork, role: RoadmapStopRole, column: number) =>
    describeStop(state, work, role, column, {
      row: rows.get(work.id) ?? 0,
      isCurrent: role === "milestone",
      // The milestone's parts are stops of their own, so the milestone covers only itself.
      scope: role === "part" ? (scopes.get(work.id) ?? [work]) : [work],
      leaves: role === "part" ? deliveryLeaves(state, work.id) : [],
    });
  const placed = [
    describe(milestone, "milestone", 0),
    ...parts.map((part) => describe(part, "part", 1 + (ranks.get(part.id) ?? 0))),
    ...[...successors.keys()].map((id) => describe(byId.get(id)!, "successor", 1 + nextColumn)),
  ];
  const links = [
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
  return [
    placed,
    links,
    2 + nextColumn,
    successors.size === 0 ? { column: 1 + nextColumn, row: milestoneRow } : null,
  ];
}

/** Pixels per planned-focus step. */
export const FOCUS_UNIT = 4;
/** Drawing weight for work whose focus is not set: structural, deliberately not zero. */
export const NEUTRAL_FOCUS = 3;
export const ROADMAP_BAR = 6;
const LABEL_ROOM = 44;
/** Above the top row and below the bottom one: an angled label rises or falls this far. */
const LABEL_EDGE = 76;

function focusWeight(work: QuestWork): number {
  return work.focus ?? NEUTRAL_FOCUS;
}

/**
 * Each ribbon carries the planned focus of the work it leads into. A stop with several incoming
 * ribbons divides its own focus among them, so a join never adds up to more than the work it
 * enters. A stop's outgoing side shows the focus it leads on to, independent of its own: shared
 * prerequisites neither multiply nor conserve investment, and bars show both sides when they differ.
 */
function arrange(
  placed: ReadonlyArray<PlacedStop>,
  links: ReadonlyArray<PlacedLink>,
  columns: number,
  /** Where the missing later milestone is shown, if it is. */
  gap: Gap | null,
  /** Width to fit into; null keeps the widest spacing. */
  available: number | null,
): Roadmap {
  const column =
    available === null || columns < 2
      ? ROADMAP_COLUMN
      : Math.min(
          ROADMAP_COLUMN,
          Math.max(
            ROADMAP_COLUMN_MIN,
            Math.floor((available - PADDING_X * 2 - ROADMAP_LABEL) / (columns - 1)),
          ),
        );
  const byId = new Map(placed.map((stop) => [stop.work.id, stop]));
  const incomingCount = new Map<string, number>();
  for (const link of links)
    incomingCount.set(link.target, (incomingCount.get(link.target) ?? 0) + 1);
  const linkWidth = (link: (typeof links)[number]) => {
    const target = byId.get(link.target)!;
    return (focusWeight(target.work) * FOCUS_UNIT) / (incomingCount.get(link.target) ?? 1);
  };
  const inHeight = new Map<string, number>();
  const outHeight = new Map<string, number>();
  for (const link of links) {
    const width = linkWidth(link);
    outHeight.set(link.source, (outHeight.get(link.source) ?? 0) + width);
    inHeight.set(link.target, (inHeight.get(link.target) ?? 0) + width);
  }
  const barHeight = (id: string) => {
    const own = focusWeight(byId.get(id)!.work) * FOCUS_UNIT;
    return Math.max(inHeight.get(id) ?? 0, outHeight.get(id) ?? 0, own);
  };
  const pitch = Math.max(...placed.map((stop) => barHeight(stop.work.id))) + LABEL_ROOM;
  const allRows = placed.map((stop) => stop.row);
  const minRow = Math.min(...allRows, gap?.row ?? Infinity);
  const maxRow = Math.max(...allRows, gap?.row ?? -Infinity);
  const top = LABEL_EDGE + pitch / 2;
  const yOf = (row: number) => top + (row - minRow) * pitch;
  const xOf = (index: number) => PADDING_X + index * column;

  const stops: Array<RoadmapStop> = placed.map((stop) => {
    const own = focusWeight(stop.work) * FOCUS_UNIT;
    return {
      ...stop,
      x: xOf(stop.column),
      y: yOf(stop.row),
      // A stop with nothing on one side still shows its own planned focus there.
      inHeight: inHeight.get(stop.work.id) ?? own,
      outHeight: outHeight.get(stop.work.id) ?? own,
    };
  });
  const stopsById = new Map(stops.map((stop) => [stop.work.id, stop]));
  // Ribbons stack on each side of a bar in the vertical order of their other ends.
  const offsets = new Map<string, { sourceY: number; targetY: number; width: number }>();
  const stackSide = (side: "source" | "target") => {
    for (const stop of stops) {
      const attached = links
        .filter((link) => link[side] === stop.work.id)
        .toSorted((a, b) => {
          const other = side === "source" ? "target" : "source";
          const ay = stopsById.get(a[other])!.y;
          const by = stopsById.get(b[other])!.y;
          return ay - by || a.id.localeCompare(b.id);
        });
      const height = side === "source" ? stop.outHeight : stop.inHeight;
      let cursor = stop.y - height / 2;
      for (const link of attached) {
        const width = linkWidth(link);
        const entry = offsets.get(link.id) ?? { sourceY: 0, targetY: 0, width };
        if (side === "source") entry.sourceY = cursor + width / 2;
        else entry.targetY = cursor + width / 2;
        offsets.set(link.id, entry);
        cursor += width;
      }
    }
  };
  stackSide("source");
  stackSide("target");
  const paths: Array<RoadmapPath> = links.map((link) => ({ ...link, ...offsets.get(link.id)! }));
  const lowest = Math.max(...stops.map((stop) => stop.y + barHeight(stop.work.id) / 2));
  return {
    column,
    stops,
    paths,
    gap: gap ? { x: xOf(gap.column), y: yOf(gap.row) } : null,
    width: PADDING_X * 2 + (columns - 1) * column + ROADMAP_LABEL,
    height: Math.max(lowest, yOf(maxRow)) + LABEL_EDGE + PADDING_Y,
  };
}

const SAMPLES = 24;

/**
 * A ribbon of constant perpendicular width along a cubic centreline with horizontal end tangents,
 * so it never narrows in the middle of a bend the way two offset curves do.
 */
export function ribbonD(x0: number, y0: number, x1: number, y1: number, width: number): string {
  const dx = (x1 - x0) / 2;
  const half = width / 2;
  const upper: Array<string> = [];
  const lower: Array<string> = [];
  for (let index = 0; index <= SAMPLES; index += 1) {
    const t = index / SAMPLES;
    const u = 1 - t;
    const x =
      u * u * u * x0 + 3 * u * u * t * (x0 + dx) + 3 * u * t * t * (x1 - dx) + t * t * t * x1;
    const y = u * u * u * y0 + 3 * u * u * t * y0 + 3 * u * t * t * y1 + t * t * t * y1;
    const tx = 3 * dx * (u * u + t * t);
    const ty = 6 * u * t * (y1 - y0);
    const length = Math.hypot(tx, ty) || 1;
    const nx = (-ty / length) * half;
    const ny = (tx / length) * half;
    upper.push(`${(x + nx).toFixed(2)} ${(y + ny).toFixed(2)}`);
    lower.push(`${(x - nx).toFixed(2)} ${(y - ny).toFixed(2)}`);
  }
  return `M ${upper.join(" L ")} L ${lower.toReversed().join(" L ")} Z`;
}

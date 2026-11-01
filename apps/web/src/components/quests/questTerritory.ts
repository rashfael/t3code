import type { QuestState, QuestWork } from "@t3tools/contracts";

/** Fixed drawing field; the SVG scales it to the available width. */
export const FIELD_WIDTH = 1000;
export const FIELD_HEIGHT = 620;
const COLUMNS = 40;
const ROWS = 25;
const SEED = 73031;

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Cell {
  readonly index: number;
  readonly site: Point;
  readonly polygon: ReadonlyArray<Point>;
}

/**
 * One seeded Voronoi partition of the field, built once per page load. Sites are a jittered grid,
 * so every cell only needs its two rings of neighbours; this is not a general Voronoi solver.
 */
function buildCells(): ReadonlyArray<Cell> {
  let seed = SEED;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const cw = FIELD_WIDTH / COLUMNS;
  const ch = FIELD_HEIGHT / ROWS;
  const sites: Array<Point> = [];
  for (let row = 0; row < ROWS; row += 1)
    for (let column = 0; column < COLUMNS; column += 1)
      sites.push({
        x: (column + 0.5 + (random() - 0.5) * 0.8) * cw,
        y: (row + 0.5 + (random() - 0.5) * 0.8) * ch,
      });
  return sites.map((site, index) => {
    const row = Math.floor(index / COLUMNS);
    const column = index % COLUMNS;
    let polygon: Array<Point> = [
      { x: 0, y: 0 },
      { x: FIELD_WIDTH, y: 0 },
      { x: FIELD_WIDTH, y: FIELD_HEIGHT },
      { x: 0, y: FIELD_HEIGHT },
    ];
    for (let r = Math.max(0, row - 2); r <= Math.min(ROWS - 1, row + 2); r += 1)
      for (let c = Math.max(0, column - 2); c <= Math.min(COLUMNS - 1, column + 2); c += 1) {
        const other = sites[r * COLUMNS + c]!;
        if (other === site) continue;
        // Keep the half-plane closer to `site`: a·p <= k on the bisector.
        const a = other.x - site.x;
        const b = other.y - site.y;
        const k = (other.x * other.x + other.y * other.y - site.x * site.x - site.y * site.y) / 2;
        polygon = clip(polygon, a, b, k);
      }
    return { index, site, polygon };
  });
}

function clip(polygon: ReadonlyArray<Point>, a: number, b: number, k: number): Array<Point> {
  const out: Array<Point> = [];
  for (let index = 0; index < polygon.length; index += 1) {
    const p = polygon[index]!;
    const q = polygon[(index + 1) % polygon.length]!;
    const u = a * p.x + b * p.y - k;
    const v = a * q.x + b * q.y - k;
    if (u <= 0) out.push(p);
    if (u <= 0 !== v <= 0) {
      const t = u / (u - v);
      out.push({ x: p.x + t * (q.x - p.x), y: p.y + t * (q.y - p.y) });
    }
  }
  return out;
}

let cachedCells: ReadonlyArray<Cell> | null = null;
function territoryCells(): ReadonlyArray<Cell> {
  cachedCells ??= buildCells();
  return cachedCells;
}

export interface Region {
  readonly work: QuestWork;
  readonly depth: number;
  readonly cells: ReadonlyArray<number>;
  /** Drawn subdivided into its parts. */
  readonly expanded: boolean;
  readonly childCount: number;
  /** Inside the region, nearest its middle: where its name goes. */
  readonly anchor: Point;
  /** Approximate width available for a label at the anchor. */
  readonly span: number;
  /** Inside the region at its top edge, where an expanded region names itself. */
  readonly crest: Point;
}

export interface Territory {
  readonly regions: ReadonlyArray<Region>;
  /** Visible work that got no cell because its region was already too small; Outline lists it. */
  readonly undrawn: ReadonlyArray<QuestWork>;
  /** Work in the scope that no parent chain reaches (missing or cyclic parents). */
  readonly unreachable: ReadonlyArray<QuestWork>;
}

interface Item {
  readonly work: QuestWork;
  readonly weight: number;
}

/**
 * Nested regions below `rootIds`: each item's cells split among its parts by halving along the
 * longer side, prerequisites first. Size follows subtree record count, never effort, and the same
 * inputs always give the same regions.
 */
export function layoutTerritory(
  state: QuestState,
  expanded: ReadonlySet<string>,
  rootIds: ReadonlyArray<string>,
): Territory {
  const cells = territoryCells();
  const byId = new Map(state.work.map((item) => [item.id, item]));
  const children = new Map<string, Array<QuestWork>>();
  for (const item of state.work) {
    if (item.parentId === null || !byId.has(item.parentId)) continue;
    const list = children.get(item.parentId) ?? [];
    list.push(item);
    children.set(item.parentId, list);
  }
  const sizes = new Map<string, number>();
  const sizeOf = (id: string, seen: Set<string>): number => {
    const known = sizes.get(id);
    if (known !== undefined) return known;
    if (seen.has(id)) return 1;
    seen.add(id);
    const size = 1 + (children.get(id) ?? []).reduce((sum, part) => sum + sizeOf(part.id, seen), 0);
    sizes.set(id, size);
    return size;
  };

  const regions: Array<Region> = [];
  const undrawn: Array<QuestWork> = [];
  const placed = new Set<string>();

  const assign = (items: ReadonlyArray<Item>, pool: ReadonlyArray<number>, depth: number) => {
    const shares = split(items, pool, cells);
    items.forEach((item, index) => {
      const share = shares[index]!;
      placed.add(item.work.id);
      if (share.length === 0) {
        undrawn.push(item.work);
        markUndrawn(item.work.id);
        return;
      }
      const parts = (children.get(item.work.id) ?? []).filter((part) => !placed.has(part.id));
      const isOpen = parts.length > 0 && expanded.has(item.work.id);
      regions.push(describeRegion(item.work, depth, share, isOpen, parts.length, cells));
      if (isOpen)
        assign(
          orderSiblings(state, parts, byId).map((part) => ({
            work: part,
            weight: sizeOf(part.id, new Set()),
          })),
          share,
          depth + 1,
        );
    });
  };
  // Hidden descendants are accounted for by their collapsed ancestor, not listed as undrawn.
  const markUndrawn = (id: string) => {
    for (const part of children.get(id) ?? []) {
      if (placed.has(part.id)) continue;
      placed.add(part.id);
      if (expanded.has(id)) undrawn.push(part);
      markUndrawn(part.id);
    }
  };

  const roots = rootIds.map((id) => byId.get(id)).filter((item) => item !== undefined);
  assign(
    orderSiblings(state, roots, byId).map((work) => ({ work, weight: sizeOf(work.id, new Set()) })),
    cells.map((cell) => cell.index),
    0,
  );

  // Everything under the scope, whether shown, folded or undrawn, is reachable from its roots.
  const reachable = new Set<string>();
  const visit = (id: string) => {
    if (reachable.has(id)) return;
    reachable.add(id);
    for (const part of children.get(id) ?? []) visit(part.id);
  };
  for (const root of roots) visit(root.id);
  const wholeQuest =
    roots.length > 0 && roots.every((root) => root.parentId === null || !byId.has(root.parentId));
  return {
    regions,
    undrawn,
    unreachable: wholeQuest ? state.work.filter((item) => !reachable.has(item.id)) : [],
  };
}

/** Siblings ordered by the longest chain of recorded `follows` among them, then saved order. */
function orderSiblings(
  state: QuestState,
  siblings: ReadonlyArray<QuestWork>,
  byId: ReadonlyMap<string, QuestWork>,
): ReadonlyArray<QuestWork> {
  const ids = new Set(siblings.map((item) => item.id));
  const siblingOf = (id: string): string | null => {
    const seen = new Set<string>();
    let current = byId.get(id);
    while (current && !seen.has(current.id)) {
      if (ids.has(current.id)) return current.id;
      seen.add(current.id);
      current = current.parentId === null ? undefined : byId.get(current.parentId);
    }
    return null;
  };
  const before = new Map<string, Set<string>>();
  for (const relation of state.relations) {
    if (relation.type !== "follows") continue;
    const later = siblingOf(relation.from);
    const earlier = siblingOf(relation.to);
    if (later === null || earlier === null || later === earlier) continue;
    const set = before.get(later) ?? new Set();
    set.add(earlier);
    before.set(later, set);
  }
  const ranks = new Map<string, number>();
  const rankOf = (id: string, visiting: Set<string>): number => {
    const known = ranks.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    let rank = 0;
    for (const earlier of before.get(id) ?? [])
      rank = Math.max(rank, rankOf(earlier, visiting) + 1);
    visiting.delete(id);
    ranks.set(id, rank);
    return rank;
  };
  return siblings
    .map((item, index) => ({ item, index, rank: rankOf(item.id, new Set()) }))
    .toSorted((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ item }) => item);
}

/** Splits `pool` among `items` in order, by weight, halving along the longer side each time. */
function split(
  items: ReadonlyArray<Item>,
  pool: ReadonlyArray<number>,
  cells: ReadonlyArray<Cell>,
): Array<ReadonlyArray<number>> {
  if (items.length === 0) return [];
  if (items.length === 1) return [pool];
  if (pool.length < items.length) {
    // Too small to give everyone a cell: the first items get one each, the rest none.
    return items.map((_, index) => (index < pool.length ? [pool[index]!] : []));
  }
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  let cut = 1;
  let best = Infinity;
  let running = 0;
  for (let index = 0; index < items.length - 1; index += 1) {
    running += items[index]!.weight;
    const distance = Math.abs(running - total / 2);
    if (distance < best) {
      best = distance;
      cut = index + 1;
    }
  }
  const first = items.slice(0, cut);
  const rest = items.slice(cut);
  const firstWeight = first.reduce((sum, item) => sum + item.weight, 0);
  const xs = pool.map((index) => cells[index]!.site.x);
  const ys = pool.map((index) => cells[index]!.site.y);
  const alongX = Math.max(...xs) - Math.min(...xs) >= Math.max(...ys) - Math.min(...ys);
  const ordered = pool.toSorted((a, b) => {
    const pa = cells[a]!.site;
    const pb = cells[b]!.site;
    return (alongX ? pa.x - pb.x || pa.y - pb.y : pa.y - pb.y || pa.x - pb.x) || a - b;
  });
  const count = Math.min(
    pool.length - rest.length,
    Math.max(first.length, Math.round((pool.length * firstWeight) / total)),
  );
  return [
    ...split(first, ordered.slice(0, count), cells),
    ...split(rest, ordered.slice(count), cells),
  ];
}

function describeRegion(
  work: QuestWork,
  depth: number,
  share: ReadonlyArray<number>,
  expanded: boolean,
  childCount: number,
  cells: ReadonlyArray<Cell>,
): Region {
  const sites = share.map((index) => cells[index]!.site);
  const mean = {
    x: sites.reduce((sum, site) => sum + site.x, 0) / sites.length,
    y: sites.reduce((sum, site) => sum + site.y, 0) / sites.length,
  };
  // The site nearest the mean always lies inside the region, unlike the mean of a curved region.
  const anchor = sites.reduce((best, site) =>
    Math.hypot(site.x - mean.x, site.y - mean.y) < Math.hypot(best.x - mean.x, best.y - mean.y)
      ? site
      : best,
  );
  const row = sites.filter((site) => Math.abs(site.y - anchor.y) < FIELD_HEIGHT / ROWS);
  const span = Math.max(...row.map((site) => site.x)) - Math.min(...row.map((site) => site.x));
  const topY = Math.min(...sites.map((site) => site.y));
  const crest = sites
    .filter((site) => site.y - topY < FIELD_HEIGHT / ROWS)
    .reduce((best, site) => (Math.abs(site.x - mean.x) < Math.abs(best.x - mean.x) ? site : best));
  return {
    crest,
    work,
    depth,
    cells: share,
    expanded,
    childCount,
    anchor,
    span: span + FIELD_WIDTH / COLUMNS,
  };
}

/** SVG path data filling every cell of a region. */
export function cellsPath(share: ReadonlyArray<number>): string {
  const cells = territoryCells();
  return share
    .map((index) => {
      const polygon = cells[index]!.polygon;
      return `M ${polygon.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" L ")} Z`;
    })
    .join(" ");
}

/** SVG path data for a region's outer boundary: cell edges not shared by two of its cells. */
export function boundaryPath(share: ReadonlyArray<number>): string {
  const cells = territoryCells();
  const edges = new Map<string, readonly [Point, Point]>();
  const key = (p: Point) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
  for (const index of share) {
    const polygon = cells[index]!.polygon;
    for (let i = 0; i < polygon.length; i += 1) {
      const a = polygon[i]!;
      const b = polygon[(i + 1) % polygon.length]!;
      const id = [key(a), key(b)].toSorted().join(":");
      if (edges.has(id)) edges.delete(id);
      else edges.set(id, [a, b]);
    }
  }
  return [...edges.values()]
    .map(([a, b]) => `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} L ${b.x.toFixed(1)} ${b.y.toFixed(1)}`)
    .join(" ");
}

export interface TerritoryLink {
  readonly id: string;
  readonly type: "follows" | "retries";
  /** Anchors of the shown regions holding the earlier and the later work. */
  readonly from: Point;
  readonly to: Point;
  readonly viaAncestor: boolean;
}

/**
 * Recorded relations touching the region that shows `activeId`, drawn between the regions that
 * show each end. Only one region's relations at a time, so the map never becomes a web of lines.
 */
export function territoryLinks(
  state: QuestState,
  territory: Territory,
  activeId: string | null,
): ReadonlyArray<TerritoryLink> {
  if (activeId === null) return [];
  const byId = new Map(state.work.map((item) => [item.id, item]));
  // Leaves first, so work inside an expanded region resolves to its deepest shown region.
  const shown = new Map<string, Region>();
  for (const region of territory.regions) if (!region.expanded) shown.set(region.work.id, region);
  for (const region of territory.regions)
    if (!shown.has(region.work.id)) shown.set(region.work.id, region);
  const shownOf = (id: string): Region | null => {
    const seen = new Set<string>();
    let current = byId.get(id);
    while (current && !seen.has(current.id)) {
      const region = shown.get(current.id);
      if (region) return region;
      seen.add(current.id);
      current = current.parentId === null ? undefined : byId.get(current.parentId);
    }
    return null;
  };
  const active = shownOf(activeId);
  if (!active) return [];
  const within = (region: Region) => {
    let current: QuestWork | undefined = region.work;
    const seen = new Set<string>();
    while (current && !seen.has(current.id)) {
      if (current.id === active.work.id) return true;
      seen.add(current.id);
      current = current.parentId === null ? undefined : byId.get(current.parentId);
    }
    return false;
  };
  return state.relations.flatMap((relation) => {
    const earlier = shownOf(relation.to);
    const later = shownOf(relation.from);
    if (!earlier || !later || earlier === later) return [];
    if (!within(earlier) && !within(later)) return [];
    return [
      {
        id: relation.id,
        type: relation.type,
        from: earlier.anchor,
        to: later.anchor,
        viaAncestor: earlier.work.id !== relation.to || later.work.id !== relation.from,
      },
    ];
  });
}

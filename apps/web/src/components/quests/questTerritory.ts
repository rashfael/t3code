import type { QuestState, QuestWork } from "@t3tools/contracts";

import type { MapEffect } from "./questMapEffects";

const SPACING = 26;
const RINGS = 20;
const SEED = 73031;
/** Bounds how often a closed-in region may take a sibling's cell during one growth. */
const STEAL_LIMIT = 64;

export interface Point {
  readonly x: number;
  readonly y: number;
}

interface Site extends Point {
  readonly q: number;
  readonly r: number;
}

const DIRECTIONS = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
] as const;

/**
 * One seeded field of jittered hexagonal sites, built once per page load. It has no edge anyone
 * sees: only claimed cells are drawn, so the map's outline is the union of its regions.
 */
function buildSites() {
  let seed = SEED;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const sites: Array<Site> = [];
  const index = new Map<string, number>();
  for (let q = -RINGS; q <= RINGS; q += 1)
    for (let r = Math.max(-RINGS, -q - RINGS); r <= Math.min(RINGS, -q + RINGS); r += 1) {
      index.set(`${q},${r}`, sites.length);
      sites.push({
        q,
        r,
        x: SPACING * (q + r / 2) + (random() - 0.5) * SPACING * 0.5,
        y: ((SPACING * Math.sqrt(3)) / 2) * r + (random() - 0.5) * SPACING * 0.5,
      });
    }
  const neighbours = sites.map((site) =>
    DIRECTIONS.map(([dq, dr]) => index.get(`${site.q + dq},${site.r + dr}`)).filter(
      (other) => other !== undefined,
    ),
  );
  const centre = index.get("0,0")!;
  return { sites, index, neighbours, centre };
}

let cachedField: ReturnType<typeof buildSites> | null = null;
function field() {
  cachedField ??= buildSites();
  return cachedField;
}

const polygons = new Map<number, ReadonlyArray<Point>>();
/** A site's Voronoi cell: a large hexagon clipped by the bisectors of its two rings of neighbours. */
function polygonOf(cell: number): ReadonlyArray<Point> {
  const known = polygons.get(cell);
  if (known) return known;
  const { sites, index } = field();
  const site = sites[cell]!;
  let polygon: Array<Point> = Array.from({ length: 6 }, (_, corner) => {
    const angle = (Math.PI / 3) * corner + Math.PI / 6;
    return { x: site.x + 2 * SPACING * Math.cos(angle), y: site.y + 2 * SPACING * Math.sin(angle) };
  });
  for (let dq = -2; dq <= 2; dq += 1)
    for (let dr = Math.max(-2, -dq - 2); dr <= Math.min(2, -dq + 2); dr += 1) {
      const other = index.get(`${site.q + dq},${site.r + dr}`);
      if (other === undefined || other === cell) continue;
      const o = sites[other]!;
      // Keep the half-plane closer to `site`: a·p <= k on the bisector.
      const a = o.x - site.x;
      const b = o.y - site.y;
      const k = (o.x * o.x + o.y * o.y - site.x * site.x - site.y * site.y) / 2;
      polygon = clip(polygon, a, b, k);
    }
  polygons.set(cell, polygon);
  return polygon;
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

export function sitePoint(cell: number): Point {
  return field().sites[cell]!;
}

export function areNeighbours(a: number, b: number): boolean {
  return field().neighbours[a]!.includes(b);
}

export interface Region {
  readonly work: QuestWork;
  readonly depth: number;
  readonly cells: ReadonlyArray<number>;
  /** Drawn subdivided into its parts. */
  readonly expanded: boolean;
  readonly childCount: number;
  /** Where the region started growing; its results fill outward from here. */
  readonly seed: Point;
  /** Inside the region, nearest its middle: where its name goes. */
  readonly anchor: Point;
  /** Approximate width available for a label at the anchor. */
  readonly span: number;
  /** Inside the region at its top edge, where an expanded region names itself. */
  readonly crest: Point;
}

/**
 * What one cell shows. `effect`: one result effect. `aggregate`: several effects of one coarse
 * result, shown together while their scope is folded. `reference`: effects that also touch this
 * scope but whose filled cells are in one other scope (or are carried by finer effects).
 */
export interface PlacedUnit {
  /** Derived from semantic ids and scope, so a pin or hover survives relayout. */
  readonly key: string;
  readonly kind: "effect" | "aggregate" | "reference";
  readonly cell: number;
  readonly workId: string;
  readonly effects: ReadonlyArray<MapEffect>;
  readonly planned: boolean;
}

export interface Territory {
  readonly regions: ReadonlyArray<Region>;
  readonly units: ReadonlyArray<PlacedUnit>;
  /** Visible work that got no cell; Outline lists it. */
  readonly undrawn: ReadonlyArray<QuestWork>;
  /** Work in the scope that no parent chain reaches (missing or cyclic parents). */
  readonly unreachable: ReadonlyArray<QuestWork>;
  /** Effects whose work is not in this scope or names no work. */
  readonly unplaced: ReadonlyArray<MapEffect>;
  readonly bounds: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
}

interface UnitDraft {
  readonly key: string;
  readonly kind: PlacedUnit["kind"];
  readonly effects: ReadonlyArray<MapEffect>;
  readonly planned: boolean;
}

interface Node {
  readonly work: QuestWork;
  readonly depth: number;
  readonly parts: ReadonlyArray<Node>;
  readonly open: boolean;
  readonly childCount: number;
  /** Units drawn in this node's own ground: all of its subtree's when folded, its own when open. */
  readonly units: ReadonlyArray<UnitDraft>;
  readonly quota: number;
}

/**
 * Nested regions below `rootIds`, grown on the shared field. A region's size follows the effects
 * and rough planned scope it shows, never effort; a folded region contracts to one cell per coarse
 * result. The same inputs always give the same regions.
 */
export function layoutTerritory(
  state: QuestState,
  effects: ReadonlyArray<MapEffect>,
  expanded: ReadonlySet<string>,
  rootIds: ReadonlyArray<string>,
): Territory {
  const byId = new Map(state.work.map((item) => [item.id, item]));
  const children = new Map<string, Array<QuestWork>>();
  for (const item of state.work) {
    if (item.parentId === null || !byId.has(item.parentId)) continue;
    children.set(item.parentId, [...(children.get(item.parentId) ?? []), item]);
  }
  const effectById = new Map(effects.map((effect) => [effect.id, effect]));
  const rootEffect = (effect: MapEffect) => {
    let current = effect;
    const seen = new Set([current.id]);
    while (current.parentId) {
      const parent = effectById.get(current.parentId);
      if (!parent || seen.has(parent.id)) break;
      seen.add(parent.id);
      current = parent;
    }
    return current;
  };
  const homed = new Map<string, Array<MapEffect>>();
  const referenced = new Map<string, Array<MapEffect>>();
  for (const effect of effects) {
    if (effect.homeWorkId === null) continue;
    // A refined result is carried by its finer effects; it only marks where it applies.
    const carried = effect.childIds.length > 0;
    if (!carried) homed.set(effect.homeWorkId, [...(homed.get(effect.homeWorkId) ?? []), effect]);
    for (const id of carried ? [effect.homeWorkId, ...effect.alsoWorkIds] : effect.alsoWorkIds)
      referenced.set(id, [...(referenced.get(id) ?? []), effect]);
  }

  const placed = new Set<string>();
  const shownEffects = new Set<string>();
  const build = (work: QuestWork, depth: number): Node => {
    placed.add(work.id);
    const parts = (children.get(work.id) ?? []).filter((part) => !placed.has(part.id));
    const open = parts.length > 0 && expanded.has(work.id);
    if (open) {
      const nodes = orderSiblings(state, parts, byId).map((part) => build(part, depth + 1));
      const units = unitsFor(work, [work.id], false);
      return {
        work,
        depth,
        parts: nodes,
        open,
        childCount: parts.length,
        units,
        quota: units.length + nodes.reduce((sum, node) => sum + node.quota, 0),
      };
    }
    // Hidden descendants are accounted for by their folded ancestor and show their results there.
    const subtree = [work.id];
    const collect = (id: string) => {
      for (const part of children.get(id) ?? []) {
        if (placed.has(part.id)) continue;
        placed.add(part.id);
        subtree.push(part.id);
        collect(part.id);
      }
    };
    collect(work.id);
    const units = unitsFor(work, subtree, parts.length > 0);
    const reserve =
      units.some((unit) => unit.kind !== "reference") || work.state === "done"
        ? work.state === "done"
          ? 0
          : 2
        : 3;
    return {
      work,
      depth,
      parts: [],
      open,
      childCount: parts.length,
      units,
      quota: Math.max(1, units.length + reserve),
    };
  };
  const unitsFor = (work: QuestWork, ids: ReadonlyArray<string>, folded: boolean) => {
    const own = ids.flatMap((id) => homed.get(id) ?? []);
    for (const effect of own) shownEffects.add(effect.id);
    const drafts: Array<UnitDraft> = [];
    if (folded) {
      const groups = new Map<string, Array<MapEffect>>();
      for (const effect of own) {
        // A finer effect groups under its coarse result; otherwise under the folded part holding it.
        const group = effect.parentId
          ? rootEffect(effect).id
          : effect.homeWorkId !== work.id
            ? `scope:${effect.homeWorkId}`
            : effect.id;
        const key = `${effect.planned ? "planned:" : ""}${group}`;
        groups.set(key, [...(groups.get(key) ?? []), effect]);
      }
      for (const [key, members] of groups)
        drafts.push(
          members.length === 1
            ? {
                key: members[0]!.id,
                kind: "effect",
                effects: members,
                planned: members[0]!.planned,
              }
            : {
                key: `group:${work.id}:${key}`,
                kind: "aggregate",
                effects: members,
                planned: members.every((member) => member.planned),
              },
        );
    } else {
      for (const effect of own)
        drafts.push({ key: effect.id, kind: "effect", effects: [effect], planned: effect.planned });
    }
    // Delivered results first, so they fill the region's core and planned scope its outer edge.
    drafts.sort((a, b) => Number(a.planned) - Number(b.planned));
    const ownIds = new Set(own.map((effect) => effect.id));
    // One reference per scope the results are recorded in, so membership never inflates an area.
    const references = new Map<string, Array<MapEffect>>();
    for (const id of ids)
      for (const effect of referenced.get(id) ?? []) {
        if (ownIds.has(effect.id) || effect.childIds.some((child) => ownIds.has(child))) continue;
        const home = effect.homeWorkId!;
        const list = references.get(home) ?? [];
        if (!list.includes(effect)) list.push(effect);
        references.set(home, list);
      }
    for (const [home, members] of references)
      drafts.push({
        key: `ref:${work.id}:${home}`,
        kind: "reference",
        effects: members,
        planned: members.every((member) => member.planned),
      });
    return drafts;
  };

  const roots = rootIds.map((id) => byId.get(id)).filter((item) => item !== undefined);
  const tree = orderSiblings(state, roots, byId).map((root) => build(root, 0));

  const { sites, centre } = field();
  const regions: Array<Region> = [];
  const units: Array<PlacedUnit> = [];
  const undrawn: Array<QuestWork> = [];
  const place = (node: Node, cells: ReadonlyArray<number>, seed: number) => {
    if (cells.length === 0) {
      undrawn.push(node.work);
      return;
    }
    regions.push(describeRegion(node, cells, seed));
    let ownCells = cells;
    if (node.open) {
      const shares = grow(
        [
          ...node.parts.map((part) => ({ key: part.work.id, quota: part.quota })),
          ...(node.units.length > 0 ? [{ key: "#own", quota: node.units.length }] : []),
        ],
        prerequisites(state, node.parts, byId),
        new Set(cells),
        sites[seed]!,
      );
      for (const part of node.parts) {
        const share = shares.get(part.work.id);
        place(part, share?.cells ?? [], share?.seed ?? seed);
      }
      ownCells = shares.get("#own")?.cells ?? [];
    }
    const origin = sites[seed]!;
    const ordered = ownCells.toSorted(
      (a, b) => distance(sites[a]!, origin) - distance(sites[b]!, origin) || a - b,
    );
    node.units.forEach((unit, index) => {
      const cell = ordered[index];
      if (cell === undefined) return;
      units.push({ ...unit, cell, workId: node.work.id });
    });
  };
  const top = grow(
    tree.map((node) => ({ key: node.work.id, quota: node.quota })),
    prerequisites(state, tree, byId),
    null,
    sites[centre]!,
  );
  for (const node of tree) {
    const share = top.get(node.work.id);
    place(node, share?.cells ?? [], share?.seed ?? centre);
  }

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
  const drawnCells = regions.flatMap((region) => (region.depth === 0 ? region.cells : []));
  const points = drawnCells.flatMap((cell) => polygonOf(cell));
  const minX = Math.min(...points.map((p) => p.x));
  const minY = Math.min(...points.map((p) => p.y));
  const maxX = Math.max(...points.map((p) => p.x));
  const maxY = Math.max(...points.map((p) => p.y));
  const pad = SPACING;
  return {
    regions,
    units,
    undrawn,
    unreachable: wholeQuest ? state.work.filter((item) => !reachable.has(item.id)) : [],
    unplaced: effects.filter(
      (effect) => effect.childIds.length === 0 && !shownEffects.has(effect.id),
    ),
    bounds:
      points.length === 0
        ? { x: -100, y: -60, width: 200, height: 120 }
        : {
            x: minX - pad,
            y: minY - pad,
            width: maxX - minX + 2 * pad,
            height: maxY - minY + 2 * pad,
          },
  };
}

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** For each sibling, the earlier siblings it follows through recorded `follows` relations. */
function prerequisites(
  state: QuestState,
  nodes: ReadonlyArray<Node>,
  byId: ReadonlyMap<string, QuestWork>,
): ReadonlyMap<string, ReadonlyArray<string>> {
  const ids = new Set(nodes.map((node) => node.work.id));
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
  const order = nodes.map((node) => node.work.id);
  const before = new Map<string, Array<string>>();
  for (const relation of state.relations) {
    if (relation.type !== "follows") continue;
    const later = siblingOf(relation.from);
    const earlier = siblingOf(relation.to);
    if (later === null || earlier === null || later === earlier) continue;
    // orderSiblings put prerequisites first; a cycle keeps saved order and ignores the back edge.
    if (order.indexOf(earlier) > order.indexOf(later)) continue;
    const list = before.get(later) ?? [];
    if (!list.includes(earlier)) list.push(earlier);
    before.set(later, list);
  }
  return before;
}

interface Share {
  readonly cells: ReadonlyArray<number>;
  readonly seed: number;
}

/**
 * Grows each group to its quota, one cell at a time, the least-grown group first. Independent
 * groups start around `origin`; a group that follows others starts on their outer edge, so
 * dependent scope lies further out. `pool` confines growth to a parent's ground.
 */
function grow(
  groups: ReadonlyArray<{ readonly key: string; readonly quota: number }>,
  after: ReadonlyMap<string, ReadonlyArray<string>>,
  pool: ReadonlySet<number> | null,
  origin: Point,
): Map<string, Share> {
  const { sites, neighbours } = field();
  const claimed = new Set<number>();
  const result = new Map<string, { cells: Array<number>; seed: number; sum: Point }>();
  const free = (cell: number) => !claimed.has(cell) && (pool === null || pool.has(cell));
  const candidates = pool ? [...pool] : sites.map((_, index) => index);
  const nearestFree = (point: Point) => {
    let best = -1;
    let bestDistance = Infinity;
    for (const cell of candidates) {
      if (!free(cell)) continue;
      const d = distance(sites[cell]!, point);
      if (d < bestDistance - 1e-9) {
        best = cell;
        bestDistance = d;
      }
    }
    return best;
  };
  const owner = new Map<number, string>();
  const claim = (key: string, cell: number) => {
    claimed.add(cell);
    owner.set(cell, key);
    const entry = result.get(key);
    const site = sites[cell]!;
    if (entry) {
      entry.cells.push(cell);
      entry.sum = { x: entry.sum.x + site.x, y: entry.sum.y + site.y };
    } else result.set(key, { cells: [cell], seed: cell, sum: { x: site.x, y: site.y } });
  };
  /**
   * A group closed in by its neighbours grows by pushing: along the shortest path of claimed
   * cells to a free one, each owner gives up its cell on the path and takes the next, so every
   * group keeps its size and the closed-in group gains a touching cell instead of an island.
   * A push that would split any group is not taken.
   */
  const push = (key: string): boolean => {
    const own = result.get(key)!;
    const from = new Map<number, number>();
    const queue: Array<number> = [];
    for (const cell of own.cells)
      for (const next of neighbours[cell]!)
        if (owner.has(next) && owner.get(next) !== key && !from.has(next)) {
          from.set(next, -1);
          queue.push(next);
        }
    for (let index = 0; index < queue.length; index += 1) {
      const at = queue[index]!;
      for (const next of neighbours[at]!) {
        if (from.has(next) || owner.get(next) === key) continue;
        if (pool !== null && !pool.has(next)) continue;
        from.set(next, at);
        if (owner.has(next)) {
          queue.push(next);
          continue;
        }
        const path: Array<number> = [];
        for (let cell = next; cell !== -1; cell = from.get(cell)!) path.unshift(cell);
        const moves = path.map(
          (cell, step) => [cell, step === 0 ? key : owner.get(path[step - 1]!)!] as const,
        );
        const groups = new Set(moves.map(([, group]) => group));
        const cellsAfter = (group: string) => [
          ...result.get(group)!.cells.filter((cell) => !path.includes(cell)),
          ...moves.filter(([, to]) => to === group).map(([cell]) => cell),
        ];
        if (
          [...groups].some(
            (group) =>
              piecesOf(cellsAfter(group), neighbours).length >
              piecesOf(result.get(group)!.cells, neighbours).length,
          )
        )
          continue;
        for (const group of groups) {
          const entry = result.get(group)!;
          entry.cells = cellsAfter(group);
          if (!entry.cells.includes(entry.seed)) entry.seed = entry.cells[0]!;
          entry.sum = entry.cells.reduce(
            (sum, cell) => ({ x: sum.x + sites[cell]!.x, y: sum.y + sites[cell]!.y }),
            { x: 0, y: 0 },
          );
        }
        for (const [cell, group] of moves) owner.set(cell, group);
        claimed.add(next);
        return true;
      }
    }
    return false;
  };
  /**
   * Last resort before an island: take a touching cell from a sibling of this or an earlier wave
   * that stays in one piece without it. That sibling then regrows by the same rules.
   */
  const steal = (key: string, members: ReadonlyArray<{ readonly key: string }>): boolean => {
    const growing = new Set(members.map((member) => member.key));
    const own = result.get(key)!;
    for (const cell of own.cells)
      for (const next of neighbours[cell]!) {
        const other = owner.get(next);
        if (other === undefined || other === key || !growing.has(other)) continue;
        const entry = result.get(other)!;
        const rest = entry.cells.filter((item) => item !== next);
        if (rest.length === 0 || piecesOf(rest, neighbours).length > 1) continue;
        entry.cells = rest;
        if (entry.seed === next) entry.seed = rest[0]!;
        entry.sum = { x: entry.sum.x - sites[next]!.x, y: entry.sum.y - sites[next]!.y };
        own.cells.push(next);
        own.sum = { x: own.sum.x + sites[next]!.x, y: own.sum.y + sites[next]!.y };
        owner.set(next, key);
        return true;
      }
    return false;
  };
  let steals = 0;
  const waves = new Map<string, number>();
  const waveOf = (key: string, seen: Set<string>): number => {
    const known = waves.get(key);
    if (known !== undefined) return known;
    if (seen.has(key)) return 0;
    seen.add(key);
    const wave = Math.max(-1, ...(after.get(key) ?? []).map((id) => waveOf(id, seen))) + 1;
    waves.set(key, wave);
    return wave;
  };
  const active = groups.filter((group) => group.quota > 0);
  const maxWave = Math.max(0, ...active.map((group) => waveOf(group.key, new Set())));
  for (let wave = 0; wave <= maxWave; wave += 1) {
    const members = active.filter((group) => waveOf(group.key, new Set()) === wave);
    const independent = members.filter((group) => (after.get(group.key) ?? []).length === 0);
    // Independent groups seed around the origin; inside a parent, as far apart as its ground allows.
    independent.forEach((group, index) => {
      let seed: number;
      if (pool === null) {
        const angle = -Math.PI / 2 + (2 * Math.PI * index) / independent.length;
        const radius = independent.length > 1 ? SPACING * 1.6 : 0;
        seed = nearestFree({
          x: origin.x + radius * Math.cos(angle),
          y: origin.y + radius * Math.sin(angle),
        });
      } else if (index === 0 && result.size === 0) seed = nearestFree(origin);
      else {
        const seeds = [...result.values()].map((entry) => sites[entry.seed]!);
        let best = -1;
        let bestScore = -Infinity;
        for (const cell of candidates) {
          if (!free(cell)) continue;
          const score = Math.min(...seeds.map((point) => distance(point, sites[cell]!)));
          if (score > bestScore + 1e-9) {
            best = cell;
            bestScore = score;
          }
        }
        seed = best;
      }
      if (seed >= 0) claim(group.key, seed);
    });
    for (const group of members) {
      if (result.has(group.key)) continue;
      // Start on the prerequisites' outward edge (beyond their middle ring), as close in as that
      // allows, so a chain wraps around the landmass instead of growing a spoke.
      const earlierCells = (after.get(group.key) ?? []).flatMap(
        (earlier) => result.get(earlier)?.cells ?? [],
      );
      const ring =
        earlierCells.reduce((sum, cell) => sum + distance(sites[cell]!, origin), 0) /
        Math.max(1, earlierCells.length);
      let best = -1;
      let bestScore = Infinity;
      for (const cell of earlierCells)
        for (const next of neighbours[cell]!) {
          if (!free(next)) continue;
          const reach = distance(sites[next]!, origin);
          const score = reach >= ring ? reach : reach + 1e6;
          if (score < bestScore - 1e-9) {
            best = next;
            bestScore = score;
          }
        }
      if (best < 0) best = nearestFree(origin);
      if (best >= 0) claim(group.key, best);
    }
    // Earlier waves may have lent a cell to a closed-in group; they regrow with this wave.
    const reached = active.filter((group) => waveOf(group.key, new Set()) <= wave);
    for (;;) {
      const growing = reached
        .filter((group) => {
          const entry = result.get(group.key);
          return entry !== undefined && entry.cells.length < group.quota;
        })
        .toSorted(
          (a, b) =>
            result.get(a.key)!.cells.length / a.quota - result.get(b.key)!.cells.length / b.quota,
        );
      const group = growing[0];
      if (!group) break;
      const entry = result.get(group.key)!;
      const centroid = { x: entry.sum.x / entry.cells.length, y: entry.sum.y / entry.cells.length };
      let best = -1;
      let bestScore = Infinity;
      for (const cell of entry.cells)
        for (const next of neighbours[cell]!) {
          if (!free(next)) continue;
          // Compact around its own middle, and pulled toward the origin so the whole stays dense.
          const score =
            distance(sites[next]!, centroid) + 0.6 * distance(sites[next]!, origin) + next * 1e-9;
          if (score < bestScore) {
            best = next;
            bestScore = score;
          }
        }
      if (best < 0 && push(group.key)) continue;
      if (best < 0 && steals < STEAL_LIMIT && steal(group.key, reached)) {
        steals += 1;
        continue;
      }
      if (best < 0) best = nearestFree(centroid);
      if (best < 0) break;
      claim(group.key, best);
    }
  }
  return new Map(
    [...result].map(([key, entry]) => [key, { cells: entry.cells, seed: entry.seed }]),
  );
}

function piecesOf(
  cells: ReadonlyArray<number>,
  neighbours: ReadonlyArray<ReadonlyArray<number>>,
): Array<Array<number>> {
  const left = new Set(cells);
  const pieces: Array<Array<number>> = [];
  for (const start of cells) {
    if (!left.has(start)) continue;
    left.delete(start);
    const piece = [start];
    for (let index = 0; index < piece.length; index += 1)
      for (const next of neighbours[piece[index]!]!) if (left.delete(next)) piece.push(next);
    pieces.push(piece);
  }
  return pieces;
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

function describeRegion(node: Node, cells: ReadonlyArray<number>, seedCell: number): Region {
  const { sites } = field();
  const points = cells.map((index) => sites[index]!);
  const mean = {
    x: points.reduce((sum, site) => sum + site.x, 0) / points.length,
    y: points.reduce((sum, site) => sum + site.y, 0) / points.length,
  };
  // The site nearest the mean always lies inside the region, unlike the mean of a curved region.
  const anchor = points.reduce((best, site) =>
    distance(site, mean) < distance(best, mean) ? site : best,
  );
  const row = points.filter((site) => Math.abs(site.y - anchor.y) < SPACING * 0.6);
  const span = Math.max(...row.map((site) => site.x)) - Math.min(...row.map((site) => site.x));
  const topY = Math.min(...points.map((site) => site.y));
  const crest = points
    .filter((site) => site.y - topY < SPACING * 0.8)
    .reduce((best, site) => (Math.abs(site.x - mean.x) < Math.abs(best.x - mean.x) ? site : best));
  return {
    work: node.work,
    depth: node.depth,
    cells,
    expanded: node.open,
    childCount: node.childCount,
    seed: sites[seedCell]!,
    anchor,
    span: span + SPACING,
    crest,
  };
}

function polygonPath(cell: number) {
  const polygon = polygonOf(cell);
  return `M ${polygon.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" L ")} Z`;
}

/** SVG path data filling every listed cell. */
export function cellsPath(cells: ReadonlyArray<number>): string {
  return cells.map(polygonPath).join(" ");
}

/** SVG path data for the outer boundary of a set of cells: edges not shared by two of them. */
export function boundaryPath(cells: ReadonlyArray<number>): string {
  const edges = new Map<string, readonly [Point, Point]>();
  const key = (p: Point) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
  for (const index of cells) {
    const polygon = polygonOf(index);
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

/** A cell's outline pulled slightly toward its site, so neighbouring results stay distinguishable. */
export function insetCellPath(cell: number, inset = 2.5): string {
  const site = sitePoint(cell);
  const polygon = polygonOf(cell).map((p) => {
    const d = distance(p, site);
    const t = d > inset ? (d - inset) / d : 0;
    return { x: site.x + (p.x - site.x) * t, y: site.y + (p.y - site.y) * t };
  });
  return `M ${polygon.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" L ")} Z`;
}

/** The two cells, one per region, closest to each other; for neighbours they share a border. */
function closestCells(earlier: Region, later: Region): { from: Point; to: Point } {
  const inLater = new Set(later.cells);
  let best = { from: earlier.anchor, to: later.anchor };
  let bestDistance = Infinity;
  for (const a of earlier.cells) {
    if (inLater.has(a)) continue;
    for (const b of later.cells) {
      const d = distance(sitePoint(a), sitePoint(b));
      if (d < bestDistance) {
        bestDistance = d;
        best = { from: sitePoint(a), to: sitePoint(b) };
      }
    }
  }
  return best;
}

export interface TerritoryLink {
  readonly id: string;
  readonly type: "follows" | "retries";
  /** The nearest cells of the shown regions holding the earlier and the later work. */
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
        ...closestCells(earlier, later),
        viaAncestor: earlier.work.id !== relation.to || later.work.id !== relation.from,
      },
    ];
  });
}

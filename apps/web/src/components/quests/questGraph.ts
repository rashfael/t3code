import type { QuestRelation, QuestState, QuestWork } from "@t3tools/contracts";

export const NODE_WIDTH = 232;
export const NODE_HEIGHT = 68;
const COLUMN_GAP = 88;
const ROW_GAP = 14;
const PADDING = 24;

export interface GraphNode {
  readonly work: QuestWork;
  readonly x: number;
  readonly y: number;
  readonly childCount: number;
  readonly expanded: boolean;
}

export interface GraphEdge {
  readonly id: string;
  readonly kind: "part" | QuestRelation["type"];
  /** Earlier work for relations (the prerequisite or the retried attempt); the parent for parts. */
  readonly source: string;
  readonly target: string;
  readonly relation: QuestRelation | null;
  /** An end is drawn at a collapsed ancestor because the related work itself is hidden. */
  readonly viaAncestor: boolean;
}

export interface WorkGraph {
  readonly nodes: ReadonlyArray<GraphNode>;
  readonly edges: ReadonlyArray<GraphEdge>;
  readonly width: number;
  readonly height: number;
}

/**
 * Lays visible work out left to right by depth: parts sit in the column after their parent,
 * parents are centred on their visible parts. Relations between hidden work are drawn between
 * their nearest visible ancestors, and dropped when both ends fall into the same node.
 */
export function layoutWorkGraph(
  state: QuestState,
  expanded: ReadonlySet<string>,
  rootIds: ReadonlyArray<string>,
): WorkGraph {
  const byId = new Map(state.work.map((item) => [item.id, item]));
  const children = new Map<string, Array<QuestWork>>();
  for (const item of state.work) {
    if (item.parentId === null) continue;
    const list = children.get(item.parentId) ?? [];
    list.push(item);
    children.set(item.parentId, list);
  }
  const nodes: Array<GraphNode> = [];
  const edges: Array<GraphEdge> = [];
  const visible = new Set<string>();
  let nextRow = 0;
  let deepest = 0;
  const rowY = (row: number) => PADDING + row * (NODE_HEIGHT + ROW_GAP);

  function place(work: QuestWork, depth: number): number {
    visible.add(work.id);
    deepest = Math.max(deepest, depth);
    const parts = (children.get(work.id) ?? []).filter((part) => !visible.has(part.id));
    const isOpen = parts.length > 0 && expanded.has(work.id);
    const index = nodes.length;
    nodes.push({ work, x: 0, y: 0, childCount: parts.length, expanded: isOpen });
    let y: number;
    if (isOpen) {
      const childYs = parts.map((part) => {
        edges.push({
          id: `part:${work.id}:${part.id}`,
          kind: "part",
          source: work.id,
          target: part.id,
          relation: null,
          viaAncestor: false,
        });
        return place(part, depth + 1);
      });
      y = (childYs[0]! + childYs.at(-1)!) / 2;
    } else {
      y = rowY(nextRow);
      nextRow += 1;
    }
    nodes[index] = { ...nodes[index]!, x: PADDING + depth * (NODE_WIDTH + COLUMN_GAP), y };
    return y;
  }

  for (const id of rootIds) {
    const root = byId.get(id);
    if (root && !visible.has(root.id)) place(root, 0);
  }

  const shown = (id: string): string | null => {
    const seen = new Set<string>();
    let current = byId.get(id);
    while (current && !seen.has(current.id)) {
      if (visible.has(current.id)) return current.id;
      seen.add(current.id);
      current = current.parentId === null ? undefined : byId.get(current.parentId);
    }
    return null;
  };
  for (const relation of state.relations) {
    // `from` comes after or retries `to`, so edges run from `to` to `from`.
    const source = shown(relation.to);
    const target = shown(relation.from);
    if (source === null || target === null || source === target) continue;
    edges.push({
      id: relation.id,
      kind: relation.type,
      source,
      target,
      relation,
      viaAncestor: source !== relation.to || target !== relation.from,
    });
  }

  return {
    nodes,
    edges,
    width: PADDING * 2 + (deepest + 1) * NODE_WIDTH + deepest * COLUMN_GAP,
    height: PADDING * 2 + Math.max(1, nextRow) * (NODE_HEIGHT + ROW_GAP) - ROW_GAP,
  };
}

/** SVG path for an edge between two laid-out nodes. */
export function edgePath(source: GraphNode, target: GraphNode, kind: GraphEdge["kind"]): string {
  const sy = source.y + NODE_HEIGHT / 2;
  const ty = target.y + NODE_HEIGHT / 2;
  if (kind === "part") {
    const sx = source.x + NODE_WIDTH;
    const mid = sx + COLUMN_GAP / 2;
    return `M ${sx} ${sy} H ${mid} V ${ty} H ${target.x}`;
  }
  if (source.x === target.x) {
    // Same column: bow out to the right so the arc stays clear of the cards.
    const x = source.x + NODE_WIDTH;
    const bow = Math.min(COLUMN_GAP - 12, 18 + Math.abs(ty - sy) / 8);
    return `M ${x} ${sy} C ${x + bow} ${sy}, ${x + bow} ${ty}, ${x} ${ty}`;
  }
  const forward = source.x < target.x;
  const sx = forward ? source.x + NODE_WIDTH : source.x;
  const tx = forward ? target.x : target.x + NODE_WIDTH;
  const pull = Math.abs(tx - sx) / 2;
  const dir = forward ? 1 : -1;
  return `M ${sx} ${sy} C ${sx + dir * pull} ${sy}, ${tx - dir * pull} ${ty}, ${tx} ${ty}`;
}

import type { QuestState } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { layoutWorkGraph } from "./questGraph";

function work(id: string, parentId: string | null) {
  return {
    id,
    parentId,
    kind: "work" as const,
    title: id,
    state: "active" as const,
    owner: "",
    agent: "",
    understanding: "",
    documentIds: [],
    priorAttempts: "",
    findings: "",
    handoff: "",
  };
}

function relation(type: "follows" | "retries", from: string, to: string) {
  return {
    id: `${type}:${from}:${to}`,
    type,
    from,
    to,
    provenance: "capture" as const,
    documentId: null,
    excerpt: "",
  };
}

const state = {
  work: [
    work("root", null),
    work("a", "root"),
    work("a1", "a"),
    work("a2", "a"),
    work("b", "root"),
    work("b1", "b"),
  ],
  relations: [relation("follows", "a2", "a1"), relation("follows", "b1", "a1")],
} as unknown as QuestState;

describe("layoutWorkGraph", () => {
  it("places parts in the next column, centres parents and points relations at later work", () => {
    const graph = layoutWorkGraph(state, new Set(["root", "a", "b"]), ["root"]);
    const node = (id: string) => graph.nodes.find((item) => item.work.id === id)!;
    expect(node("a1").x).toBeGreaterThan(node("a").x);
    expect(node("a").y).toBe((node("a1").y + node("a2").y) / 2);
    expect(graph.edges.filter((edge) => edge.kind === "follows")).toEqual([
      expect.objectContaining({ source: "a1", target: "a2", viaAncestor: false }),
      expect.objectContaining({ source: "a1", target: "b1", viaAncestor: false }),
    ]);
  });

  it("draws relations of hidden work at the nearest shown ancestor and drops those inside one node", () => {
    const graph = layoutWorkGraph(state, new Set(["root", "b"]), ["root"]);
    expect(graph.nodes.map((item) => item.work.id)).toEqual(["root", "a", "b", "b1"]);
    expect(graph.nodes.find((item) => item.work.id === "a")).toMatchObject({
      childCount: 2,
      expanded: false,
    });
    expect(graph.edges.filter((edge) => edge.kind === "follows")).toEqual([
      expect.objectContaining({ source: "a", target: "b1", viaAncestor: true }),
    ]);
  });
});

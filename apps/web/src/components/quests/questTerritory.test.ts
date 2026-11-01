import type { QuestState } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { layoutTerritory, territoryLinks } from "./questTerritory";

function work(id: string, parentId: string | null, kind: "work" | "attempt" = "work") {
  return {
    id,
    parentId,
    kind,
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
    // Saved before its prerequisite, so only the relation can put it later.
    work("a2", "a"),
    work("a1", "a"),
    work("a1-try", "a1", "attempt"),
    work("b", "root"),
    work("b1", "b"),
    work("orphan", "missing"),
  ],
  relations: [relation("follows", "a2", "a1"), relation("follows", "b1", "a1")],
} as unknown as QuestState;

const cellsOf = (territory: ReturnType<typeof layoutTerritory>, id: string) =>
  territory.regions.find((region) => region.work.id === id)?.cells;

describe("layoutTerritory", () => {
  it("is deterministic and subdivides a region in place when it expands", () => {
    const folded = layoutTerritory(state, new Set(["root"]), ["root"]);
    expect(layoutTerritory(state, new Set(["root"]), ["root"])).toEqual(folded);
    expect(folded.regions.map((region) => region.work.id)).toEqual(["root", "a", "b"]);
    const opened = layoutTerritory(state, new Set(["root", "a"]), ["root"]);
    // Neighbours keep their ground; the parts share exactly the parent's cells.
    expect(cellsOf(opened, "b")).toEqual(cellsOf(folded, "b"));
    expect(cellsOf(opened, "a")).toEqual(cellsOf(folded, "a"));
    const parts = [...cellsOf(opened, "a1")!, ...cellsOf(opened, "a2")!].toSorted((x, y) => x - y);
    expect(parts).toEqual(cellsOf(folded, "a")!.toSorted((x, y) => x - y));
    // Recorded order puts the prerequisite first, whatever the saved order.
    expect(opened.regions.map((region) => region.work.id)).toEqual(["root", "a", "a1", "a2", "b"]);
  });

  it("reports work it cannot reach instead of dropping it silently", () => {
    const cyclic = {
      ...state,
      work: [...state.work, work("loop-a", "loop-b"), work("loop-b", "loop-a")],
    } as unknown as QuestState;
    const territory = layoutTerritory(cyclic, new Set(["root"]), ["root", "orphan"]);
    // A missing parent makes its own root; a parent cycle has none and is reported.
    expect(cellsOf(territory, "orphan")?.length).toBeGreaterThan(0);
    expect(territory.unreachable.map((item) => item.id)).toEqual(["loop-a", "loop-b"]);
    expect(territory.undrawn).toEqual([]);
  });
});

describe("territoryLinks", () => {
  it("draws only the inspected region's relations, at the regions that show each end", () => {
    const territory = layoutTerritory(state, new Set(["root", "a"]), ["root"]);
    expect(territoryLinks(state, territory, null)).toEqual([]);
    expect(territoryLinks(state, territory, "a2").map((link) => link.id)).toEqual([
      "follows:a2:a1",
    ]);
    // b is folded, so b1's relation ends at b and is marked as drawn via an ancestor.
    expect(territoryLinks(state, territory, "b")).toEqual([
      expect.objectContaining({ id: "follows:b1:a1", viaAncestor: true }),
    ]);
  });
});

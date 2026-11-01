import type { QuestState } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { mapEffects } from "./questMapEffects";
import { areNeighbours, layoutTerritory, sitePoint, territoryLinks } from "./questTerritory";

function work(id: string, parentId: string | null, state = "active", kind = "work") {
  return {
    id,
    parentId,
    kind,
    title: id,
    state,
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

function result(id: string, affected: ReadonlyArray<string>, extra: Record<string, unknown> = {}) {
  return {
    id,
    title: id,
    summary: "",
    candidate: "",
    evidence: [],
    limitations: "",
    openQuestions: "",
    affectedWorkIds: affected,
    supersedes: null,
    contextRevision: null,
    workId: null,
    source: null,
    provenance: "reported",
    sources: [],
    recordedAt: "2026-11-01T00:00:00.000Z",
    recordedRevision: 1,
    disposition: "open",
    dispositionBy: null,
    ...extra,
  };
}

const refines = (id: string) => ({ kind: "other", ref: id, note: "Finer description" });

const state = {
  work: [
    work("root", null),
    work("a", "root"),
    // Saved before its prerequisite, so only the relation can put it later.
    work("a2", "a"),
    work("a1", "a"),
    work("a1-try", "a1", "active", "attempt"),
    work("b", "root"),
    work("b1", "b"),
    work("stream", null),
    work("later", null, "planned"),
    work("orphan", "missing"),
  ],
  relations: [
    relation("follows", "a2", "a1"),
    relation("follows", "b1", "a1"),
    relation("follows", "later", "root"),
  ],
  contributions: [
    // A coarse delivery refined by two finer effects, one of them revised by a review fix.
    result("coarse", ["a1", "stream"]),
    result("fine-1", ["a1"], { evidence: [refines("coarse")] }),
    result("fine-2-v1", ["a1"], { evidence: [refines("coarse")], disposition: "superseded" }),
    result("fine-2", ["a1"], { evidence: [refines("coarse")], supersedes: "fine-2-v1" }),
    result("next", ["a1"]),
    result("b-fix", ["b1", "stream"]),
    result("b-fix-2", ["b1", "stream"]),
  ],
  files: [],
} as unknown as QuestState;
const effects = mapEffects(state);
const roots = ["root", "stream", "later", "orphan"];

const cellsOf = (territory: ReturnType<typeof layoutTerritory>, id: string) =>
  territory.regions.find((region) => region.work.id === id)?.cells ?? [];
const touches = (a: ReadonlyArray<number>, b: ReadonlyArray<number>) =>
  a.some((x) => b.some((y) => areNeighbours(x, y)));
const radius = (cells: ReadonlyArray<number>) =>
  cells.reduce((sum, cell) => sum + Math.hypot(sitePoint(cell).x, sitePoint(cell).y), 0) /
  cells.length;

describe("layoutTerritory", () => {
  it("grows deterministically outward, with dependent scope beyond its prerequisite", () => {
    const territory = layoutTerritory(state, effects, new Set(["root"]), roots);
    expect(layoutTerritory(state, effects, new Set(["root"]), roots)).toEqual(territory);
    // `later` follows `root`: it starts on root's outer edge and stays further out.
    expect(radius(cellsOf(territory, "later"))).toBeGreaterThan(radius(cellsOf(territory, "root")));
    expect(touches(cellsOf(territory, "later"), cellsOf(territory, "root"))).toBe(true);
    // Every top-level region touches another: one compact landmass, not detached islands.
    for (const id of ["root", "stream", "orphan"])
      expect(
        roots.some(
          (other) => other !== id && touches(cellsOf(territory, id), cellsOf(territory, other)),
        ),
      ).toBe(true);
  });

  it("subdivides an expanded scope in its own ground and contracts it when folded", () => {
    const open = layoutTerritory(state, effects, new Set(["root", "a", "b"]), roots);
    const parts = [...cellsOf(open, "a1"), ...cellsOf(open, "a2")].toSorted((x, y) => x - y);
    expect(parts).toEqual(cellsOf(open, "a").toSorted((x, y) => x - y));
    // Recorded order puts the prerequisite first, whatever the saved order.
    expect(open.regions.map((region) => region.work.id).slice(0, 4)).toEqual([
      "root",
      "a",
      "a1",
      "a2",
    ]);
    const folded = layoutTerritory(state, effects, new Set(["root"]), roots);
    expect(cellsOf(folded, "a").length).toBeLessThan(cellsOf(open, "a").length);
    // Folding keeps the neighbours it had.
    expect(touches(cellsOf(folded, "a"), cellsOf(folded, "b"))).toBe(
      touches(cellsOf(open, "a"), cellsOf(open, "b")),
    );
  });

  it("gives each effect its own target and groups only while its scope is folded", () => {
    const open = layoutTerritory(state, effects, new Set(["root", "a", "a1", "b"]), roots);
    const inA1 = open.units.filter((unit) => unit.workId === "a1");
    // The refined coarse result is carried by its parts; the review fix revised fine-2, adding nothing.
    expect(inA1.map((unit) => [unit.kind, unit.key])).toEqual([
      ["effect", "fine-1"],
      ["effect", "fine-2"],
      ["effect", "next"],
    ]);
    expect(new Set(inA1.map((unit) => unit.cell)).size).toBe(3);
    expect(inA1.every((unit) => !cellsOf(open, "a1-try").includes(unit.cell))).toBe(true);
    // Other work it affects shows a reference, not a second filled effect.
    expect(
      open.units.filter((unit) => unit.workId === "stream").map((unit) => [unit.kind, unit.key]),
    ).toEqual([
      ["reference", "ref:stream:a1"],
      ["reference", "ref:stream:b1"],
    ]);

    const folded = layoutTerritory(state, effects, new Set(["root"]), roots);
    const inA = folded.units.filter((unit) => unit.workId === "a");
    expect(inA.map((unit) => [unit.kind, unit.effects.map((effect) => effect.id)])).toEqual([
      ["aggregate", ["fine-1", "fine-2"]],
      ["effect", ["next"]],
    ]);
    // Without a coarse result, folded results group by the part that holds them.
    expect(
      folded.units
        .filter((unit) => unit.workId === "b" && unit.kind === "aggregate")
        .map((unit) => [unit.key, unit.effects.length]),
    ).toEqual([["group:b:scope:b1", 2]]);
    expect(folded.unplaced).toEqual([]);
  });

  it("reports work it cannot reach instead of dropping it silently", () => {
    const cyclic = {
      ...state,
      work: [...state.work, work("loop-a", "loop-b"), work("loop-b", "loop-a")],
    } as unknown as QuestState;
    const territory = layoutTerritory(cyclic, effects, new Set(["root"]), roots);
    expect(cellsOf(territory, "orphan").length).toBeGreaterThan(0);
    expect(territory.unreachable.map((item) => item.id)).toEqual(["loop-a", "loop-b"]);
    expect(territory.undrawn).toEqual([]);
  });
});

describe("territoryLinks", () => {
  it("draws only the inspected region's relations, at the regions that show each end", () => {
    const territory = layoutTerritory(state, effects, new Set(["root", "a"]), roots);
    expect(territoryLinks(state, territory, null)).toEqual([]);
    expect(territoryLinks(state, territory, "a2").map((link) => link.id)).toEqual([
      "follows:a2:a1",
    ]);
    // b is folded, so b1's relation ends at b and is marked as drawn via an ancestor.
    expect(territoryLinks(state, territory, "b")).toEqual([
      expect.objectContaining({ id: "follows:b1:a1", viaAncestor: true }),
    ]);
  });

  it("keeps every region in one piece when neighbours close around it", () => {
    // The real T3 Quest's plan shape at revision 110: ids, parents, order and result placement.
    const plan = {
      work: [
        ["ws-planning", null, "active"],
        ["ws-human", null, "active"],
        ["ws-documents", null, "active"],
        ["ws-conversations", null, "active"],
        ["ws-execution", null, "planned"],
        ["m-prototype-journeys", null, "review"],
        ["p-decisions-documents", "m-prototype-journeys", "review"],
        ["p-parallel-planning", "m-results-proposals", "review"],
        ["p-maps", "m-plan-overview", "active"],
        ["m-real-quest", "m-converge", "review"],
        ["p-separate-quest", "m-real-quest", "review"],
        ["p-real-documents", "m-real-quest", "review"],
        ["p-original-conversations", "m-real-quest", "review"],
        ["p-owner-walkthrough", "m-real-quest", "attention"],
        ["m-converge", null, "active"],
        ["c-contexts", "m-converge", "planned"],
        ["c-handback", "m-converge", "planned"],
        ["c-apply", "m-converge", "planned"],
        ["m-resume", null, "planned"],
        ["m-steer", null, "planned"],
        ["m-quest-model", null, "done"],
        ["m-discussions-in-quest", "m-prototype-journeys", "review"],
        ["m-decisions-answered", "m-prototype-journeys", "review"],
        ["m-documents-beside", "m-prototype-journeys", "review"],
        ["m-results-proposals", "m-prototype-journeys", "review"],
        ["m-semantics", null, "review"],
        ["m-plan-overview", null, "active"],
      ],
      follows: [
        ["m-discussions-in-quest", "m-quest-model"],
        ["m-semantics", "m-quest-model"],
        ["m-decisions-answered", "m-discussions-in-quest"],
        ["m-documents-beside", "m-discussions-in-quest"],
        ["m-results-proposals", "m-discussions-in-quest"],
        ["m-results-proposals", "m-decisions-answered"],
        ["m-results-proposals", "m-semantics"],
        ["m-plan-overview", "m-semantics"],
        ["m-converge", "m-prototype-journeys"],
        ["m-resume", "m-converge"],
        ["m-steer", "m-converge"],
      ],
      results: [
        ["result-1", ["p-decisions-documents", "ws-human", "ws-documents"], null],
        ["result-2", ["p-parallel-planning", "c-handback", "c-apply"], null],
        ["result-3", ["p-maps", "ws-planning"], null],
        ["result-4", ["m-converge", "m-resume", "m-steer", "ws-planning"], null],
        ["result-5", ["m-discussions-in-quest", "ws-conversations"], null],
        ["result-6", ["m-discussions-in-quest", "ws-conversations"], null],
        ["result-7", ["m-discussions-in-quest", "ws-conversations"], null],
        ["result-8", ["m-discussions-in-quest", "ws-conversations"], "result-1"],
        ["result-9", ["m-discussions-in-quest", "ws-conversations"], null],
        ["result-10", ["m-discussions-in-quest", "ws-conversations"], null],
        ["result-11", ["m-discussions-in-quest", "ws-conversations"], null],
        ["result-12", ["m-decisions-answered", "ws-human"], "result-1"],
        ["result-13", ["m-decisions-answered", "ws-human"], "result-1"],
        ["result-14", ["m-decisions-answered", "ws-human"], "result-1"],
        ["result-15", ["m-decisions-answered", "ws-human"], "result-1"],
        ["result-16", ["m-decisions-answered", "ws-human"], "result-1"],
        ["result-17", ["m-documents-beside", "ws-documents"], null],
        ["result-18", ["m-documents-beside", "ws-documents"], "result-1"],
        ["result-19", ["m-documents-beside", "ws-documents"], "result-1"],
        ["result-20", ["m-documents-beside", "ws-documents"], "result-1"],
        ["result-21", ["m-documents-beside", "ws-documents"], "result-1"],
        ["result-22", ["m-documents-beside", "ws-documents"], "result-1"],
        ["result-23", ["m-documents-beside", "ws-documents"], null],
        ["result-24", ["m-documents-beside", "ws-documents"], null],
        ["result-25", ["m-results-proposals", "ws-planning"], "result-2"],
        ["result-26", ["m-results-proposals", "ws-planning"], "result-2"],
        ["result-27", ["m-results-proposals", "ws-planning"], "result-2"],
        ["result-28", ["m-results-proposals", "ws-planning"], "result-2"],
        ["result-29", ["m-results-proposals", "ws-planning"], "result-2"],
        ["result-30", ["m-real-quest", "ws-planning"], null],
        ["result-31", ["m-plan-overview", "ws-planning"], "result-3"],
        ["result-32", ["m-plan-overview", "ws-planning"], "result-3"],
        ["result-33", ["m-semantics", "ws-planning"], "result-4"],
        ["result-34", ["m-semantics", "ws-planning"], null],
      ],
      current: "m-converge",
    } as const;
    const crowded = {
      work: plan.work.map(([id, parentId, workState]) => work(id, parentId, workState)),
      relations: plan.follows.map(([from, to]) => relation("follows", from, to)),
      contributions: plan.results.map(([id, affected, refined]) =>
        result(id, affected, refined ? { evidence: [refines(refined)] } : {}),
      ),
      currentWorkId: plan.current,
      files: [],
    } as unknown as QuestState;
    const planRoots = plan.work.filter(([, parentId]) => parentId === null).map(([id]) => id);
    const pieces = (cells: ReadonlyArray<number>) => {
      const owner = cells.map((_, index) => index);
      const find = (index: number): number =>
        owner[index] === index ? index : (owner[index] = find(owner[index]!));
      cells.forEach((a, i) =>
        cells.forEach((b, j) => {
          if (j > i && areNeighbours(a, b)) owner[find(i)] = find(j);
        }),
      );
      return new Set(cells.map((_, index) => find(index))).size;
    };
    // As the map first opens: every root and the path to the current milestone expanded.
    const territory = layoutTerritory(
      crowded,
      mapEffects(crowded),
      new Set([...planRoots, plan.current]),
      planRoots,
    );
    expect(
      territory.regions
        .filter((region) => pieces(region.cells) > 1)
        .map((region) => region.work.id),
    ).toEqual([]);
  });
});

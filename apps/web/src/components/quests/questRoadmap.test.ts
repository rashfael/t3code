import type { QuestState, QuestWork } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  FOCUS_UNIT,
  layoutRoadmap,
  NEUTRAL_FOCUS,
  ribbonD,
  type Roadmap,
  type RoadmapPath,
} from "./questRoadmap";

function work(
  id: string,
  parentId: string | null,
  state: QuestWork["state"] = "active",
  kind: QuestWork["kind"] = "work",
): QuestWork {
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

function follows(from: string, to: string) {
  return {
    id: `follows:${from}:${to}`,
    type: "follows" as const,
    from,
    to,
    provenance: "capture" as const,
    documentId: null,
    excerpt: "",
  };
}

function question(id: string, workId: string, answer: string | null = null) {
  return {
    id,
    workId,
    title: id,
    context: "",
    alternatives: [],
    answer,
    rationale: null,
    deferred: false,
    applied: false,
    proposal: false,
    answerSource: null,
    appliedRevision: null,
  };
}

/**
 * Without a recorded retention, what enters a stop leaves it again: inputs fill its bar, outputs
 * fill it too unless flow ends there, and what leaves stacks from the top of the bar.
 */
function expectFlowConserved(roadmap: Roadmap) {
  for (const stop of roadmap.stops) {
    const id = stop.work.id;
    const incoming = roadmap.paths.filter((path) => path.target === id);
    const outgoing = roadmap.paths
      .filter((path) => path.source === id)
      .toSorted((a, b) => a.sourceY - b.sourceY);
    const sum = (paths: ReadonlyArray<RoadmapPath>) =>
      paths.reduce((total, path) => total + path.width, 0);
    if (incoming.length > 0) expect(sum(incoming)).toBeCloseTo(stop.height);
    if (outgoing.length > 0) expect(sum(outgoing)).toBeCloseTo(stop.height);
    let top = stop.y - stop.height / 2;
    for (const path of outgoing) {
      expect(path.sourceY - path.width / 2).toBeCloseTo(top);
      top += path.width;
    }
  }
}

const state = {
  currentWorkId: "m",
  work: [
    work("root", null),
    work("m", "root"),
    { ...work("a", "m", "done"), focus: 5 },
    work("b", "m"),
    work("b1", "b", "review"),
    work("b2", "b", "attention"),
    work("b2-try", "b2", "done", "attempt"),
    work("c", "m", "attention"),
    { ...work("d", "m", "planned"), focus: 2 },
    work("next", "root", "planned"),
    work("folder", "root", "deferred"),
  ],
  relations: [follows("d", "a"), follows("d", "b1"), follows("next", "d")],
  questions: [question("q-b2", "b2"), question("q-m", "m", "yes"), question("q-c", "c")],
  conversations: [],
} as unknown as QuestState;

describe("layoutRoadmap", () => {
  it("orders parts only by recorded follows relations, lifted to the milestone's parts", () => {
    const roadmap = layoutRoadmap(state)!;
    const stop = (id: string) => roadmap.stops.find((item) => item.work.id === id)!;
    expect(roadmap.stops.map((item) => [item.work.id, item.role])).toEqual([
      ["m", "milestone"],
      ["a", "part"],
      ["b", "part"],
      ["c", "part"],
      ["d", "part"],
      ["next", "successor"],
    ]);
    // a, b and c run side by side; d joins a and b (via b1); c has no recorded order.
    expect(new Set([stop("a").x, stop("b").x, stop("c").x]).size).toBe(1);
    expect(stop("d").x).toBeGreaterThan(stop("a").x);
    expect(stop("next").x).toBeGreaterThan(stop("d").x);
    expect(roadmap.paths.map((path) => path.id).toSorted()).toEqual(
      ["fork:a", "fork:b", "fork:c", "follows:a:d", "follows:b:d", "follows:d:next"].toSorted(),
    );
    expect(roadmap.gap).toBeNull();
    // Sibling headings that nothing relates to are not drawn as milestones.
    expect(roadmap.stops.some((item) => item.work.id === "folder")).toBe(false);
  });

  it("counts needs and reviews once per stop, without parents or attempts", () => {
    const roadmap = layoutRoadmap(state)!;
    const stop = (id: string) => roadmap.stops.find((item) => item.work.id === id)!;
    // b2's open decision stands for its attention state; b1 is the only review leaf.
    expect(stop("b").needs).toEqual([{ type: "question", id: "q-b2", title: "q-b2" }]);
    expect(stop("b").reviewCount).toBe(1);
    expect(stop("c").needs.map((need) => need.id)).toEqual(["q-c"]);
    // The milestone carries only what is attached to it, not its parts' needs again.
    expect(stop("m").needs.map((need) => need.id)).toEqual(["q-m"]);
  });

  it("sizes ribbons as flow that only roots create and only ends absorb", () => {
    const roadmap = layoutRoadmap(state)!;
    const stop = (id: string) => roadmap.stops.find((item) => item.work.id === id)!;
    const width = (id: string) => roadmap.paths.find((path) => path.id === id)!.width;
    const neutral = NEUTRAL_FOCUS * FOCUS_UNIT;
    expectFlowConserved(roadmap);
    // next (unset) needs a neutral width; d forwards it, more than d's own focus of 2.
    expect(width("follows:d:next")).toBe(neutral);
    expect(stop("d").height).toBe(neutral);
    // The join takes what d needs from both prerequisites, without counting it twice.
    expect(width("follows:a:d")).toBe(neutral / 2);
    expect(width("follows:b:d")).toBe(neutral / 2);
    // Nothing records that a retains work, so its own focus of 5 adds no remainder: it passes on
    // exactly what it receives.
    expect(stop("a").height).toBe(neutral / 2);
    expect(width("fork:a")).toBe(neutral / 2);
    // Unset focus is a neutral structural width, not zero, where flow ends.
    expect(width("fork:c")).toBe(neutral);
    // The root supplies everything its parts pass on or end with.
    expect(stop("m").height).toBe(neutral / 2 + neutral / 2 + neutral);
  });

  it("keeps a ribbon's perpendicular cross-section constant through its bend", () => {
    const points = ribbonD(0, 0, 200, 120, 10)
      .replace(/[MLZ]/g, " ")
      .trim()
      .split(/\s+/)
      .map(Number);
    const pairs = points.length / 2;
    for (let index = 0; index < pairs / 2; index += 1) {
      const upper = [points[index * 2]!, points[index * 2 + 1]!];
      const lower = [points[(pairs - 1 - index) * 2]!, points[(pairs - 1 - index) * 2 + 1]!];
      expect(Math.hypot(upper[0]! - lower[0]!, upper[1]! - lower[1]!)).toBeCloseTo(10, 1);
    }
  });

  it("keeps the missing next milestone visible and draws nothing without a current one", () => {
    const withoutNext = {
      ...state,
      relations: state.relations.filter((relation) => relation.from !== "next"),
    };
    expect(layoutRoadmap(withoutNext)!.gap).not.toBeNull();
    expect(layoutRoadmap({ ...state, currentWorkId: null })).toBeNull();
  });

  it("draws every explicit milestone at any depth, ordered only by recorded dependencies", () => {
    const milestone = (id: string, parentId: string | null, state: QuestWork["state"]) => ({
      ...work(id, parentId, state),
      role: "milestone" as const,
    });
    const plan = {
      currentWorkId: "now-part",
      work: [
        { ...work("stream-a", null), role: "workstream" as const },
        { ...work("stream-b", null), role: "workstream" as const },
        { ...milestone("first", null, "done"), workstreamIds: ["stream-a"] },
        milestone("journeys", null, "review"),
        // Containment is not a dependency: only "left" is recorded as leading into "journeys".
        milestone("left", "journeys", "review"),
        { ...milestone("right", "journeys", "review"), workstreamIds: ["stream-b"] },
        work("right-task", "right", "review"),
        milestone("now", null, "active"),
        work("now-part", "now", "active"),
        milestone("later-a", null, "planned"),
        milestone("skip", null, "done"),
        milestone("later-b", null, "planned"),
        // Shares a workstream with "first" but nothing orders it: it stands alone.
        { ...milestone("aside", null, "planned"), workstreamIds: ["stream-a"] },
        work("setup", "now", "review"),
      ],
      relations: [
        follows("left", "first"),
        // Deeper work is lifted to the milestone holding it.
        follows("right-task", "first"),
        follows("journeys", "left"),
        follows("now", "journeys"),
        follows("later-a", "now-part"),
        follows("later-b", "now"),
        // Already implied by left → journeys → now → later-b: true, but not drawn again.
        follows("later-b", "left"),
        // Spans the column of "journeys", so it is routed past it.
        follows("skip", "first"),
        follows("now", "skip"),
      ],
      questions: [question("q-setup", "setup"), question("q-right", "right-task")],
      conversations: [],
    } as unknown as QuestState;
    const roadmap = layoutRoadmap(plan)!;
    const stop = (id: string) => roadmap.stops.find((item) => item.work.id === id)!;
    expect(roadmap.stops.map((item) => item.work.id).toSorted()).toEqual(
      [
        "first",
        "journeys",
        "left",
        "right",
        "now",
        "later-a",
        "later-b",
        "aside",
        "skip",
      ].toSorted(),
    );
    expect(roadmap.paths.map((path) => path.id).toSorted()).toEqual(
      [
        "follows:first:left",
        "follows:first:right",
        "follows:left:journeys",
        "follows:journeys:now",
        "follows:now:later-a",
        "follows:now:later-b",
        "follows:first:skip",
        "follows:skip:now",
      ].toSorted(),
    );
    const routed = roadmap.paths.find((path) => path.id === "follows:skip:now")!;
    expect(routed.via.map((point) => point.x)).toEqual([stop("journeys").x]);
    expect(routed.via[0]!.y).not.toBe(stop("journeys").y);
    // Earlier, current and later sit in order; parallel branches share a column and converge.
    expect(stop("left").x).toBe(stop("right").x);
    expect(stop("first").x).toBeLessThan(stop("left").x);
    expect(stop("journeys").x).toBeGreaterThan(stop("left").x);
    expect(stop("now").x).toBeGreaterThan(stop("journeys").x);
    expect(stop("later-a").x).toBe(stop("later-b").x);
    expect(stop("aside").x).toBe(stop("first").x);
    // The current work marks the milestone holding it; it does not become the only root.
    expect(roadmap.stops.filter((item) => item.isCurrent).map((item) => item.work.id)).toEqual([
      "now",
    ]);
    // Needs and reviews count once, at the nearest milestone.
    expect(stop("now").needs.map((need) => need.id)).toEqual(["q-setup"]);
    expect(stop("right").needs.map((need) => need.id)).toEqual(["q-right"]);
    expect(stop("journeys").needs).toEqual([]);
    expect(stop("right").reviewCount).toBe(1);
    expect(stop("journeys").reviewCount).toBe(0);
    expect(roadmap.gap).toBeNull();
    expectFlowConserved(roadmap);
    // A reviewed milestone that leads on passes all it receives; one that leads nowhere ends it.
    expect(roadmap.paths.some((path) => path.source === "right")).toBe(false);
    expect(stop("left").height).toBe(
      roadmap.paths.find((path) => path.id === "follows:left:journeys")!.width,
    );
    // Paths into work not yet started are planned, also from active work; unset focus is not.
    expect(
      roadmap.paths
        .filter((path) => path.planned)
        .map((path) => path.id)
        .toSorted(),
    ).toEqual(["follows:now:later-a", "follows:now:later-b"]);
    // Planned work leading into current work has not happened either.
    const prepared = layoutRoadmap({
      ...plan,
      work: [...plan.work, milestone("prep", null, "planned")],
      relations: [...plan.relations, follows("now", "prep")],
    })!;
    expect(prepared.paths.find((path) => path.id === "follows:prep:now")!.planned).toBe(true);
    const withoutLater = {
      ...plan,
      relations: plan.relations.filter((relation) => !relation.from.startsWith("later")),
    };
    expect(layoutRoadmap(withoutLater)!.gap).not.toBeNull();
  });
});

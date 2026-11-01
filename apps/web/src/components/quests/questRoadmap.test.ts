import type { QuestState, QuestWork } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { layoutRoadmap } from "./questRoadmap";

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

const state = {
  currentWorkId: "m",
  work: [
    work("root", null),
    work("m", "root"),
    work("a", "m", "done"),
    work("b", "m"),
    work("b1", "b", "review"),
    work("b2", "b", "attention"),
    work("b2-try", "b2", "done", "attempt"),
    work("c", "m", "attention"),
    work("d", "m", "planned"),
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

  it("keeps the missing next milestone visible and draws nothing without a current one", () => {
    const withoutNext = {
      ...state,
      relations: state.relations.filter((relation) => relation.from !== "next"),
    };
    expect(layoutRoadmap(withoutNext)!.gap).not.toBeNull();
    expect(layoutRoadmap({ ...state, currentWorkId: null })).toBeNull();
  });
});

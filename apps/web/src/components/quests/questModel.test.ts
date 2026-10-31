import type { QuestState } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { deliveryLeaves, reviewGroups } from "./questModel";

function work(
  id: string,
  parentId: string | null,
  state: QuestState["work"][number]["state"],
  kind: "work" | "attempt" = "work",
) {
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

const state = {
  work: [
    work("root", null, "active"),
    work("branch", "root", "review"),
    work("delivery-1", "branch", "review"),
    work("delivery-2", "branch", "review"),
    work("evaluation", "root", "deferred"),
    work("first-try", "evaluation", "done", "attempt"),
  ],
} as unknown as QuestState;

describe("Quest progress", () => {
  it("counts only delivery work without parts, never parents or attempts", () => {
    expect(deliveryLeaves(state, "root").map((item) => item.id)).toEqual([
      "delivery-1",
      "delivery-2",
      "evaluation",
    ]);
    expect(reviewGroups(state)).toEqual([
      { parent: state.work[1], items: [state.work[2], state.work[3]] },
    ]);
  });
});

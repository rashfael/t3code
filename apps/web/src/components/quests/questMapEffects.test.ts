import type { QuestState } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { evidenceFile, mapEffects } from "./questMapEffects";

function result(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    title: id,
    summary: "",
    candidate: "",
    evidence: [],
    limitations: "",
    openQuestions: "",
    affectedWorkIds: ["w"],
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

const state = {
  work: [{ id: "w" }, { id: "x" }],
  contributions: [
    result("v1", { disposition: "superseded" }),
    result("v2", { supersedes: "v1", workId: "x", affectedWorkIds: ["w", "x", "gone"] }),
    result("dropped", { disposition: "set-aside" }),
    result("part", { parentContributionId: "v2", refinementEvidence: ["abc123: fix"] }),
    result("orphan-part", { parentContributionId: "dropped", status: "in-progress" }),
  ],
  episodes: [
    { id: "review-1", kind: "review", lens: "behavior", affectedEffectIds: ["part"] },
    { id: "unlinked", kind: "review", affectedEffectIds: [] },
  ],
  files: [{ id: "file-1", path: "work/record.md" }],
} as unknown as QuestState;

describe("mapEffects", () => {
  it("projects current effects with their history, parts and placement", () => {
    const effects = new Map(mapEffects(state).map((effect) => [effect.id, effect]));
    // Superseded versions are history of their successor; set-aside results are not effects.
    expect([...effects.keys()]).toEqual(["v2", "part", "orphan-part"]);
    expect(effects.get("v2")).toMatchObject({
      homeWorkId: "x",
      alsoWorkIds: ["w"],
      childIds: ["part"],
      history: [expect.objectContaining({ id: "v1" })],
      planned: false,
    });
    expect(effects.get("part")).toMatchObject({
      parentId: "v2",
      refinements: ["abc123: fix"],
      episodes: [expect.objectContaining({ id: "review-1", lens: "behavior" })],
    });
    // A part of a result that is no longer current stands on its own.
    expect(effects.get("orphan-part")).toMatchObject({ parentId: null, planned: true });
  });

  it("finds registered files from relative or absolute evidence refs", () => {
    expect(evidenceFile(state, "work/record.md")?.id).toBe("file-1");
    expect(evidenceFile(state, "/home/someone/quest/work/record.md#result")?.id).toBe("file-1");
    expect(evidenceFile(state, "other.md")).toBeNull();
  });
});

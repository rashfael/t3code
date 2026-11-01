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
    result("part", {
      evidence: [
        { kind: "other", ref: "effect:part-effect", note: "Reconstruction id in corpus.json" },
        { kind: "other", ref: "v2", note: "Finer description of this earlier result" },
        {
          kind: "other",
          ref: "review:review-1",
          note: "review · behavior · checked abc123 (evidence/reviews.json)",
        },
        { kind: "other", ref: "effect:other-effect", note: "Related effect" },
      ],
    }),
    result("orphan-part", {
      evidence: [{ kind: "other", ref: "dropped", note: "Finer description" }],
    }),
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
    // Associations come from the result's own evidence refs, the only place results state them.
    expect(effects.get("part")).toMatchObject({
      parentId: "v2",
      reconstructionId: "part-effect",
      basis: "source-backed-reconstruction",
      episodes: [
        {
          id: "review-1",
          kind: "review",
          lens: "behavior",
          checkedCandidate: "abc123",
          outcome: "",
          source: "evidence/reviews.json",
        },
      ],
    });
    // A part of a result that is no longer current stands on its own.
    expect(effects.get("orphan-part")).toMatchObject({ parentId: null, reconstructionId: null });
  });

  it("finds registered files from relative or absolute evidence refs", () => {
    expect(evidenceFile(state, "work/record.md")?.id).toBe("file-1");
    expect(evidenceFile(state, "/home/someone/quest/work/record.md#result")?.id).toBe("file-1");
    expect(evidenceFile(state, "other.md")).toBeNull();
  });
});

import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import { migrateQuestV1 } from "./questMigration.ts";
import { questSeedV1 } from "./questSeed.ts";
import * as QuestStore from "./QuestStore.ts";

const harness = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3-quest-test-" });
  yield* Effect.logInfo(`Quest test directory: ${directory}`);
  const config = ServerConfig.layerTest(directory, directory);
  const layer = QuestStore.layer.pipe(Layer.provide(config));
  return { directory, layer, config };
});

describe("QuestStore", () => {
  it.effect(
    "persists work, document associations and recorded answers independently from explicit application",
    () =>
      Effect.gen(function* () {
        const { layer } = yield* harness;
        const saved = yield* Effect.gen(function* () {
          const store = yield* QuestStore.QuestStore;
          const initial = yield* store.get;
          const question = initial.questions[0]!;
          const work = initial.work.find((item) => item.id === question.workId)!;
          const doc = initial.documents.find((item) => item.kind === "living")!;
          const editedDoc = yield* store.update({
            expectedRevision: initial.revision,
            change: { type: "document", document: { ...doc, body: "Saved owner understanding" } },
          });
          const editedWork = yield* store.update({
            expectedRevision: editedDoc.revision,
            change: {
              type: "work",
              work: { ...work, title: "Bounded saved work", documentIds: [doc.id] },
            },
          });
          const answered = yield* store.update({
            expectedRevision: editedWork.revision,
            change: {
              type: "answer",
              questionId: question.id,
              answer: "Keep the retained response and investigate local adaptation first",
              rationale: null,
              deferred: false,
            },
          });
          expect(answered.work.find((item) => item.id === work.id)?.understanding).toBe(
            work.understanding,
          );
          expect(answered.questions[0]?.applied).toBe(false);
          return { answered, work, question, doc };
        }).pipe(Effect.provide(layer));

        yield* Effect.gen(function* () {
          const reopened = yield* QuestStore.QuestStore;
          const recovered = yield* reopened.get;
          expect(recovered).toEqual(saved.answered);
          expect(recovered.documents.find((item) => item.id === saved.doc.id)?.body).toBe(
            "Saved owner understanding",
          );
          expect(recovered.work.find((item) => item.id === saved.work.id)?.documentIds).toEqual([
            saved.doc.id,
          ]);
          const applied = yield* reopened.update({
            expectedRevision: recovered.revision,
            change: { type: "apply", questionId: saved.question.id },
          });
          expect(applied.questions[0]?.applied).toBe(true);
          expect(applied.work.find((item) => item.id === saved.work.id)?.understanding).toContain(
            "Keep the retained response",
          );
          expect(applied.documents.filter((item) => item.kind === "evidence")).toEqual(
            recovered.documents.filter((item) => item.kind === "evidence"),
          );
          const duplicate = yield* reopened
            .update({
              expectedRevision: applied.revision,
              change: { type: "apply", questionId: saved.question.id },
            })
            .pipe(Effect.flip);
          expect(duplicate.reason).toBe("invalid");
          const revised = yield* reopened.update({
            expectedRevision: applied.revision,
            change: { type: "reopen", questionId: saved.question.id },
          });
          expect(revised.questions[0]?.applied).toBe(false);
          expect(revised.questions[0]?.answer).toBe(applied.questions[0]?.answer);
          expect(revised.work).toEqual(applied.work);
          const answeredAgain = yield* reopened.update({
            expectedRevision: revised.revision,
            change: {
              type: "answer",
              questionId: saved.question.id,
              answer: "Revised decision",
              rationale: "Owner reviewed the retained response",
              deferred: false,
            },
          });
          const reapplied = yield* reopened.update({
            expectedRevision: answeredAgain.revision,
            change: { type: "apply", questionId: saved.question.id },
          });
          expect(reapplied.work.find((item) => item.id === saved.work.id)?.understanding).toContain(
            "Keep the retained response",
          );
          expect(reapplied.work.find((item) => item.id === saved.work.id)?.understanding).toContain(
            "Revised decision",
          );
          expect(reapplied.history.map((entry) => entry.kind)).toEqual([
            "baseline",
            "document",
            "work",
            "answer",
            "apply",
            "reopen",
            "answer",
            "apply",
          ]);
          expect(reapplied.history.map((entry) => entry.revision)).toEqual([
            0, 1, 2, 3, 4, 5, 6, 7,
          ]);
          const [firstApply, secondApply] = reapplied.history.filter(
            (entry) => entry.kind === "apply",
          );
          expect(firstApply?.changes[0]?.before).toBe(saved.work.understanding);
          expect(secondApply?.changes[0]?.before).toBe(firstApply?.changes[0]?.after);
          const revisedAnswer = reapplied.history.findLast((entry) => entry.kind === "answer");
          expect(revisedAnswer?.changes).toEqual([
            {
              label: "Answer",
              before: "Keep the retained response and investigate local adaptation first",
              after: "Revised decision",
            },
            { label: "Rationale", before: null, after: "Owner reviewed the retained response" },
          ]);
          const unchanged = yield* reopened.update({
            expectedRevision: reapplied.revision,
            change: {
              type: "work",
              work: reapplied.work.find((item) => item.id === saved.work.id)!,
            },
          });
          expect(unchanged).toEqual(reapplied);
        }).pipe(Effect.provide(layer));
      }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "rejects stale concurrent writers, deferred application, evidence edits and cyclic work trees without losing accepted state",
    () =>
      Effect.gen(function* () {
        const { layer } = yield* harness;
        yield* Effect.gen(function* () {
          const store = yield* QuestStore.QuestStore;
          const initial = yield* store.get;
          const question = initial.questions[0]!;
          const results = yield* Effect.all(
            [
              store
                .update({
                  expectedRevision: initial.revision,
                  change: {
                    type: "answer",
                    questionId: question.id,
                    answer: null,
                    rationale: null,
                    deferred: true,
                  },
                })
                .pipe(Effect.result),
              store
                .update({
                  expectedRevision: initial.revision,
                  change: {
                    type: "answer",
                    questionId: question.id,
                    answer: "Alternative",
                    rationale: null,
                    deferred: false,
                  },
                })
                .pipe(Effect.result),
            ],
            { concurrency: "unbounded" },
          );
          expect(results.filter((result) => result._tag === "Success")).toHaveLength(1);
          expect(results.filter((result) => result._tag === "Failure")).toHaveLength(1);
          let current = yield* store.get;
          if (!current.questions[0]!.deferred)
            current = yield* store.update({
              expectedRevision: current.revision,
              change: {
                type: "answer",
                questionId: question.id,
                answer: null,
                rationale: null,
                deferred: true,
              },
            });
          const deferred = yield* store
            .update({
              expectedRevision: current.revision,
              change: { type: "apply", questionId: question.id },
            })
            .pipe(Effect.flip);
          expect(deferred.reason).toBe("invalid");
          const evidence = current.documents.find((item) => item.kind === "evidence")!;
          const immutable = yield* store
            .update({
              expectedRevision: current.revision,
              change: { type: "document", document: { ...evidence, body: "Overwrite" } },
            })
            .pipe(Effect.flip);
          expect(immutable.reason).toBe("invalid");
          const first = current.work[0]!;
          const cycle = yield* store
            .update({
              expectedRevision: current.revision,
              change: { type: "work", work: { ...first, parentId: first.id } },
            })
            .pipe(Effect.flip);
          expect(cycle.reason).toBe("invalid");
          expect(yield* store.get).toEqual(current);
        }).pipe(Effect.provide(layer));
      }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("reports corrupt persisted state without replacing it with the seed", () =>
    Effect.gen(function* () {
      const { layer, config } = yield* harness;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const stateDir = yield* ServerConfig.ServerConfig.pipe(
        Effect.map((value) => value.stateDir),
        Effect.provide(config),
      );
      yield* Effect.gen(function* () {
        const store = yield* QuestStore.QuestStore;
        yield* store.get;
        const statePath = path.join(stateDir, "quest-prototype", "state.json");
        yield* fs.writeFileString(statePath, "broken");
        expect((yield* store.get.pipe(Effect.flip)).reason).toBe("storage");
        expect(yield* fs.readFileString(statePath)).toBe("broken");
      }).pipe(Effect.provide(layer));
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "upgrades a first-prototype file without losing saved edits or inventing earlier history",
    () =>
      Effect.gen(function* () {
        const { layer, config } = yield* harness;
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const stateDir = yield* ServerConfig.ServerConfig.pipe(
          Effect.map((value) => value.stateDir),
          Effect.provide(config),
        );
        const directory = path.join(stateDir, "quest-prototype");
        const statePath = path.join(directory, "state.json");
        const v1 = {
          ...questSeedV1,
          revision: 4,
          work: questSeedV1.work.map((item) =>
            item.id === "milestone-a" ? { ...item, title: "Owner-edited milestone" } : item,
          ),
          questions: questSeedV1.questions.map((item) => ({
            ...item,
            answer: "Saved before the upgrade",
          })),
        };
        const encoded = JSON.stringify(v1);
        yield* fs.makeDirectory(directory, { recursive: true });
        yield* fs.writeFileString(statePath, encoded);
        yield* Effect.gen(function* () {
          const store = yield* QuestStore.QuestStore;
          const upgraded = yield* store.get;
          expect(upgraded.schemaVersion).toBe(2);
          expect(upgraded.revision).toBe(5);
          expect(upgraded.work.find((item) => item.id === "milestone-a")?.title).toBe(
            "Owner-edited milestone",
          );
          expect(upgraded.questions[0]).toMatchObject({
            answer: "Saved before the upgrade",
            rationale: null,
            applied: false,
          });
          for (const item of v1.work) {
            const { parentId: _parent, ...kept } = item;
            expect(upgraded.work.find((candidate) => candidate.id === item.id)).toMatchObject(kept);
          }
          expect(upgraded.work.find((item) => item.id === "retained-attempt")).toMatchObject({
            kind: "attempt",
            parentId: "m2-i3",
          });
          expect(upgraded.work.find((item) => item.id === "a4-demonstration")?.state).toBe(
            "planned",
          );
          expect(upgraded.documents).toEqual(v1.documents);
          expect(upgraded.relations.every((relation) => relation.provenance === "capture")).toBe(
            true,
          );
          expect(upgraded.history).toHaveLength(1);
          expect(upgraded.history[0]).toMatchObject({ kind: "baseline", revision: 5 });
          expect(upgraded.history[0]?.summary).toContain("not recorded as history");
          expect(yield* fs.readFileString(path.join(directory, "state.v1.json"))).toBe(encoded);
          const stale = yield* store
            .update({
              expectedRevision: 4,
              change: { type: "current", workId: "review-deliveries" },
            })
            .pipe(Effect.flip);
          expect(stale.reason).toBe("conflict");
        }).pipe(Effect.provide(layer));
        yield* Effect.gen(function* () {
          const store = yield* QuestStore.QuestStore;
          const again = yield* store.get;
          expect(again.revision).toBe(5);
          expect(again.history).toHaveLength(1);
        }).pipe(Effect.provide(layer));
      }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("keeps a reparented recovery attempt where its owner put it", () =>
    Effect.sync(() => {
      const moved = migrateQuestV1(
        {
          ...questSeedV1,
          work: questSeedV1.work.map((item) =>
            item.id === "retained-attempt" ? { ...item, parentId: "market" } : item,
          ),
        },
        { at: "2026-10-31T00:00:00.000Z", fresh: false },
      );
      expect(moved.work.find((item) => item.id === "retained-attempt")?.parentId).toBe("market");
      expect(moved.history[0]?.changes.map((change) => change.label)).toEqual([
        "Example records added from captured sources",
      ]);
    }),
  );

  it.effect(
    "links and unlinks conversations without touching the thread or duplicating links",
    () =>
      Effect.gen(function* () {
        const { layer } = yield* harness;
        yield* Effect.gen(function* () {
          const store = yield* QuestStore.QuestStore;
          const initial = yield* store.get;
          const link = {
            type: "link" as const,
            threadId: "thread-1",
            projectId: "project-1",
            title: "Discuss A4",
            workId: "a4-demonstration",
            questionId: null,
          };
          const linked = yield* store.update({ expectedRevision: initial.revision, change: link });
          expect(linked.conversations).toEqual([
            expect.objectContaining({ threadId: "thread-1", workId: "a4-demonstration" }),
          ]);
          expect(linked.history.at(-1)?.summary).toContain("A4 · small live demonstration");
          for (const change of [link, { ...link, threadId: "thread-2", workId: "missing" }]) {
            const rejected = yield* store
              .update({ expectedRevision: linked.revision, change })
              .pipe(Effect.flip);
            expect(rejected.reason).toBe("invalid");
          }
          const unlinked = yield* store.update({
            expectedRevision: linked.revision,
            change: { type: "unlink", threadId: "thread-1" },
          });
          expect(unlinked.conversations).toEqual([]);
          expect(unlinked.history.map((entry) => entry.kind)).toEqual([
            "baseline",
            "link",
            "unlink",
          ]);
        }).pipe(Effect.provide(layer));
      }).pipe(Effect.provide(NodeServices.layer)),
  );
});

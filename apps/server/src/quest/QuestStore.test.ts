import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
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
                  change: { type: "answer", questionId: question.id, answer: null, deferred: true },
                })
                .pipe(Effect.result),
              store
                .update({
                  expectedRevision: initial.revision,
                  change: {
                    type: "answer",
                    questionId: question.id,
                    answer: "Alternative",
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
              change: { type: "answer", questionId: question.id, answer: null, deferred: true },
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
});

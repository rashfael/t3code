import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  ProviderInstanceId,
  type QuestOpenConversationInput,
  type QuestUpdateInput,
} from "@t3tools/contracts";
import { QUEST_DEFAULT_ID } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";

import * as ServerConfig from "../config.ts";
import { LEGACY_QUEST, questAgentContext } from "./questContext.ts";
import { migrateQuestV1 } from "./questMigration.ts";
import { questSeedV1 } from "./questSeed.ts";
import * as QuestStore from "./QuestStore.ts";

const legacyQuest = Effect.gen(function* () {
  const store = yield* QuestStore.QuestStore;
  return yield* store.quest(QUEST_DEFAULT_ID);
});

const actor = { kind: "client", id: null } as const;

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
          const store = yield* legacyQuest;
          const initial = yield* store.get;
          const question = initial.questions[0]!;
          const work = initial.work.find((item) => item.id === question.workId)!;
          const doc = initial.documents.find((item) => item.kind === "living")!;
          const editedDoc = yield* store.update(
            {
              expectedRevision: initial.revision,
              change: { type: "document", document: { ...doc, body: "Saved owner understanding" } },
            },
            actor,
          );
          const editedWork = yield* store.update(
            {
              expectedRevision: editedDoc.revision,
              change: {
                type: "work",
                work: { ...work, title: "Bounded saved work", documentIds: [doc.id], focus: 4 },
              },
            },
            actor,
          );
          const answered = yield* store.update(
            {
              expectedRevision: editedWork.revision,
              change: {
                type: "answer",
                questionId: question.id,
                answer: "Keep the retained response and investigate local adaptation first",
                rationale: null,
                deferred: false,
              },
            },
            actor,
          );
          expect(answered.work.find((item) => item.id === work.id)?.understanding).toBe(
            work.understanding,
          );
          expect(answered.questions[0]?.applied).toBe(false);
          return { answered, work, question, doc };
        }).pipe(Effect.provide(layer));

        yield* Effect.gen(function* () {
          const reopened = yield* legacyQuest;
          const recovered = yield* reopened.get;
          expect(recovered).toEqual(saved.answered);
          expect(recovered.documents.find((item) => item.id === saved.doc.id)?.body).toBe(
            "Saved owner understanding",
          );
          expect(recovered.work.find((item) => item.id === saved.work.id)?.documentIds).toEqual([
            saved.doc.id,
          ]);
          expect(recovered.work.find((item) => item.id === saved.work.id)?.focus).toBe(4);
          expect(recovered.history.find((entry) => entry.kind === "work")?.changes).toContainEqual({
            label: "Planned focus",
            before: null,
            after: "4 of 5",
          });
          const applied = yield* reopened.update(
            {
              expectedRevision: recovered.revision,
              change: { type: "apply", questionId: saved.question.id },
            },
            actor,
          );
          expect(applied.questions[0]?.applied).toBe(true);
          expect(applied.work.find((item) => item.id === saved.work.id)?.understanding).toContain(
            "Keep the retained response",
          );
          expect(applied.documents.filter((item) => item.kind === "evidence")).toEqual(
            recovered.documents.filter((item) => item.kind === "evidence"),
          );
          const duplicate = yield* reopened
            .update(
              {
                expectedRevision: applied.revision,
                change: { type: "apply", questionId: saved.question.id },
              },
              actor,
            )
            .pipe(Effect.flip);
          expect(duplicate.reason).toBe("invalid");
          const revised = yield* reopened.update(
            {
              expectedRevision: applied.revision,
              change: { type: "reopen", questionId: saved.question.id },
            },
            actor,
          );
          expect(revised.questions[0]?.applied).toBe(false);
          expect(revised.questions[0]?.answer).toBe(applied.questions[0]?.answer);
          expect(revised.work).toEqual(applied.work);
          const answeredAgain = yield* reopened.update(
            {
              expectedRevision: revised.revision,
              change: {
                type: "answer",
                questionId: saved.question.id,
                answer: "Revised decision",
                rationale: "Owner reviewed the retained response",
                deferred: false,
              },
            },
            actor,
          );
          const reapplied = yield* reopened.update(
            {
              expectedRevision: answeredAgain.revision,
              change: { type: "apply", questionId: saved.question.id },
            },
            actor,
          );
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
          const unchanged = yield* reopened.update(
            {
              expectedRevision: reapplied.revision,
              change: {
                type: "work",
                work: reapplied.work.find((item) => item.id === saved.work.id)!,
              },
            },
            actor,
          );
          expect(unchanged).toEqual(reapplied);
          const { focus: _focus, ...unfocused } = reapplied.work.find(
            (item) => item.id === saved.work.id,
          )!;
          const cleared = yield* reopened.update(
            { expectedRevision: reapplied.revision, change: { type: "work", work: unfocused } },
            actor,
          );
          expect(cleared.work.find((item) => item.id === saved.work.id)).not.toHaveProperty(
            "focus",
          );
          expect(cleared.history.at(-1)?.changes).toEqual([
            { label: "Planned focus", before: "4 of 5", after: null },
          ]);
        }).pipe(Effect.provide(layer));
      }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "rejects stale concurrent writers, deferred application, evidence edits and cyclic work trees without losing accepted state",
    () =>
      Effect.gen(function* () {
        const { layer } = yield* harness;
        yield* Effect.gen(function* () {
          const store = yield* legacyQuest;
          const initial = yield* store.get;
          const question = initial.questions[0]!;
          const results = yield* Effect.all(
            [
              store
                .update(
                  {
                    expectedRevision: initial.revision,
                    change: {
                      type: "answer",
                      questionId: question.id,
                      answer: null,
                      rationale: null,
                      deferred: true,
                    },
                  },
                  actor,
                )
                .pipe(Effect.result),
              store
                .update(
                  {
                    expectedRevision: initial.revision,
                    change: {
                      type: "answer",
                      questionId: question.id,
                      answer: "Alternative",
                      rationale: null,
                      deferred: false,
                    },
                  },
                  actor,
                )
                .pipe(Effect.result),
            ],
            { concurrency: "unbounded" },
          );
          expect(results.filter((result) => result._tag === "Success")).toHaveLength(1);
          expect(results.filter((result) => result._tag === "Failure")).toHaveLength(1);
          let current = yield* store.get;
          if (!current.questions[0]!.deferred)
            current = yield* store.update(
              {
                expectedRevision: current.revision,
                change: {
                  type: "answer",
                  questionId: question.id,
                  answer: null,
                  rationale: null,
                  deferred: true,
                },
              },
              actor,
            );
          const deferred = yield* store
            .update(
              {
                expectedRevision: current.revision,
                change: { type: "apply", questionId: question.id },
              },
              actor,
            )
            .pipe(Effect.flip);
          expect(deferred.reason).toBe("invalid");
          const evidence = current.documents.find((item) => item.kind === "evidence")!;
          const immutable = yield* store
            .update(
              {
                expectedRevision: current.revision,
                change: { type: "document", document: { ...evidence, body: "Overwrite" } },
              },
              actor,
            )
            .pipe(Effect.flip);
          expect(immutable.reason).toBe("invalid");
          const first = current.work[0]!;
          const cycle = yield* store
            .update(
              {
                expectedRevision: current.revision,
                change: { type: "work", work: { ...first, parentId: first.id } },
              },
              actor,
            )
            .pipe(Effect.flip);
          expect(cycle.reason).toBe("invalid");
          const outOfRange = yield* store
            .update(
              {
                expectedRevision: current.revision,
                change: { type: "work", work: { ...first, focus: 2.5 } },
              },
              actor,
            )
            .pipe(Effect.flip);
          expect(outOfRange.reason).toBe("invalid");
          expect(yield* store.get).toEqual(current);
        }).pipe(Effect.provide(layer));
      }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "creates nothing on read and reports corrupt persisted state without replacing it",
    () =>
      Effect.gen(function* () {
        const { layer, config } = yield* harness;
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const stateDir = yield* ServerConfig.ServerConfig.pipe(
          Effect.map((value) => value.stateDir),
          Effect.provide(config),
        );
        yield* Effect.gen(function* () {
          const store = yield* legacyQuest;
          yield* store.get;
          // Loading a missing Quest shows the example without creating any file.
          expect(yield* fs.exists(path.join(stateDir, "quest-prototype"))).toBe(false);
          const statePath = path.join(stateDir, "quest-prototype", "state.json");
          yield* fs.makeDirectory(path.dirname(statePath), { recursive: true });
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
          const store = yield* legacyQuest;
          const upgraded = yield* store.get;
          expect(upgraded.schemaVersion).toBe(3);
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
          // Reading upgrades only in memory; the saved file is replaced by the first accepted write.
          expect(yield* fs.readFileString(statePath)).toBe(encoded);
          expect(yield* fs.exists(path.join(directory, "state.v1.backup.json"))).toBe(false);
          const stale = yield* store
            .update(
              {
                expectedRevision: 4,
                change: { type: "current", workId: "review-deliveries" },
              },
              actor,
            )
            .pipe(Effect.flip);
          expect(stale.reason).toBe("conflict");
          const saved = yield* store.update(
            { expectedRevision: 5, change: { type: "current", workId: "review-deliveries" } },
            actor,
          );
          expect(saved.revision).toBe(6);
          expect(yield* fs.readFileString(path.join(directory, "state.v1.backup.json"))).toBe(
            encoded,
          );
          const {
            history: _history,
            schemaVersion: _version,
            revision: _revision,
            ...domain
          } = upgraded;
          expect((yield* store.reconstruct(5)).domain).toEqual(domain);
          expect((yield* store.reconstruct(4).pipe(Effect.flip)).reason).toBe("unavailable");
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
    "links and unlinks conversations, answering thread lookups, without duplicating links",
    () =>
      Effect.gen(function* () {
        const { layer } = yield* harness;
        yield* Effect.gen(function* () {
          const store = yield* legacyQuest;
          const initial = yield* store.get;
          const link = {
            type: "link" as const,
            threadId: "thread-1",
            projectId: "project-1",
            title: "Discuss A4",
            workId: "a4-demonstration",
            questionId: null,
          };
          const linked = yield* store.update(
            { expectedRevision: initial.revision, change: link },
            actor,
          );
          expect(linked.conversations).toEqual([
            expect.objectContaining({ threadId: "thread-1", workId: "a4-demonstration" }),
          ]);
          expect(linked.history.at(-1)?.summary).toContain("A4 · small live demonstration");
          expect(yield* store.threadLink("thread-1")).toEqual({
            questId: QUEST_DEFAULT_ID,
            questTitle: "Market tracking",
            threadId: "thread-1",
            workId: "a4-demonstration",
            questionId: null,
            about: "A4 · small live demonstration",
            role: "linked",
            purpose: "",
          });
          for (const change of [link, { ...link, threadId: "thread-2", workId: "missing" }]) {
            const rejected = yield* store
              .update({ expectedRevision: linked.revision, change }, actor)
              .pipe(Effect.flip);
            expect(rejected.reason).toBe("invalid");
          }
          const unlinked = yield* store.update(
            {
              expectedRevision: linked.revision,
              change: { type: "unlink", threadId: "thread-1" },
            },
            actor,
          );
          expect(unlinked.conversations).toEqual([]);
          expect(yield* store.threadLink("thread-1")).toBeNull();
          expect(unlinked.history.map((entry) => entry.kind)).toEqual([
            "baseline",
            "link",
            "unlink",
          ]);
        }).pipe(Effect.provide(layer));
      }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "upgrades the saved second prototype on its first write, keeping exact bytes, links and a reconstructable baseline",
    () =>
      Effect.gen(function* () {
        const { layer, directory: stateRoot } = yield* harness;
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const directory = path.join(stateRoot, "userdata", "quest-prototype");
        const v2 = migrateQuestV1(questSeedV1, { at: "2026-10-31T00:00:00.000Z", fresh: false });
        const saved = {
          ...v2,
          revision: 9,
          conversations: [
            {
              threadId: "verification-thread",
              projectId: "project-1",
              title: "Market tracking",
              workId: null,
              questionId: null,
              linkedAt: "2026-10-31T21:46:45.814Z",
            },
          ],
        };
        const encoded = JSON.stringify(saved, null, 2);
        yield* fs.makeDirectory(directory, { recursive: true });
        yield* fs.writeFileString(path.join(directory, "state.json"), encoded);
        yield* Effect.gen(function* () {
          const store = yield* legacyQuest;
          const read = yield* store.get;
          expect(yield* store.membership).toMatchObject({
            revision: 9,
            members: [{ threadId: "verification-thread", role: "linked" }],
          });
          expect(yield* fs.readFileString(path.join(directory, "state.json"))).toBe(encoded);
          // An earlier link is never promoted to the core or given a purpose it did not have.
          expect(read.conversations[0]).toMatchObject({
            role: "linked",
            purpose: "",
            creation: null,
          });
          const next = yield* store.update(
            { expectedRevision: 9, change: { type: "current", workId: "review-deliveries" } },
            actor,
          );
          expect(next.revision).toBe(10);
          expect(next.conversations).toEqual(read.conversations);
          expect(yield* fs.readFileString(path.join(directory, "state.v2.backup.json"))).toBe(
            encoded,
          );
          const baseline = yield* store.reconstruct(9);
          expect(baseline.limit).toContain("cannot be reconstructed");
          expect(baseline.domain.conversations).toEqual(read.conversations);
          expect(baseline.records).toEqual([]);
        }).pipe(Effect.provide(layer));
      }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "reconstructs every saved revision, including associations and work before an answer was applied",
    () =>
      Effect.gen(function* () {
        const { layer } = yield* harness;
        yield* Effect.gen(function* () {
          const store = yield* legacyQuest;
          const states = [yield* store.get];
          const save = (
            change: QuestUpdateInput["change"],
            extra: Partial<QuestUpdateInput> = {},
          ) =>
            store
              .update({ expectedRevision: states.at(-1)!.revision, change, ...extra }, actor)
              .pipe(Effect.tap((state) => Effect.sync(() => states.push(state))));
          const work = states[0]!.work.find((item) => item.id === "a4-demonstration")!;
          const asked = yield* save({
            type: "question-create",
            question: {
              workId: work.id,
              title: "Should A4 be split?",
              context: "Prepared by the owner",
              alternatives: ["Split", " ", "Keep"],
            },
          });
          const question = asked.questions.at(-1)!;
          expect(question).toMatchObject({ alternatives: ["Split", "Keep"], applied: false });
          yield* save({
            type: "question-edit",
            questionId: question.id,
            question: { ...question, context: "Prepared and refined" },
          });
          yield* save({
            type: "link",
            threadId: "discussion",
            projectId: "project-1",
            title: "Discuss A4",
            workId: work.id,
            questionId: null,
            purposeKind: "discuss-work",
            purpose: "Explore the split",
          });
          const operationId = "answer-op";
          yield* save(
            {
              type: "answer",
              questionId: question.id,
              answer: "Split it",
              rationale: null,
              deferred: false,
            },
            { operationId, source: { threadId: "discussion", runId: null } },
          );
          // A retried operation returns the saved state instead of a conflict or a second answer.
          const retried = yield* store.update(
            {
              expectedRevision: states.at(-2)!.revision,
              operationId,
              change: {
                type: "answer",
                questionId: question.id,
                answer: "Split it",
                rationale: null,
                deferred: false,
              },
            },
            actor,
          );
          expect(retried).toEqual(states.at(-1));
          const beforeApply = states.at(-1)!;
          const applied = yield* save({ type: "apply", questionId: question.id });
          expect(applied.questions.at(-1)).toMatchObject({
            appliedRevision: applied.revision,
            answerSource: { threadId: "discussion", runId: null },
          });
          yield* save({ type: "unlink", threadId: "discussion" });
          yield* save({
            type: "link",
            threadId: "discussion",
            projectId: "project-1",
            title: "Discuss A4",
            workId: null,
            questionId: question.id,
          });
          for (const state of states.slice(1)) {
            const { history: _h, schemaVersion: _v, revision: _r, ...domain } = state;
            expect((yield* store.reconstruct(state.revision)).domain).toEqual(domain);
          }
          const before = yield* store.reconstruct(beforeApply.revision);
          expect(before.domain.conversations).toEqual([
            expect.objectContaining({
              threadId: "discussion",
              workId: work.id,
              purpose: "Explore the split",
            }),
          ]);
          expect(before.domain.work.find((item) => item.id === work.id)?.understanding).toBe(
            work.understanding,
          );
          const all = yield* store.reconstruct(states.at(-1)!.revision);
          const applyRecord = all.records.find((record) => record.operation === "apply")!;
          expect(applyRecord.changes.map((change) => change.collection).toSorted()).toEqual([
            "questions",
            "work",
          ]);
          const unlinkRecord = all.records.find((record) => record.operation === "unlink")!;
          expect(unlinkRecord.changes).toEqual([
            expect.objectContaining({
              collection: "conversations",
              before: expect.objectContaining({ workId: work.id }),
              after: null,
            }),
          ]);
          expect(all.records.find((record) => record.operation === "answer")).toMatchObject({
            operationId,
            actor,
            source: { threadId: "discussion", runId: null },
          });
          // Snapshots of the domain never copy the prose log or earlier snapshots.
          expect(JSON.stringify(all.records)).not.toContain('"history"');
        }).pipe(Effect.provide(layer));
      }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "reserves one core across concurrent and retried requests and keeps a replaced core as predecessor",
    () =>
      Effect.gen(function* () {
        const { layer } = yield* harness;
        yield* Effect.gen(function* () {
          const store = yield* legacyQuest;
          const open = (operationId: string, extra: Partial<QuestOpenConversationInput> = {}) =>
            store.reserveConversation(
              {
                operationId,
                role: "core",
                purposeKind: "coordinate",
                purpose: "",
                workId: null,
                questionId: null,
                resume: true,
                projectId: "project-1",
                modelSelection: { instanceId: ProviderInstanceId.make("replay"), model: "replay" },
                runtimeMode: "full-access",
                interactionMode: "default",
                ...extra,
              },
              actor,
              { readFiles: true },
            );
          const [first, second] = yield* Effect.all([open("client-a"), open("client-b")], {
            concurrency: "unbounded",
          });
          expect(first.conversation.threadId).toBe(second.conversation.threadId);
          expect([first.created, second.created].toSorted()).toEqual([false, true]);
          const core = (yield* store.get).conversations.filter((item) => item.role === "core");
          expect(core).toHaveLength(1);
          expect(core[0]?.creation).toMatchObject({
            status: "reserved",
            effectiveModelSelection: null,
          });
          expect(core[0]?.prepared).toContain("core coordination conversation");
          expect((yield* open("client-a")).conversation.threadId).toBe(core[0]!.threadId);
          const ready = yield* store.finalizeConversation(
            core[0]!.threadId,
            { instanceId: ProviderInstanceId.make("replay"), model: "replay-effective" },
            actor,
          );
          expect(ready.conversations[0]?.creation).toMatchObject({
            status: "ready",
            requested: { provenance: "client-default" },
            effectiveModelSelection: { model: "replay-effective" },
          });
          const focused = (operationId: string, resume: boolean) =>
            open(operationId, {
              role: "focused",
              purposeKind: "decide",
              purpose: "Decide the summary gap",
              questionId: "summary-question",
              resume,
            });
          const discussion = yield* focused("focused-1", true);
          expect(discussion.created).toBe(true);
          expect(discussion.conversation.sourceRevision).toBe(ready.revision);
          expect((yield* focused("focused-2", true)).conversation.threadId).toBe(
            discussion.conversation.threadId,
          );
          const another = yield* open("focused-3", {
            role: "focused",
            purposeKind: "decide",
            purpose: "Compare the alternatives",
            questionId: "summary-question",
            resume: false,
          });
          expect(another.conversation.threadId).not.toBe(discussion.conversation.threadId);
          // Subject resume picks the newest match; finishing a reservation targets exactly it.
          expect((yield* focused("focused-4", true)).conversation.threadId).toBe(
            another.conversation.threadId,
          );
          const exact = yield* open("finish-1", {
            role: "focused",
            purposeKind: "decide",
            purpose: "Decide the summary gap",
            questionId: "summary-question",
            resume: true,
            threadId: discussion.conversation.threadId,
          });
          expect(exact.conversation.threadId).toBe(discussion.conversation.threadId);
          expect(
            (yield* open("finish-2", { threadId: "not-in-the-quest" }).pipe(Effect.flip)).reason,
          ).toBe("invalid");
          // The core's current context follows the current milestone; a focused one keeps its subject.
          const coreId = core[0]!.threadId;
          const atReservation = yield* store.get;
          expect(questAgentContext(atReservation, coreId, LEGACY_QUEST)).toMatchObject({
            currentWorkId: "milestone-a",
            work: { id: "milestone-a" },
            caller: { role: "core" },
          });
          const moved = yield* store.update(
            {
              expectedRevision: atReservation.revision,
              change: { type: "current", workId: "summary-gap" },
            },
            actor,
          );
          const asCore = questAgentContext(moved, coreId, LEGACY_QUEST);
          expect(asCore).toMatchObject({
            currentWorkId: "summary-gap",
            work: { id: "summary-gap" },
          });
          expect(asCore.obligations.map((item) => item.questionId)).toContain("summary-question");
          const moveBack = yield* store.update(
            {
              expectedRevision: moved.revision,
              change: { type: "current", workId: "review-deliveries" },
            },
            actor,
          );
          expect(
            questAgentContext(moveBack, discussion.conversation.threadId, LEGACY_QUEST),
          ).toMatchObject({
            currentWorkId: "review-deliveries",
            work: { id: "summary-gap" },
            caller: { role: "focused", sourceRevision: discussion.conversation.sourceRevision },
          });
          expect(questAgentContext(moveBack, coreId, LEGACY_QUEST).work?.id).toBe(
            "review-deliveries",
          );
          expect((yield* store.reconstruct(moved.revision)).domain.currentWorkId).toBe(
            "summary-gap",
          );
          const current = yield* store.get;
          const detachCore = yield* store
            .update(
              {
                expectedRevision: current.revision,
                change: { type: "unlink", threadId: core[0]!.threadId },
              },
              actor,
            )
            .pipe(Effect.flip);
          expect(detachCore.reason).toBe("invalid");
          const replaced = yield* store.update(
            {
              expectedRevision: current.revision,
              change: { type: "core-replace", reason: "Context grew too long" },
            },
            actor,
          );
          expect(replaced.corePredecessors).toEqual([
            expect.objectContaining({
              reason: "Context grew too long",
              conversation: expect.objectContaining({ threadId: core[0]!.threadId }),
            }),
          ]);
          const successor = yield* open("client-c");
          expect(successor.created).toBe(true);
          expect(successor.conversation.threadId).not.toBe(core[0]!.threadId);
        }).pipe(Effect.provide(layer));
      }).pipe(Effect.provide(NodeServices.layer)),
  );
});

const failingRename = (fail: (from: string, to: string) => boolean) =>
  Layer.effect(
    FileSystem.FileSystem,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      return {
        ...fs,
        rename: (from: string, to: string) =>
          fail(from, to)
            ? Effect.fail(
                PlatformError.systemError({
                  _tag: "PermissionDenied",
                  module: "FileSystem",
                  method: "rename",
                }),
              )
            : fs.rename(from, to),
      };
    }),
  );

const workspaceHarness = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const { directory, config } = yield* harness;
  const workspace = yield* fs.makeTempDirectoryScoped({ prefix: "t3-quest-docs-" });
  const outside = yield* fs.makeTempDirectoryScoped({ prefix: "t3-quest-outside-" });
  yield* fs.makeDirectory(path.join(workspace, "notes"));
  yield* fs.writeFileString(path.join(workspace, "notes", "plan.md"), "# Plan\n\nFirst version\n");
  yield* fs.writeFileString(path.join(outside, "secret.md"), "outside");
  yield* fs.symlink(path.join(outside, "secret.md"), path.join(workspace, "escape.md"));
  const plan = path.join(workspace, "notes", "plan.md");
  const statePath = path.join(directory, "userdata", "quest-prototype", "state.json");
  return { workspace, outside, plan, statePath, config };
});

const setupFile = Effect.gen(function* () {
  const store = yield* legacyQuest;
  const path = yield* Path.Path;
  const initial = yield* store.get;
  const root = path.dirname(path.dirname((yield* Effect.service(WorkspaceRoot)).plan));
  const registered = yield* store.update(
    { expectedRevision: initial.revision, change: { type: "workspace-register", root } },
    actor,
  );
  const withFile = yield* store.update(
    {
      expectedRevision: registered.revision,
      change: { type: "file-register", path: "./notes//plan.md", title: "Plan" },
    },
    actor,
  );
  const file = withFile.files[0]!;
  const read = yield* store.readDocument(file.id);
  expect(read).toMatchObject({ path: "notes/plan.md", content: "# Plan\n\nFirst version\n" });
  return { store, file, read };
});

class WorkspaceRoot extends Context.Service<WorkspaceRoot, { readonly plan: string }>()(
  "t3/quest/QuestStore.test/WorkspaceRoot",
) {}

describe("QuestStore documents", () => {
  it.effect(
    "registers only Markdown inside the workspace and pins the exact bytes a discussion used",
    () =>
      Effect.gen(function* () {
        const { config, plan, outside } = yield* workspaceHarness;
        const fs = yield* FileSystem.FileSystem;
        yield* Effect.gen(function* () {
          const { store, file, read } = yield* setupFile;
          const state = yield* store.get;
          for (const escape of ["../outside.md", "/etc/passwd.md", "escape.md", "notes/plan.txt"]) {
            const rejected = yield* store
              .update(
                {
                  expectedRevision: state.revision,
                  change: { type: "file-register", path: escape, title: "x" },
                },
                actor,
              )
              .pipe(Effect.flip);
            expect(["invalid", "unavailable"]).toContain(rejected.reason);
          }
          const work = state.work.find((item) => item.id === "a4-demonstration")!;
          const linked = yield* store.update(
            {
              expectedRevision: state.revision,
              change: { type: "work", work: { ...work, documentIds: [file.id] } },
            },
            actor,
          );
          // Uncommitted working-tree edits are what the discussion reads, so they are what is pinned.
          yield* fs.writeFileString(plan, "# Plan\n\nUncommitted edit\n");
          const discussion = yield* store.reserveConversation(
            {
              operationId: "pin",
              role: "focused",
              purposeKind: "discuss-work",
              purpose: "Review the plan",
              workId: work.id,
              questionId: null,
              resume: false,
              projectId: "project-1",
              modelSelection: { instanceId: ProviderInstanceId.make("replay"), model: "replay" },
              runtimeMode: "full-access",
              interactionMode: "default",
            },
            actor,
            { readFiles: true },
          );
          const pin = discussion.conversation.sources[0]!;
          expect(pin).toMatchObject({
            documentId: file.id,
            path: "notes/plan.md",
            unavailable: null,
          });
          expect(pin.sha256).not.toBe(read.sha256);
          expect(discussion.conversation.sourceRevision).toBe(linked.revision);
          yield* fs.writeFileString(plan, "# Plan\n\nLater edit\n");
          expect((yield* store.retained(pin.sha256!)).content).toBe("# Plan\n\nUncommitted edit\n");
          const current = yield* store.readDocument(file.id);
          expect(current.content).toBe("# Plan\n\nLater edit\n");
          expect(current.sha256).not.toBe(pin.sha256);
          // Without the caller's file grant, opening names the source but never reads it.
          const unread = yield* store.reserveConversation(
            {
              operationId: "pin-no-files",
              role: "focused",
              purposeKind: "discuss-work",
              purpose: "Review without file access",
              workId: work.id,
              questionId: null,
              resume: false,
              projectId: "project-1",
              modelSelection: { instanceId: ProviderInstanceId.make("replay"), model: "replay" },
              runtimeMode: "full-access",
              interactionMode: "default",
            },
            actor,
            { readFiles: false },
          );
          expect(unread.conversation.sources).toEqual([
            expect.objectContaining({ documentId: file.id, path: "notes/plan.md", sha256: null }),
          ]);
          expect(unread.conversation.prepared).not.toContain(current.sha256!.slice(0, 12));
          // Registered ids resolve against the workspace, so it cannot silently move under them.
          const moved = yield* store
            .update(
              {
                expectedRevision: unread.state.revision,
                change: { type: "workspace-register", root: outside },
              },
              actor,
            )
            .pipe(Effect.flip);
          expect(moved.reason).toBe("invalid");
          expect((yield* store.get).workspace).toEqual(unread.state.workspace);
          expect((yield* store.readDocument(file.id)).content).toBe("# Plan\n\nLater edit\n");
        }).pipe(
          Effect.provide(QuestStore.layer.pipe(Layer.provide(config))),
          Effect.provideService(WorkspaceRoot, { plan }),
        );
      }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "saves against the observed version and rejects a stale save without touching the file",
    () =>
      Effect.gen(function* () {
        const { config, plan } = yield* workspaceHarness;
        const fs = yield* FileSystem.FileSystem;
        yield* Effect.gen(function* () {
          const { store, file, read } = yield* setupFile;
          const saved = yield* store.writeDocument(
            {
              operationId: "w1",
              documentId: file.id,
              expectedSha256: read.sha256!,
              content: "# Plan\n\nSecond\n",
            },
            actor,
          );
          expect(saved.outcome).toBe("saved");
          expect(saved.state.pendingWrites).toEqual([]);
          expect(yield* fs.readFileString(plan)).toBe("# Plan\n\nSecond\n");
          expect(saved.state.history.at(-1)?.summary).toBe("Saved notes/plan.md");
          const replay = yield* store.writeDocument(
            {
              operationId: "w1",
              documentId: file.id,
              expectedSha256: read.sha256!,
              content: "# Plan\n\nSecond\n",
            },
            actor,
          );
          expect(replay.outcome).toBe("saved");
          expect(replay.state.revision).toBe(saved.state.revision);
          yield* fs.writeFileString(plan, "# Plan\n\nEdited in an editor\n");
          const stale = yield* store.writeDocument(
            {
              operationId: "w2",
              documentId: file.id,
              expectedSha256: saved.file.sha256!,
              content: "# Plan\n\nMine\n",
            },
            actor,
          );
          expect(stale.outcome).toBe("conflict");
          expect(yield* fs.readFileString(plan)).toBe("# Plan\n\nEdited in an editor\n");
          const conflict = stale.state.pendingWrites[0]!;
          expect(conflict.status).toBe("conflict");
          expect((yield* store.retained(conflict.desiredSha256)).content).toBe("# Plan\n\nMine\n");
          const blocked = yield* store
            .writeDocument(
              {
                operationId: "w3",
                documentId: file.id,
                expectedSha256: stale.file.sha256!,
                content: "x",
              },
              actor,
            )
            .pipe(Effect.flip);
          expect(blocked.reason).toBe("invalid");
          const discarded = yield* store.update(
            {
              expectedRevision: stale.state.revision,
              change: { type: "write-discard", writeId: conflict.id },
            },
            actor,
          );
          expect(discarded.pendingWrites).toEqual([]);
        }).pipe(
          Effect.provide(QuestStore.layer.pipe(Layer.provide(config))),
          Effect.provideService(WorkspaceRoot, { plan }),
        );
      }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("never writes through a parent folder replaced after the save's intent", () =>
    Effect.gen(function* () {
      const { config, plan, statePath, workspace, outside } = yield* workspaceHarness;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const notes = path.join(workspace, "notes");
      const kept = path.join(workspace, "notes-original");
      const outsidePlan = path.join(outside, "notes", "plan.md");
      let armed = false;
      // Right after the intent commits, `notes` becomes a symlink to a same-content outside copy.
      const swapping = Layer.effect(
        FileSystem.FileSystem,
        Effect.gen(function* () {
          const real = yield* FileSystem.FileSystem;
          const swap = Effect.gen(function* () {
            armed = false;
            yield* real.makeDirectory(path.dirname(outsidePlan));
            yield* real.writeFile(outsidePlan, yield* real.readFile(plan));
            yield* real.rename(notes, kept);
            yield* real.symlink(path.dirname(outsidePlan), notes);
          });
          return {
            ...real,
            rename: (from: string, to: string) =>
              real
                .rename(from, to)
                .pipe(Effect.tap(() => (armed && to === statePath ? swap : Effect.void))),
          };
        }),
      );
      yield* Effect.gen(function* () {
        const { store, file, read } = yield* setupFile;
        armed = true;
        const escaped = yield* store.writeDocument(
          {
            operationId: "escape",
            documentId: file.id,
            expectedSha256: read.sha256!,
            content: "Written beyond registered root\n",
          },
          actor,
        );
        expect(armed).toBe(false);
        expect(escaped.outcome).toBe("pending");
        const write = escaped.state.pendingWrites[0]!;
        expect(write).toMatchObject({ status: "pending", documentId: file.id });
        expect(yield* fs.readFileString(outsidePlan)).toBe(read.content!);
        expect(yield* fs.readFileString(path.join(kept, "plan.md"))).toBe(read.content!);
        // Recovery resolves the path again and refuses the same escape.
        const refused = yield* store
          .recoverWrite({ operationId: "escape-recover", writeId: write.id }, actor)
          .pipe(Effect.flip);
        expect(refused.reason).toBe("invalid");
        expect(yield* fs.readFileString(outsidePlan)).toBe(read.content!);
        expect((yield* store.get).pendingWrites).toEqual([write]);
        yield* fs.remove(notes);
        yield* fs.rename(kept, notes);
        const recovered = yield* store.recoverWrite(
          { operationId: "escape-recover-2", writeId: write.id },
          actor,
        );
        expect(recovered.outcome).toBe("saved");
        expect(yield* fs.readFileString(plan)).toBe("Written beyond registered root\n");
        expect(yield* fs.readFileString(outsidePlan)).toBe(read.content!);
      }).pipe(
        Effect.provide(QuestStore.layer.pipe(Layer.provide(config), Layer.provide(swapping))),
        Effect.provideService(WorkspaceRoot, { plan }),
      );
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("keeps an interrupted save pending and recovers it from the file's actual bytes", () =>
    Effect.gen(function* () {
      const { config, plan, statePath } = yield* workspaceHarness;
      const fs = yield* FileSystem.FileSystem;
      let failFileReplace = false;
      let failStateCommits = 0;
      let stateCommits = 0;
      const flaky = QuestStore.layer.pipe(
        Layer.provide(config),
        Layer.provide(
          failingRename((from, to) => {
            if (to === plan && failFileReplace) return true;
            if (to !== statePath) return false;
            stateCommits += 1;
            return failStateCommits > 0 && stateCommits === failStateCommits;
          }),
        ),
      );
      yield* Effect.gen(function* () {
        const { store, file, read } = yield* setupFile;
        // Write boundary: the intent is durable, the file is unchanged, and nothing claims success.
        failFileReplace = true;
        const interrupted = yield* store.writeDocument(
          {
            operationId: "a",
            documentId: file.id,
            expectedSha256: read.sha256!,
            content: "Desired\n",
          },
          actor,
        );
        failFileReplace = false;
        expect(interrupted.outcome).toBe("pending");
        expect(interrupted.state.pendingWrites[0]).toMatchObject({ status: "pending" });
        expect(yield* fs.readFileString(plan)).toBe(read.content!);
        const unchanged = yield* store.get;
        yield* store.readDocument(file.id);
        expect(yield* store.get).toEqual(unchanged);
        // An editor's temp-file rename onto the same path keeps the save's target.
        yield* fs.writeFileString(`${plan}.editor`, read.content!);
        yield* fs.rename(`${plan}.editor`, plan);
        const retried = yield* store.recoverWrite(
          { operationId: "a-recover", writeId: interrupted.state.pendingWrites[0]!.id },
          actor,
        );
        expect(retried.outcome).toBe("saved");
        expect(yield* fs.readFileString(plan)).toBe("Desired\n");
        // A lost response is retried: the original save and the recovery both report what happened.
        const original = yield* store.writeDocument(
          {
            operationId: "a",
            documentId: file.id,
            expectedSha256: read.sha256!,
            content: "Desired\n",
          },
          actor,
        );
        const recoveredAgain = yield* store.recoverWrite(
          { operationId: "a-recover", writeId: interrupted.state.pendingWrites[0]!.id },
          actor,
        );
        expect([original.outcome, recoveredAgain.outcome]).toEqual(["saved", "saved"]);
        expect(original.state.revision).toBe(retried.state.revision);
        expect(recoveredAgain.state.revision).toBe(retried.state.revision);
        expect(original.file.content).toBe("Desired\n");

        // Finalization boundary: the file holds the new bytes, but the Quest still reports pending.
        failStateCommits = stateCommits + 2;
        const unfinalized = yield* store
          .writeDocument(
            {
              operationId: "b",
              documentId: file.id,
              expectedSha256: retried.file.sha256!,
              content: "Second desired\n",
            },
            actor,
          )
          .pipe(Effect.flip);
        expect(unfinalized.reason).toBe("storage");
        expect(yield* fs.readFileString(plan)).toBe("Second desired\n");
        const pending = (yield* store.get).pendingWrites[0]!;
        expect(pending.status).toBe("pending");
        const finalized = yield* store.recoverWrite(
          { operationId: "b-recover", writeId: pending.id },
          actor,
        );
        expect(finalized.outcome).toBe("saved");
        expect(finalized.state.pendingWrites).toEqual([]);

        // A third version found during recovery is a conflict; it is never overwritten or rolled back.
        failFileReplace = true;
        const third = yield* store.writeDocument(
          {
            operationId: "c",
            documentId: file.id,
            expectedSha256: finalized.file.sha256!,
            content: "Third desired\n",
          },
          actor,
        );
        failFileReplace = false;
        yield* fs.writeFileString(plan, "Someone else\n");
        const conflict = yield* store.recoverWrite(
          { operationId: "c-recover", writeId: third.state.pendingWrites[0]!.id },
          actor,
        );
        expect(conflict.outcome).toBe("conflict");
        expect(conflict.state.pendingWrites[0]).toMatchObject({ status: "conflict" });
        expect(yield* fs.readFileString(plan)).toBe("Someone else\n");
        expect(
          (yield* store.retained(conflict.state.pendingWrites[0]!.actualSha256!)).content,
        ).toBe("Someone else\n");
      }).pipe(Effect.provide(flaky), Effect.provideService(WorkspaceRoot, { plan }));
    }).pipe(Effect.provide(NodeServices.layer)),
  );
  // A filesystem that records workspace reads and can fail document replacement on demand.
  const observedFs = (control: {
    failRenameTo: string | null;
    reads: Array<string>;
    afterRead: (path: string) => Effect.Effect<void>;
  }) =>
    Layer.effect(
      FileSystem.FileSystem,
      Effect.gen(function* () {
        const real = yield* FileSystem.FileSystem;
        return {
          ...real,
          readFile: (target: string) =>
            Effect.sync(() => control.reads.push(target)).pipe(
              Effect.andThen(real.readFile(target)),
              Effect.tap(() => control.afterRead(target)),
            ),
          rename: (from: string, to: string) =>
            to === control.failRenameTo
              ? Effect.fail(
                  PlatformError.systemError({
                    _tag: "PermissionDenied",
                    module: "FileSystem",
                    method: "rename",
                  }),
                )
              : real.rename(from, to),
        };
      }),
    );

  it.effect.each(
    (["root", "inside"] as const).flatMap((swap) =>
      (["expected", "desired"] as const).flatMap((found) =>
        (["before recovery", "after recovery reads"] as const).map((when) => ({
          swap,
          found,
          when,
        })),
      ),
    ),
  )(
    "binds a pending save to its target: $swap swapped $when, $found bytes",
    ({ swap, found, when }) =>
      Effect.gen(function* () {
        const { config, plan, statePath, workspace, outside } = yield* workspaceHarness;
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const notes = path.join(workspace, "notes");
        const first = path.join(workspace, "first");
        const second = path.join(workspace, "second");
        const moved = `${workspace}-moved`;
        if (swap === "inside") {
          yield* fs.rename(notes, first);
          yield* fs.makeDirectory(second);
          yield* fs.symlink(first, notes);
        }
        const original = yield* fs.realPath(plan);
        const replacement =
          swap === "root" ? path.join(outside, "notes", "plan.md") : path.join(second, "plan.md");
        const control = {
          failRenameTo: null as string | null,
          reads: [] as Array<string>,
          afterRead: (_: string) => Effect.void,
        };
        const retarget = Effect.gen(function* () {
          if (swap === "root") {
            yield* fs.rename(workspace, moved);
            yield* fs.symlink(outside, workspace);
          } else {
            yield* fs.remove(notes);
            yield* fs.symlink(second, notes);
          }
        });
        const restore = Effect.gen(function* () {
          yield* fs.remove(swap === "root" ? workspace : notes);
          if (swap === "root") yield* fs.rename(moved, workspace);
          else yield* fs.symlink(first, notes);
        });
        const store = <A, E, R>(body: Effect.Effect<A, E, R>) =>
          body.pipe(
            Effect.provide(
              QuestStore.layer.pipe(Layer.provide(config), Layer.provide(observedFs(control))),
            ),
          );
        let writeId = "";
        let documentId = "";
        let baseline = "";
        yield* store(
          Effect.gen(function* () {
            const { store, file, read } = yield* setupFile;
            yield* fs.makeDirectory(path.dirname(replacement), { recursive: true });
            yield* fs.writeFileString(
              replacement,
              found === "expected" ? read.content! : "Desired\n",
            );
            control.failRenameTo = original;
            const interrupted = yield* store.writeDocument(
              {
                operationId: "bound",
                documentId: file.id,
                expectedSha256: read.sha256!,
                content: "Desired\n",
              },
              actor,
            );
            control.failRenameTo = null;
            expect(interrupted.outcome).toBe("pending");
            const write = interrupted.state.pendingWrites[0]!;
            writeId = write.id;
            documentId = file.id;
            baseline = read.content!;
            expect(write.target).toEqual({
              root: yield* fs.realPath(workspace),
              real: original,
            });
          }).pipe(Effect.provideService(WorkspaceRoot, { plan })),
        );
        // The binding is durable, so a restarted store recovers against the same target.
        const persisted = yield* fs.readFileString(statePath);
        expect(persisted).toContain(original);
        if (when === "before recovery") yield* retarget;
        else
          control.afterRead = (target) =>
            target === original
              ? Effect.sync(() => {
                  control.afterRead = () => Effect.void;
                }).pipe(Effect.andThen(retarget), Effect.orDie)
              : Effect.void;
        control.reads = [];
        yield* store(
          Effect.gen(function* () {
            const store = yield* legacyQuest;
            const recovered = yield* store
              .recoverWrite({ operationId: "bound-recover", writeId }, actor)
              .pipe(Effect.result);
            // Whatever the replacement holds, it is never read, written or accepted as saved.
            expect(control.reads).not.toContain(replacement);
            expect(yield* fs.readFileString(replacement)).toBe(
              found === "expected" ? baseline : "Desired\n",
            );
            if (recovered._tag === "Success") expect(recovered.success.outcome).toBe("pending");
            else expect(recovered.failure).toMatchObject({ reason: "unavailable" });
            expect(yield* fs.readFileString(statePath)).toBe(persisted);
            // Retrying the original save reports it unresolved without reading elsewhere.
            const retried = yield* store.writeDocument(
              { operationId: "bound", documentId, expectedSha256: "", content: "" },
              actor,
            );
            expect(retried.outcome).toBe("pending");
            expect(retried.file).toMatchObject({ content: null, sha256: null });
            if (swap === "root") {
              expect((yield* store.readDocument(documentId)).content).toBeNull();
              expect((yield* Effect.flip(store.workspaceFiles)).reason).toBe("unavailable");
            }
            expect(control.reads).not.toContain(replacement);
            yield* restore;
            const after = yield* store.recoverWrite(
              { operationId: "bound-recover-2", writeId },
              actor,
            );
            expect(after.outcome).toBe("saved");
            expect(yield* fs.readFileString(original)).toBe("Desired\n");
            expect(yield* fs.readFileString(replacement)).toBe(
              found === "expected" ? baseline : "Desired\n",
            );
          }),
        );
      }).pipe(Effect.provide(NodeServices.layer)),
  );
  it.effect("refuses to finish a save recorded without its target and keeps every version", () =>
    Effect.gen(function* () {
      const { config, plan, statePath } = yield* workspaceHarness;
      const fs = yield* FileSystem.FileSystem;
      const control = {
        failRenameTo: null as string | null,
        reads: [] as Array<string>,
        afterRead: (_: string) => Effect.void,
      };
      const layer = QuestStore.layer.pipe(
        Layer.provide(config),
        Layer.provide(observedFs(control)),
      );
      const real = yield* fs.realPath(plan);
      const { file, read, write } = yield* Effect.gen(function* () {
        const { store, file, read } = yield* setupFile;
        control.failRenameTo = real;
        const interrupted = yield* store.writeDocument(
          {
            operationId: "legacy",
            documentId: file.id,
            expectedSha256: read.sha256!,
            content: "Desired\n",
          },
          actor,
        );
        control.failRenameTo = null;
        return { file, read, write: interrupted.state.pendingWrites[0]! };
      }).pipe(Effect.provide(layer), Effect.provideService(WorkspaceRoot, { plan }));
      // Rewrite the store as a pre-binding server left it: same records, no target anywhere.
      const unbind = (value: unknown): unknown =>
        Array.isArray(value)
          ? value.map(unbind)
          : typeof value === "object" && value !== null
            ? Object.fromEntries(
                Object.entries(value)
                  .filter(([key]) => !(key === "target" && "desiredSha256" in value))
                  .map(([key, item]) => [key, unbind(item)]),
              )
            : value;
      yield* fs.writeFileString(
        statePath,
        JSON.stringify(unbind(JSON.parse(yield* fs.readFileString(statePath)))),
      );
      const legacy = yield* fs.readFileString(statePath);
      expect(legacy).not.toContain(real);
      yield* Effect.gen(function* () {
        const store = yield* legacyQuest;
        const { target: _, ...unbound } = write;
        control.reads = [];
        for (const content of [read.content!, "Desired\n", "Someone else\n"]) {
          yield* fs.writeFileString(plan, content);
          const refused = yield* store
            .recoverWrite(
              { operationId: `legacy-recover-${content.length}`, writeId: write.id },
              actor,
            )
            .pipe(Effect.flip);
          expect(refused.reason).toBe("unavailable");
          const retried = yield* store.writeDocument(
            { operationId: "legacy", documentId: file.id, expectedSha256: "", content: "" },
            actor,
          );
          expect(retried).toMatchObject({ outcome: "pending", file: { content: null } });
        }
        expect(control.reads).toEqual([]);
        expect(yield* fs.readFileString(statePath)).toBe(legacy);
        const state = yield* store.get;
        expect(state.pendingWrites).toEqual([unbound]);
        expect((yield* store.retained(write.desiredSha256)).content).toBe("Desired\n");
        const history = yield* store.reconstruct(state.revision);
        expect(history.domain.pendingWrites).toEqual([unbound]);
        // Discarding stays the owner's way out; the versions remain retained.
        const discarded = yield* store.update(
          {
            expectedRevision: state.revision,
            change: { type: "write-discard", writeId: write.id },
          },
          actor,
        );
        expect(discarded.pendingWrites).toEqual([]);
        expect((yield* store.retained(write.desiredSha256)).content).toBe("Desired\n");
        expect(
          (yield* store
            .recoverWrite({ operationId: "legacy-recover-after", writeId: write.id }, actor)
            .pipe(Effect.flip)).reason,
        ).toBe("invalid");
      }).pipe(Effect.provide(layer));
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});

describe("QuestStore plan coordination", () => {
  const mapThread = "thread-map-semantics";
  const docsThread = "thread-decisions-documents";
  const agentOf = (threadId: string) => ({ kind: "agent", id: threadId }) as const;

  it.effect(
    "carries one discussion's result into another's plan proposal and applies only what the owner selects on an unchanged base",
    () =>
      Effect.gen(function* () {
        const { layer } = yield* harness;
        yield* Effect.gen(function* () {
          const store = yield* legacyQuest;
          let state = yield* store.get;
          const save = (change: QuestUpdateInput["change"], operationId?: string) =>
            store.update(
              {
                expectedRevision: state.revision,
                change,
                ...(operationId === undefined ? {} : { operationId }),
              },
              actor,
            );
          for (const [threadId, workId] of [
            [mapThread, "a4-demonstration"],
            [docsThread, "n1a-navigation"],
          ] as const)
            state = yield* save({
              type: "link",
              threadId,
              projectId: null,
              title: threadId,
              workId,
              questionId: null,
              purposeKind: "discuss-work",
              purpose: threadId,
              context: "fork",
            });
          const mapContextRevision = state.conversations.find(
            (item) => item.threadId === mapThread,
          )!.sourceRevision!;

          const recorded = yield* store.contribute(
            {
              source: { threadId: docsThread, runId: "run-docs-1" },
              change: {
                type: "contribution-record",
                contribution: {
                  title: "Decisions and documents delivered",
                  summary: "Decisions answer in the main area; documents read as one pane.",
                  candidate: "cebec1c641..2de8dfe196",
                  evidence: [{ kind: "commit", ref: "2de8dfe196", note: "real diff refresh" }],
                  limitations: "Drafts are session-only.",
                  openQuestions: "",
                  affectedWorkIds: ["a4-demonstration"],
                  supersedes: null,
                  contextRevision: mapContextRevision,
                },
              },
            },
            agentOf(docsThread),
          );
          state = recorded.state;
          const result = state.contributions.find((item) => item.id === recorded.id)!;
          expect(result).toMatchObject({
            provenance: "observed",
            source: { threadId: docsThread, runId: "run-docs-1" },
            workId: "n1a-navigation",
            disposition: "open",
          });
          // A client cannot claim an agent's identity: the same record from it is only reported.
          const reported = yield* store.contribute(
            {
              source: { threadId: docsThread, runId: null },
              change: {
                type: "contribution-record",
                contribution: {
                  title: "Reported copy",
                  summary: result.summary,
                  candidate: "",
                  evidence: [],
                  limitations: "",
                  openQuestions: "",
                  affectedWorkIds: [],
                  supersedes: null,
                  contextRevision: null,
                },
              },
            },
            actor,
          );
          expect(reported.state.contributions.at(-1)).toMatchObject({
            id: "result-2",
            provenance: "reported",
          });
          state = reported.state;

          const mapView = questAgentContext(state, mapThread, LEGACY_QUEST);
          expect(mapView.results.find((item) => item.id === result.id)).toMatchObject({
            affectsYourWork: true,
            newSinceYourContext: true,
            fromYou: false,
          });

          const proposalInput = {
            source: { threadId: mapThread, runId: "run-map-1" },
            operationId: "propose-once",
            change: {
              type: "plan-propose",
              proposal: {
                title: "Two discussions, one plan",
                rationale: "The delivered documents flow is the base for map semantics.",
                contributionIds: [result.id],
                supersedes: null,
                edits: [
                  {
                    type: "add-work",
                    work: {
                      id: "two-discussions",
                      parentId: "milestone-a",
                      title: "Two discussions, one plan",
                      state: "planned",
                      understanding: "Reconcile parallel discussions into one plan.",
                      focus: 4,
                    },
                  },
                  { type: "add-follows", from: "two-discussions", to: "n1a-navigation" },
                  { type: "set-current", workId: "two-discussions" },
                  {
                    type: "associate-conversation",
                    threadId: mapThread,
                    workId: "two-discussions",
                  },
                  { type: "change-work", workId: "a4-demonstration", after: { state: "deferred" } },
                ],
              },
            },
          } as const;
          const proposed = yield* store.contribute(proposalInput, agentOf(mapThread));
          const retried = yield* store.contribute(proposalInput, agentOf(mapThread));
          expect(retried.id).toBe(proposed.id);
          expect(retried.state.proposals).toHaveLength(1);
          state = proposed.state;
          const proposal = state.proposals[0]!;
          expect(proposal).toMatchObject({ provenance: "observed", status: "proposed" });
          expect(state.work.some((item) => item.id === "two-discussions")).toBe(false);

          const agentApply = yield* store
            .update(
              {
                expectedRevision: state.revision,
                change: {
                  type: "plan-decide",
                  proposalId: proposal.id,
                  decision: "apply",
                  selectedEditIds: ["edit-1"],
                  note: "",
                },
              },
              agentOf(mapThread),
            )
            .pipe(Effect.flip);
          expect(agentApply.message).toContain("Only the Quest owner");

          // Unrelated to edit-5's field: does not block. Its own field: makes it stale.
          const a4 = state.work.find((item) => item.id === "a4-demonstration")!;
          state = yield* save({ type: "work", work: { ...a4, title: "A4 renamed by the owner" } });
          state = yield* save({
            type: "work",
            work: { ...state.work.find((item) => item.id === a4.id)!, state: "review" },
          });
          const all = proposal.edits.map((edit) => edit.id);
          const refused = yield* save({
            type: "plan-decide",
            proposalId: proposal.id,
            decision: "apply",
            selectedEditIds: all,
            note: "",
          }).pipe(Effect.flip);
          expect(refused.message).toContain("Nothing was applied");
          expect(refused.message).toContain("Changed since proposed: state");
          expect((yield* store.get).revision).toBe(state.revision);

          const before = state;
          const selected = all.filter((id) => id !== "edit-5");
          const decide = {
            type: "plan-decide",
            proposalId: proposal.id,
            decision: "apply",
            selectedEditIds: selected,
            note: "A4 stays in review.",
          } as const;
          state = yield* save(decide, "apply-once");
          const replay = yield* store.update(
            { expectedRevision: before.revision, operationId: "apply-once", change: decide },
            actor,
          );
          expect(replay.revision).toBe(state.revision);
          const twice = yield* save(decide).pipe(Effect.flip);
          expect(twice.message).toContain("applied");

          expect(state.work.find((item) => item.id === "two-discussions")).toMatchObject({
            parentId: "milestone-a",
            focus: 4,
          });
          expect(state.work.find((item) => item.id === a4.id)?.state).toBe("review");
          expect(state.currentWorkId).toBe("two-discussions");
          expect(state.relations.at(-1)).toMatchObject({
            id: "follows:two-discussions:n1a-navigation",
            provenance: "plan",
          });
          const moved = state.conversations.find((item) => item.threadId === mapThread)!;
          expect(moved).toMatchObject({ workId: "two-discussions", origin: null });
          expect(state.proposals[0]).toMatchObject({ status: "applied" });
          expect(state.proposals[0]!.decisions.at(-1)?.selectedEditIds).toEqual(selected);
          expect(state.contributions.find((item) => item.id === result.id)).toMatchObject({
            disposition: "incorporated",
            dispositionBy: { proposalId: proposal.id, revision: state.revision },
          });
          expect(state.history.at(-1)?.changes.at(-2)).toMatchObject({ label: "Not applied" });

          for (const threadId of [mapThread, docsThread]) {
            const view = questAgentContext(state, threadId, LEGACY_QUEST);
            expect(view.plan.currentWorkId).toBe("two-discussions");
            expect(view.proposals[0]).toMatchObject({ status: "applied" });
            expect(view.sinceYourContext?.appliedPlanChanges).toEqual([proposal.id]);
            expect(view.results.find((item) => item.id === result.id)?.disposition).toBe(
              "incorporated",
            );
          }
          const past = yield* store.reconstruct(proposal.baseRevision);
          expect(past.domain.currentWorkId).toBe("milestone-a");
          expect(past.domain.contributions.find((item) => item.id === result.id)).toMatchObject({
            disposition: "open",
            contextRevision: mapContextRevision,
          });
        }).pipe(Effect.provide(layer));

        yield* Effect.gen(function* () {
          const reopened = yield* (yield* legacyQuest).get;
          expect(reopened.proposals[0]?.status).toBe("applied");
          expect(reopened.contributions[0]?.provenance).toBe("observed");
        }).pipe(Effect.provide(layer));
      }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("supersedes only open records and only from the discussion that recorded them", () =>
    Effect.gen(function* () {
      const { layer } = yield* harness;
      yield* Effect.gen(function* () {
        const store = yield* legacyQuest;
        const draft = {
          title: "First result",
          summary: "First",
          candidate: "",
          evidence: [],
          limitations: "",
          openQuestions: "",
          affectedWorkIds: [],
          supersedes: null,
          contextRevision: null,
        };
        const source = { threadId: docsThread, runId: null };
        const first = yield* store.contribute(
          { source, change: { type: "contribution-record", contribution: draft } },
          agentOf(docsThread),
        );
        const foreign = yield* store
          .contribute(
            {
              source: { threadId: mapThread, runId: null },
              change: {
                type: "contribution-record",
                contribution: { ...draft, supersedes: first.id },
              },
            },
            agentOf(mapThread),
          )
          .pipe(Effect.flip);
        expect(foreign.message).toContain("Only the discussion that recorded");
        const second = yield* store.contribute(
          {
            source,
            change: {
              type: "contribution-record",
              contribution: { ...draft, title: "Second", supersedes: first.id },
            },
          },
          agentOf(docsThread),
        );
        expect(second.state.contributions.map((item) => item.disposition)).toEqual([
          "superseded",
          "open",
        ]);
        expect(second.state.contributions[0]?.summary).toBe("First");

        const propose = (supersedes: string | null) =>
          store.contribute(
            {
              source,
              change: {
                type: "plan-propose",
                proposal: {
                  title: supersedes ? "Revised" : "Original",
                  rationale: "",
                  contributionIds: [],
                  supersedes,
                  edits: [{ type: "set-current", workId: "a4-demonstration" }],
                },
              },
            },
            agentOf(docsThread),
          );
        const original = yield* propose(null);
        const revised = yield* propose(original.id);
        expect(revised.state.proposals.map((item) => item.status)).toEqual([
          "superseded",
          "proposed",
        ]);
        expect(revised.state.proposals[0]?.decisions[0]).toMatchObject({
          byProposalId: revised.id,
        });
        const declined = yield* store.update(
          {
            expectedRevision: revised.state.revision,
            change: {
              type: "plan-decide",
              proposalId: revised.id!,
              decision: "decline",
              selectedEditIds: [],
              note: "Not now",
            },
          },
          actor,
        );
        const reopened = yield* store.update(
          {
            expectedRevision: declined.revision,
            change: {
              type: "plan-decide",
              proposalId: revised.id!,
              decision: "reopen",
              selectedEditIds: [],
              note: "",
            },
          },
          actor,
        );
        expect(reopened.proposals[1]?.decisions.map((item) => item.status)).toEqual([
          "declined",
          "proposed",
        ]);
        expect((yield* propose(original.id).pipe(Effect.flip)).message).toContain("not open");
      }).pipe(Effect.provide(layer));
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});

describe("QuestStore several Quests", () => {
  const work = (id: string, parentId: string | null = null) => ({
    id,
    parentId,
    kind: "work" as const,
    title: `Work ${id}`,
    state: "planned" as const,
    owner: "",
    agent: "",
    understanding: "",
    documentIds: [],
    priorAttempts: "",
    findings: "",
    handoff: "",
  });

  it.effect(
    "keeps a created Quest separate from the historical one and never resolves an unknown id",
    () =>
      Effect.gen(function* () {
        const { layer, directory } = yield* harness;
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        yield* Effect.gen(function* () {
          const store = yield* QuestStore.QuestStore;
          const legacy = yield* store.quest(QUEST_DEFAULT_ID);
          const historical = yield* legacy.update(
            {
              expectedRevision: (yield* legacy.get).revision,
              change: {
                type: "link",
                threadId: "thread-shared",
                projectId: null,
                title: "Historical",
                workId: null,
                questionId: null,
              },
            },
            actor,
          );
          const legacyFile = path.join(directory, "userdata", "quest-prototype", "state.json");
          const legacyBytes = yield* fs.readFileString(legacyFile);

          const created = yield* store.create({ questId: "t3-quests", title: "Quests in T3" });
          expect(created).toMatchObject({ revision: 0, work: [], conversations: [] });
          expect(yield* store.create({ questId: "t3-quests", title: "Quests in T3" })).toEqual(
            created,
          );
          expect(
            (yield* store.create({ questId: "t3-quests", title: "Other" }).pipe(Effect.flip))
              .reason,
          ).toBe("invalid");
          expect(
            (yield* store
              .create({ questId: QUEST_DEFAULT_ID, title: "Market tracking" })
              .pipe(Effect.flip)).reason,
          ).toBe("invalid");
          expect((yield* store.quest("missing").pipe(Effect.flip)).reason).toBe("unavailable");

          const real = yield* store.quest("t3-quests");
          const added = yield* real.update(
            { expectedRevision: 0, change: { type: "work-add", work: work("milestone") } },
            actor,
          );
          const child = yield* real.update(
            {
              expectedRevision: added.revision,
              change: { type: "work-add", work: work("part", "milestone") },
            },
            actor,
          );
          expect(
            (yield* real
              .update(
                {
                  expectedRevision: child.revision,
                  change: { type: "work-add", work: work("part") },
                },
                actor,
              )
              .pipe(Effect.flip)).reason,
          ).toBe("invalid");
          const referenced = yield* real.update(
            {
              expectedRevision: child.revision,
              change: {
                type: "external-conversation",
                conversation: {
                  environmentId: "env-elsewhere",
                  threadId: "thread-original",
                  title: "Original",
                  forkOf: null,
                  workId: "milestone",
                  purpose: "Design",
                },
              },
            },
            actor,
          );
          // A thread belongs to one Quest; linking it into a second is refused.
          const refused = yield* real
            .update(
              {
                expectedRevision: referenced.revision,
                change: {
                  type: "link",
                  threadId: "thread-shared",
                  projectId: null,
                  title: "Again",
                  workId: null,
                  questionId: null,
                },
              },
              actor,
            )
            .pipe(Effect.flip);
          expect(refused.message).toContain("Market tracking");

          expect(yield* fs.readFileString(legacyFile)).toBe(legacyBytes);
          expect((yield* legacy.get).work.some((item) => item.id === "milestone")).toBe(false);
          expect((yield* store.memberQuest("thread-shared"))?.identity.id).toBe(QUEST_DEFAULT_ID);
          expect(yield* store.memberQuest("thread-original")).toBeNull();
          expect((yield* store.threadLink("thread-shared"))?.questId).toBe(QUEST_DEFAULT_ID);
          expect(
            (yield* store.catalog).quests.map((item) => [item.questId, item.revision]),
          ).toEqual([
            [QUEST_DEFAULT_ID, historical.revision],
            ["t3-quests", referenced.revision],
          ]);
          const context = questAgentContext(referenced, null, real.identity);
          expect(context).toMatchObject({
            questId: "t3-quests",
            caller: null,
            externalConversations: [
              { environmentId: "env-elsewhere", threadId: "thread-original" },
            ],
          });
          const baseline = yield* real.reconstruct(0);
          expect(baseline.domain.work).toEqual([]);
          expect(baseline.limit).toContain("created in T3 Code");
          expect(
            (yield* real.reconstruct(child.revision)).domain.work.map((item) => item.id),
          ).toEqual(["milestone", "part"]);
        }).pipe(Effect.provide(layer));
      }).pipe(Effect.provide(NodeServices.layer)),
  );
});

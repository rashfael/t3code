import { QuestError, QuestState, type QuestUpdateInput } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import * as ServerConfig from "../config.ts";
import { questSeed } from "./questSeed.ts";

export class QuestStore extends Context.Service<
  QuestStore,
  {
    readonly get: Effect.Effect<QuestState, QuestError>;
    readonly update: (input: QuestUpdateInput) => Effect.Effect<QuestState, QuestError>;
  }
>()("t3/quest/QuestStore") {}

const encodeState = Schema.encodeEffect(Schema.fromJsonString(QuestState));
const decodeState = Schema.decodeEffect(Schema.fromJsonString(QuestState));
const decodeSeed = Schema.decodeEffect(QuestState);

function changeState(current: QuestState, input: QuestUpdateInput): QuestState | null {
  const change = input.change;
  switch (change.type) {
    case "work": {
      const work = change.work;
      if (
        !current.work.some((item) => item.id === work.id) ||
        work.parentId === work.id ||
        !work.title.trim() ||
        work.documentIds.some((id) => !current.documents.some((doc) => doc.id === id))
      )
        return null;
      let parent = work.parentId;
      const visited = new Set([work.id]);
      while (parent !== null) {
        if (visited.has(parent)) return null;
        visited.add(parent);
        const item = current.work.find((candidate) => candidate.id === parent);
        if (!item) return null;
        parent = item.parentId;
      }
      return { ...current, work: current.work.map((item) => (item.id === work.id ? work : item)) };
    }
    case "document": {
      const existing = current.documents.find((item) => item.id === change.document.id);
      if (
        !existing ||
        existing.kind === "evidence" ||
        change.document.kind !== existing.kind ||
        change.document.source !== existing.source ||
        change.document.sha256 !== existing.sha256 ||
        !change.document.title.trim()
      )
        return null;
      return {
        ...current,
        documents: current.documents.map((item) =>
          item.id === change.document.id ? change.document : item,
        ),
      };
    }
    case "answer": {
      const question = current.questions.find((item) => item.id === change.questionId);
      if (!question || question.applied || (!change.deferred && !change.answer?.trim()))
        return null;
      return {
        ...current,
        questions: current.questions.map((item) =>
          item.id === question.id
            ? { ...item, answer: change.answer, deferred: change.deferred }
            : item,
        ),
      };
    }
    case "reopen": {
      const question = current.questions.find((item) => item.id === change.questionId);
      if (!question || !question.applied) return null;
      return {
        ...current,
        questions: current.questions.map((item) =>
          item.id === question.id ? { ...item, applied: false, deferred: false } : item,
        ),
      };
    }
    case "apply": {
      const question = current.questions.find((item) => item.id === change.questionId);
      if (
        !question ||
        question.applied ||
        question.deferred ||
        !question.answer?.trim() ||
        !current.work.some((item) => item.id === question.workId)
      )
        return null;
      return {
        ...current,
        questions: current.questions.map((item) =>
          item.id === question.id ? { ...item, applied: true } : item,
        ),
        work: current.work.map((item) =>
          item.id === question.workId
            ? {
                ...item,
                understanding: `${item.understanding}\n\nApplied answer (${question.id}): ${question.answer}`,
              }
            : item,
        ),
      };
    }
  }
}

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const mutex = yield* Semaphore.make(1);
  const directory = path.join(config.stateDir, "quest-prototype");
  const statePath = path.join(directory, "state.json");
  const pendingPath = path.join(directory, "state.pending.json");

  const persist = Effect.fn("QuestStore.persist")(
    function* (state: QuestState) {
      yield* fs.makeDirectory(directory, { recursive: true });
      const encoded = yield* encodeState(state);
      yield* fs.writeFileString(pendingPath, encoded);
      yield* fs.rename(pendingPath, statePath);
    },
    Effect.mapError((cause) => new QuestError({ reason: "storage", cause })),
  );

  const read = Effect.fn("QuestStore.read")(function* () {
    const exists = yield* fs
      .exists(statePath)
      .pipe(Effect.mapError((cause) => new QuestError({ reason: "storage", cause })));
    if (!exists) {
      const seed = yield* decodeSeed(questSeed).pipe(
        Effect.mapError((cause) => new QuestError({ reason: "storage", cause })),
      );
      yield* persist(seed);
      return seed;
    }
    const encoded = yield* fs
      .readFileString(statePath)
      .pipe(Effect.mapError((cause) => new QuestError({ reason: "storage", cause })));
    return yield* decodeState(encoded).pipe(
      Effect.mapError((cause) => new QuestError({ reason: "storage", cause })),
    );
  });

  const update = Effect.fn("QuestStore.update")(function* (input: QuestUpdateInput) {
    const current = yield* read();
    if (input.expectedRevision !== current.revision)
      return yield* new QuestError({ reason: "conflict" });
    const changed = changeState(current, input);
    if (!changed) return yield* new QuestError({ reason: "invalid" });
    const next = { ...changed, revision: current.revision + 1 };
    yield* persist(next);
    return next;
  }, mutex.withPermits(1));

  return QuestStore.of({ get: mutex.withPermits(1)(read()), update });
});

export const layer = Layer.effect(QuestStore, make);

import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { ProviderInstanceId, type QuestOpenConversationInput } from "@t3tools/contracts";
import { QUEST_DEFAULT_ID } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import * as ServerConfig from "../config.ts";
import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as QuestConversations from "./QuestConversations.ts";
import * as QuestStore from "./QuestStore.ts";

const legacyQuest = Effect.gen(function* () {
  const store = yield* QuestStore.QuestStore;
  return yield* store.quest(QUEST_DEFAULT_ID);
});

const actor = { kind: "client", id: null } as const;
const files = { readFiles: true } as const;
const selection = { instanceId: ProviderInstanceId.make("replay"), model: "replay" };

function input(operationId: string): QuestOpenConversationInput {
  return {
    operationId,
    role: "core",
    purposeKind: "coordinate",
    purpose: "",
    workId: null,
    questionId: null,
    resume: true,
    projectId: "project-1",
    modelSelection: selection,
    runtimeMode: "full-access",
    interactionMode: "default",
  };
}

/** Launch and shell lookups for one thread; `deleted` mimics a tombstone. */
function orchestration(options: { failFirstLaunch: boolean }) {
  const launches: Array<ThreadLaunchService.ThreadLaunchInput> = [];
  const threads = new Map<string, { deletedAt: string | null }>();
  const layer = Layer.mergeAll(
    Layer.mock(ThreadLaunchService.ThreadLaunchService)({
      launch: (request) =>
        Effect.gen(function* () {
          launches.push(request);
          if (options.failFirstLaunch && launches.length === 1)
            return yield* new ThreadLaunchService.ThreadLaunchError({
              operation: "create-thread",
              commandId: request.commandId,
              projectId: request.projectId,
              cause: new Error("crashed before the thread existed"),
            });
          if (!threads.has(request.threadId!)) threads.set(request.threadId!, { deletedAt: null });
          return {
            threadId: request.threadId!,
            resumed: false,
            projection: { thread: { modelSelection: { ...selection, model: "effective" } } },
          } as never;
        }),
    }),
    Layer.mock(ThreadManagementService.ThreadManagementService)({
      getThreadShell: (threadId) => Effect.succeed((threads.get(threadId) ?? null) as never),
    }),
  );
  return { launches, threads, layer };
}

const harness = (options: { failFirstLaunch: boolean }) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3-quest-conversations-" });
    const fake = orchestration(options);
    const store = QuestStore.layer.pipe(
      Layer.provide(ServerConfig.layerTest(directory, directory)),
    );
    const layer = QuestConversations.layer.pipe(
      Layer.provideMerge(store),
      Layer.provide(fake.layer),
    );
    return { ...fake, layer };
  });

describe("QuestConversations", () => {
  it.effect(
    "creates the core without a message and retries a failed creation as the same thread",
    () =>
      Effect.gen(function* () {
        const { launches, layer } = yield* harness({ failFirstLaunch: true });
        yield* Effect.gen(function* () {
          const conversations = yield* QuestConversations.QuestConversations;
          const store = yield* legacyQuest;
          const failed = yield* conversations
            .open(QUEST_DEFAULT_ID, input("first"), actor, files)
            .pipe(Effect.flip);
          expect(failed.reason).toBe("unavailable");
          const reserved = (yield* store.get).conversations;
          expect(reserved).toEqual([
            expect.objectContaining({
              role: "core",
              creation: expect.objectContaining({ status: "reserved" }),
            }),
          ]);
          const opened = yield* conversations.open(QUEST_DEFAULT_ID, input("second"), actor, files);
          expect(opened.threadId).toBe(reserved[0]!.threadId);
          expect(launches.map((launch) => [launch.threadId, launch.commandId])).toEqual([
            [opened.threadId, "quest:first"],
            [opened.threadId, "quest:first"],
          ]);
          expect(launches.every((launch) => launch.initialMessage === undefined)).toBe(true);
          expect(opened.state.conversations[0]?.creation).toMatchObject({
            status: "ready",
            effectiveModelSelection: { model: "effective" },
          });
          const resumed = yield* conversations.open(QUEST_DEFAULT_ID, input("third"), actor, files);
          expect(resumed).toMatchObject({ threadId: opened.threadId, created: false });
          expect(launches).toHaveLength(2);
        }).pipe(Effect.provide(layer));
      }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("reports a deleted core instead of recreating or silently replacing it", () =>
    Effect.gen(function* () {
      const { launches, threads, layer } = yield* harness({ failFirstLaunch: false });
      yield* Effect.gen(function* () {
        const conversations = yield* QuestConversations.QuestConversations;
        const store = yield* legacyQuest;
        const opened = yield* conversations.open(QUEST_DEFAULT_ID, input("first"), actor, files);
        threads.set(opened.threadId, { deletedAt: "2026-11-01T00:00:00.000Z" });
        const missing = yield* conversations
          .open(QUEST_DEFAULT_ID, input("again"), actor, files)
          .pipe(Effect.flip);
        expect(missing.detail).toContain("Replace it");
        expect(launches).toHaveLength(1);
        expect((yield* store.get).conversations.map((item) => item.threadId)).toEqual([
          opened.threadId,
        ]);
      }).pipe(Effect.provide(layer));
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});

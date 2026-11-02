import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { QUEST_DEFAULT_ID } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../../../config.ts";
import * as Environment from "../../../environment/ServerEnvironment.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as QuestStore from "../../../quest/QuestStore.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { liveThreadShell } from "../../McpToolAccess.testkit.ts";
import * as QuestHandlers from "./handlers.ts";
import { QuestToolkit } from "./tools.ts";

const legacyQuest = Effect.gen(function* () {
  const store = yield* QuestStore.QuestStore;
  return yield* store.quest(QUEST_DEFAULT_ID);
});

const environmentId = EnvironmentId.make("environment:quest");
const threadId = ThreadId.make("thread:quest-discussion");

it.effect(
  "records a result as the calling discussion's own run and replays an identical call",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3-quest-mcp-test-" });
      const store = QuestStore.layer.pipe(
        Layer.provide(ServerConfig.layerTest(directory, directory)),
      );
      const dependencies = Layer.mergeAll(
        store,
        Layer.succeed(McpInvocationContext.McpInvocationContext, {
          environmentId,
          requestNamespace: "provider:quest",
          thread: {
            threadId,
            providerSessionId: "provider:quest",
            providerInstanceId: ProviderInstanceId.make("codex"),
          },
          client: undefined,
          capabilities: new Set(["orchestration" as const]),
          issuedAt: 0,
        }),
        Layer.mock(ThreadManagement.ThreadManagementService)({
          getThreadShell: () => Effect.succeed(liveThreadShell(threadId)),
        }),
        Layer.mock(Environment.ServerEnvironment)({
          getDescriptor: Effect.succeed({
            environmentId,
            label: "Test environment",
            platform: { os: "linux", arch: "x64" },
            serverVersion: "0.0.0-test",
            capabilities: { repositoryIdentity: true },
          }),
        }),
      );
      yield* Effect.gen(function* () {
        const toolkit = yield* QuestToolkit;
        const quest = yield* legacyQuest;
        const publish = toolkit
          .handle("t3_quest_publish_result", {
            title: "Documents delivered",
            summary: "Documents read as one pane.",
            affectedWorkIds: ["a4-demonstration"],
          })
          .pipe(Stream.unwrap, Stream.runCollect);
        const outsider = (yield* publish).at(-1)?.result;
        expect(outsider).toMatchObject({ code: "invalid_request" });

        // The caller's own membership picks the Quest, not the historical default.
        const store = yield* QuestStore.QuestStore;
        yield* store.create({ questId: "t3-quests", title: "Quests in T3" });
        const real = yield* store.quest("t3-quests");
        for (const [index, id] of ["n1a-navigation", "a4-demonstration"].entries())
          yield* real.update(
            {
              expectedRevision: index,
              change: {
                type: "work-add",
                work: {
                  id,
                  parentId: null,
                  kind: "work",
                  title: id,
                  state: "planned",
                  owner: "",
                  agent: "",
                  understanding: "",
                  documentIds: [],
                  priorAttempts: "",
                  findings: "",
                  handoff: "",
                },
              },
            },
            { kind: "client", id: null },
          );
        yield* real.update(
          {
            expectedRevision: 2,
            change: {
              type: "link",
              threadId,
              projectId: null,
              title: "Documents",
              workId: "n1a-navigation",
              questionId: null,
            },
          },
          { kind: "client", id: null },
        );
        const first = (yield* publish).at(-1)?.result;
        const again = (yield* publish).at(-1)?.result;
        expect(first).toMatchObject({ id: "result-1" });
        expect(again).toEqual(first);
        expect((yield* quest.get).contributions).toHaveLength(0);
        const saved = yield* real.get;
        expect(saved.contributions).toHaveLength(1);
        expect(saved.contributions[0]).toMatchObject({
          provenance: "observed",
          source: { threadId, runId: "run:mcp-test" },
          workId: "n1a-navigation",
        });

        // A real Claude turn passed the literal "current"; the refusal must point back to omitting it.
        const read = (params: { threadId?: ThreadId }) =>
          toolkit.handle("t3_quest_context", { environmentId, ...params }).pipe(
            Stream.unwrap,
            Stream.runCollect,
            Effect.map((items) => items.at(-1)?.result),
          );
        expect(yield* read({ threadId: ThreadId.make("current") })).toMatchObject({
          code: "invalid_request",
          message: expect.stringMatching(/"current".*Omit threadId/),
        });
        expect(yield* read({})).toMatchObject({ questId: "t3-quests" });
      }).pipe(
        Effect.provide(
          McpToolAccess.HandlersLayer.layer(QuestHandlers.layer).pipe(
            Layer.provideMerge(dependencies),
          ),
        ),
      );
    }).pipe(Effect.provide(NodeServices.layer)),
);

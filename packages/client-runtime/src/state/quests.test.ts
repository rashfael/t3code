import { describe, expect, it } from "@effect/vitest";
import {
  AuthOrchestrationOperateScope,
  EnvironmentId,
  type AuthSessionState,
  type QuestThreadLink,
  WS_METHODS,
} from "@t3tools/contracts";
import { vi } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { Atom, AtomRegistry, AsyncResult } from "effect/reactivity";

import { AVAILABLE_CONNECTION_STATE } from "../connection/model.ts";
import * as EnvironmentRegistry from "../connection/registry.ts";
import * as EnvironmentSupervisor from "../connection/supervisor.ts";
import type { RpcSession } from "../rpc/session.ts";
import { createQuestEnvironmentAtoms } from "./quests.ts";

const ENVIRONMENT_ID = EnvironmentId.make("environment-1");
vi.mock("./session.ts", () => ({
  createEnvironmentSessionAtoms: () => ({ sessionStateAtom: sessions }),
}));
const sessions = Atom.family((_id: EnvironmentId) =>
  Atom.make<AsyncResult.AsyncResult<AuthSessionState>>(AsyncResult.initial()),
);

const makeHarness = Effect.fn("TestQuests.makeHarness")(function* () {
  const server = {
    link: {
      threadId: "thread-1",
      workId: "work-1",
      questionId: null,
      about: "Work 1",
      role: "linked",
      purpose: "",
    } as QuestThreadLink | null,
    lookups: 0,
  };
  const supervisor = EnvironmentSupervisor.EnvironmentSupervisor.of({
    target: { environmentId: ENVIRONMENT_ID },
    session: yield* SubscriptionRef.make(
      Option.some({
        client: {
          [WS_METHODS.questThreadLink]: () =>
            Effect.sync(() => {
              server.lookups += 1;
              return server.link;
            }),
          [WS_METHODS.questUpdate]: () =>
            Effect.sync(() => {
              server.link = null;
              return { revision: 1 };
            }),
        },
      } as unknown as RpcSession),
    ),
    state: yield* SubscriptionRef.make({
      ...AVAILABLE_CONNECTION_STATE,
      phase: "connected" as const,
    }),
  } as EnvironmentSupervisor.EnvironmentSupervisor["Service"]);
  const runtime = Atom.runtime(
    Layer.succeed(EnvironmentRegistry.EnvironmentRegistry, {
      run: (_environmentId, effect) =>
        Effect.provideService(effect, EnvironmentSupervisor.EnvironmentSupervisor, supervisor),
      followStream: (_environmentId, stream) =>
        Stream.provideService(stream, EnvironmentSupervisor.EnvironmentSupervisor, supervisor),
    } as EnvironmentRegistry.EnvironmentRegistry["Service"]),
  );
  const quests = createQuestEnvironmentAtoms(runtime);
  const registry = AtomRegistry.make();
  yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()));
  registry.set(
    sessions(ENVIRONMENT_ID),
    AsyncResult.success({
      authenticated: true,
      auth: {
        policy: "remote-reachable" as const,
        bootstrapMethods: [],
        sessionMethods: [],
        sessionCookieName: "test",
      },
      scopes: [AuthOrchestrationOperateScope],
      permissions: [AuthOrchestrationOperateScope],
    }),
  );
  return { quests, registry, server };
});

describe("Quest thread links", () => {
  it.effect("reads a thread's link from the server and refreshes it after a save", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness();
      const link = h.quests.threadLink({
        environmentId: ENVIRONMENT_ID,
        input: { threadId: "thread-1" },
      });
      h.registry.mount(link);
      const read = () => AtomRegistry.getResult(h.registry, link, { suspendOnWaiting: true });
      expect(yield* read()).toMatchObject({ workId: "work-1", about: "Work 1" });
      const saved = yield* Effect.promise(() =>
        h.quests.update.run(h.registry, {
          environmentId: ENVIRONMENT_ID,
          input: {
            questId: "market-tracking",
            expectedRevision: 0,
            change: { type: "unlink", threadId: "thread-1" },
          },
        }),
      );
      expect(saved._tag).toBe("Success");
      expect(yield* read()).toBeNull();
      expect(h.server.lookups).toBe(2);
    }).pipe(Effect.scoped),
  );
});

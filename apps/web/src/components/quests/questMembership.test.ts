import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId, type QuestCatalog } from "@t3tools/contracts";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";

const harness = vi.hoisted(() => ({
  registry: null as AtomRegistry.AtomRegistry | null,
  results: {} as Record<string, unknown>,
}));

vi.mock(
  import("~/rpc/atomRegistry"),
  () =>
    ({
      get appAtomRegistry() {
        return harness.registry!;
      },
    }) as never,
);
vi.mock(
  import("~/state/presentation"),
  () =>
    ({
      environmentSummaries: {
        connectedEnvironmentIdsAtom: Atom.make(["env-a", "env-b", "env-c"]),
      },
    }) as never,
);
vi.mock(
  import("./questEnvironment"),
  () =>
    ({
      questEnvironment: {
        membership: ({ environmentId }: { environmentId: string }) =>
          Atom.make(harness.results[environmentId] ?? AsyncResult.initial()),
      },
    }) as never,
);

import {
  isAtThreadNavigationTarget,
  questMembershipAtom,
  threadNavigationTarget,
} from "./questMembership";

function quest(threadIds: ReadonlyArray<string>, questId = "market-tracking") {
  return {
    questId,
    title: questId,
    revision: 3,
    members: threadIds.map((threadId, index) => ({
      threadId,
      role: index === 0 ? ("core" as const) : ("focused" as const),
      title: threadId,
    })),
  };
}

function catalog(...quests: QuestCatalog["quests"]): QuestCatalog {
  return { quests };
}

describe("questMembershipAtom", () => {
  it("hides and routes only confirmed members, keyed by environment, and never hides unknown membership", () => {
    harness.registry = AtomRegistry.make();
    // The same thread id on two environments is two different threads.
    harness.results = {
      "env-a": AsyncResult.success(
        catalog(quest(["shared-id", "focused-a"]), quest(["real-core"], "t3-quests")),
      ),
      "env-b": AsyncResult.failure(new Error("offline") as never),
      // env-c has not answered yet.
    };
    const index = harness.registry.get(questMembershipAtom);
    expect(index.quests.map((item) => [item.environmentId, item.quest.questId])).toEqual([
      ["env-a", "market-tracking"],
      ["env-a", "t3-quests"],
    ]);
    expect(index.hiddenKeys.size).toBe(3);
    // A member of another Quest opens that Quest, not the historical default.
    const realMember = scopeThreadRef(EnvironmentId.make("env-a"), ThreadId.make("real-core"));
    expect(threadNavigationTarget(realMember)).toEqual({
      to: "/quests",
      search: { env: "env-a", quest: "t3-quests", view: "conversation", thread: "real-core" },
    });
    expect(
      isAtThreadNavigationTarget(
        {
          pathname: "/quests",
          search: { env: "env-a", view: "conversation", thread: "real-core" },
        },
        realMember,
      ),
    ).toBe(false);

    const member = scopeThreadRef(EnvironmentId.make("env-a"), ThreadId.make("shared-id"));
    const sameIdElsewhere = scopeThreadRef(EnvironmentId.make("env-b"), ThreadId.make("shared-id"));
    expect(threadNavigationTarget(member)).toEqual({
      to: "/quests",
      search: { env: "env-a", view: "conversation", thread: "shared-id" },
    });
    expect(threadNavigationTarget(sameIdElsewhere)).toEqual({
      to: "/$environmentId/$threadId",
      params: { environmentId: "env-b", threadId: "shared-id" },
    });
    // A sidebar file drop keeps its files once navigation lands in the thread's host.
    const inQuest = {
      pathname: "/quests",
      search: { env: "env-a", view: "conversation", thread: "shared-id" },
    };
    expect(isAtThreadNavigationTarget(inQuest, member)).toBe(true);
    expect(isAtThreadNavigationTarget({ pathname: "/env-a/shared-id", search: {} }, member)).toBe(
      false,
    );
    expect(
      isAtThreadNavigationTarget(
        { pathname: "/quests", search: { env: "env-a", thread: "focused-a" } },
        member,
      ),
    ).toBe(false);
    // Accepted but noncanonical Quest URLs show another view or the primary environment, not this composer.
    for (const search of [
      { env: "env-a", view: "overview", thread: "shared-id" },
      { env: "env-a", thread: "shared-id" },
      { view: "conversation", thread: "shared-id" },
    ])
      expect(isAtThreadNavigationTarget({ pathname: "/quests", search }, member)).toBe(false);
    expect(isAtThreadNavigationTarget(inQuest, sameIdElsewhere)).toBe(false);
    expect(
      isAtThreadNavigationTarget({ pathname: "/env-b/shared-id", search: {} }, sameIdElsewhere),
    ).toBe(true);
  });
});

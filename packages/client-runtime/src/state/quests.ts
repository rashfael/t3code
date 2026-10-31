import { WS_METHODS, type EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcCommand, createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";

export function createQuestEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  // Bumped by every save from this client so each thread's link reflects it.
  const savedRevision = Atom.family((_environmentId: EnvironmentId) =>
    Atom.make(0).pipe(Atom.keepAlive),
  );
  const get = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:quest:get",
    tag: WS_METHODS.questGet,
    staleTimeMs: 0,
  });
  // Revalidates whenever a thread route mounts it, so links removed elsewhere disappear too.
  const threadLink = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:quest:thread-link",
    tag: WS_METHODS.questThreadLink,
    staleTimeMs: 0,
    idleTtlMs: 60_000,
    refreshTrigger: ({ environmentId }) => savedRevision(environmentId),
  });
  const update = createEnvironmentRpcCommand(runtime, {
    label: "environment-data:quest:update",
    tag: WS_METHODS.questUpdate,
    concurrency: { mode: "singleFlight", key: ({ environmentId }) => environmentId },
    onSuccess: ({ environmentId }, registry) =>
      Effect.sync(() => {
        registry.refresh(get({ environmentId, input: {} }));
        const revision = savedRevision(environmentId);
        registry.set(revision, registry.get(revision) + 1);
      }),
  });
  const read = createEnvironmentRpcCommand(runtime, {
    label: "environment-data:quest:read",
    tag: WS_METHODS.questGet,
  });
  return { get, read, threadLink, update };
}

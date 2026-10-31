import { WS_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcCommand, createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";

export function createQuestEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const get = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:quest:get",
    tag: WS_METHODS.questGet,
    staleTimeMs: 0,
  });
  const update = createEnvironmentRpcCommand(runtime, {
    label: "environment-data:quest:update",
    tag: WS_METHODS.questUpdate,
    concurrency: { mode: "singleFlight", key: ({ environmentId }) => environmentId },
    onSuccess: ({ environmentId }, registry) =>
      Effect.sync(() => registry.refresh(get({ environmentId, input: {} }))),
  });
  const read = createEnvironmentRpcCommand(runtime, {
    label: "environment-data:quest:read",
    tag: WS_METHODS.questGet,
  });
  return { get, read, update };
}

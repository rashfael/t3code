import { WS_METHODS, type EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { Atom, type AtomRegistry } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcCommand, createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";

export function createQuestEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  // Bumped by every save from this client so each thread's link and membership reflect it.
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
  /** Which threads a Quest owns. Small, so the sidebar can keep it for every environment. */
  const membership = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:quest:membership",
    tag: WS_METHODS.questMembership,
    staleTimeMs: 0,
    refreshIntervalMs: 60_000,
    refreshTrigger: ({ environmentId }) => savedRevision(environmentId),
  });
  const document = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:quest:document",
    tag: WS_METHODS.questReadDocument,
    staleTimeMs: 0,
    idleTtlMs: 60_000,
    refreshTrigger: ({ environmentId }) => savedRevision(environmentId),
  });
  const retained = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:quest:retained",
    tag: WS_METHODS.questRetained,
    idleTtlMs: 60_000,
  });
  const workspaceFiles = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:quest:workspace-files",
    tag: WS_METHODS.questWorkspaceFiles,
    staleTimeMs: 0,
    refreshTrigger: ({ environmentId }) => savedRevision(environmentId),
  });
  const reconstruct = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:quest:reconstruct",
    tag: WS_METHODS.questReconstruct,
    idleTtlMs: 60_000,
  });
  const saved = (environmentId: EnvironmentId, registry: AtomRegistry.AtomRegistry) =>
    Effect.sync(() => {
      registry.refresh(get({ environmentId, input: {} }));
      const revision = savedRevision(environmentId);
      registry.set(revision, registry.get(revision) + 1);
    });
  const update = createEnvironmentRpcCommand(runtime, {
    label: "environment-data:quest:update",
    tag: WS_METHODS.questUpdate,
    concurrency: { mode: "singleFlight", key: ({ environmentId }) => environmentId },
    onSuccess: ({ environmentId }, registry) => saved(environmentId, registry),
  });
  const openConversation = createEnvironmentRpcCommand(runtime, {
    label: "environment-data:quest:open-conversation",
    tag: WS_METHODS.questOpenConversation,
    concurrency: { mode: "singleFlight", key: ({ environmentId }) => environmentId },
    onSuccess: ({ environmentId }, registry) => saved(environmentId, registry),
  });
  const writeDocument = createEnvironmentRpcCommand(runtime, {
    label: "environment-data:quest:write-document",
    tag: WS_METHODS.questWriteDocument,
    concurrency: { mode: "singleFlight", key: ({ environmentId }) => environmentId },
    onSuccess: ({ environmentId }, registry) => saved(environmentId, registry),
  });
  const recoverWrite = createEnvironmentRpcCommand(runtime, {
    label: "environment-data:quest:recover-write",
    tag: WS_METHODS.questRecoverWrite,
    concurrency: { mode: "singleFlight", key: ({ environmentId }) => environmentId },
    onSuccess: ({ environmentId }, registry) => saved(environmentId, registry),
  });
  const read = createEnvironmentRpcCommand(runtime, {
    label: "environment-data:quest:read",
    tag: WS_METHODS.questGet,
  });
  return {
    get,
    read,
    threadLink,
    membership,
    document,
    retained,
    workspaceFiles,
    reconstruct,
    update,
    openConversation,
    writeDocument,
    recoverWrite,
  };
}

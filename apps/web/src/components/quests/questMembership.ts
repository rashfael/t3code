import { useAtomValue } from "@effect/atom-react";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { threadKey } from "@t3tools/client-runtime/state/entities";
import type {
  EnvironmentId,
  QuestMember,
  QuestMembership,
  ScopedThreadRef,
  ThreadId,
} from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";

import { appAtomRegistry } from "~/rpc/atomRegistry";
import { environmentSummaries } from "~/state/presentation";
import { isThreadRoutePathname } from "~/threadRoutes";
import { questEnvironment } from "./questEnvironment";

export interface QuestHomeMember extends QuestMember {
  readonly environmentId: EnvironmentId;
}

export interface QuestMembershipIndex {
  /** Quests whose membership loaded, per environment. Unknown environments are absent. */
  readonly quests: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly quest: QuestMembership;
  }>;
  /** Confirmed members by scoped thread key. */
  readonly members: ReadonlyMap<string, QuestHomeMember>;
  /** The same members in the shell key format, for hiding their ordinary sidebar rows. */
  readonly hiddenKeys: ReadonlySet<string>;
}

/**
 * The one membership source for Quest rows, ordinary-row suppression and Quest-host routing.
 * Only a loaded membership hides a thread; while it is unknown the thread stays in its shelf.
 */
export const questMembershipAtom = Atom.make((get): QuestMembershipIndex => {
  const quests: Array<QuestMembershipIndex["quests"][number]> = [];
  const members = new Map<string, QuestHomeMember>();
  const hiddenKeys = new Set<string>();
  for (const environmentId of get(environmentSummaries.connectedEnvironmentIdsAtom)) {
    const result = get(questEnvironment.membership({ environmentId, input: {} }));
    if (!AsyncResult.isSuccess(result)) continue;
    quests.push({ environmentId, quest: result.value });
    for (const member of result.value.members) {
      const ref = scopeThreadRef(environmentId, member.threadId as ThreadId);
      members.set(scopedThreadKey(ref), { ...member, environmentId });
      hiddenKeys.add(threadKey(ref));
    }
  }
  return { quests, members, hiddenKeys };
}).pipe(Atom.withLabel("web-quest-membership"));

export function useQuestMembership(): QuestMembershipIndex {
  return useAtomValue(questMembershipAtom);
}

/** Where a thread opens: its Quest when the Quest owns it, else its own route. */
export function threadNavigationTarget(ref: ScopedThreadRef) {
  const member = appAtomRegistry.get(questMembershipAtom).members.get(scopedThreadKey(ref));
  if (member)
    return {
      to: "/quests",
      search: { env: ref.environmentId, view: "conversation", thread: ref.threadId },
    } as const;
  return {
    to: "/$environmentId/$threadId",
    params: { environmentId: ref.environmentId, threadId: ref.threadId },
  } as const;
}

/** Whether `location` already shows `ref` where `threadNavigationTarget` would open it. */
export function isAtThreadNavigationTarget(
  location: { readonly pathname: string; readonly search: unknown },
  ref: ScopedThreadRef,
): boolean {
  const target = threadNavigationTarget(ref);
  if (target.to !== "/quests") return isThreadRoutePathname(location.pathname, ref);
  const search = (location.search ?? {}) as Record<string, unknown>;
  return (
    location.pathname.replace(/\/$/, "") === "/quests" &&
    search.thread === ref.threadId &&
    (search.env === undefined || search.env === ref.environmentId)
  );
}

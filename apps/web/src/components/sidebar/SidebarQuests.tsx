import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { Link, useLocation } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { CompassIcon } from "lucide-react";

import { useLocalStorage } from "~/hooks/useLocalStorage";
import { CollapsibleSectionHeader } from "~/components/ui/collapsible-section-header";
import { useSidebar } from "~/components/ui/sidebar";
import { parseQuestSearch } from "~/components/quests/questContext";
import { useQuestMembership } from "~/components/quests/questMembership";
import { cn } from "~/lib/utils";
import { useUiStateStore } from "~/uiStateStore";
import {
  hasUnseenCompletion,
  resolveSidebarThreadStatus,
  resolveThreadLastVisitedAt,
} from "../Sidebar.logic";
import { sidebarRowStyles } from "./sidebarRowStyles";

interface Attention {
  readonly working: number;
  readonly waiting: number;
  readonly unread: number;
}

function attentionOf(
  threads: ReadonlyArray<EnvironmentThreadShell>,
  lastVisitedByKey: Readonly<Record<string, string>>,
): Attention {
  let working = 0;
  let waiting = 0;
  let unread = 0;
  for (const thread of threads) {
    const status = resolveSidebarThreadStatus(thread);
    if (status === "working") working += 1;
    else if (status === "approval" || status === "input" || status === "request") waiting += 1;
    const key = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
    const lastVisitedAt = resolveThreadLastVisitedAt(thread.lastVisitedAt, lastVisitedByKey[key]);
    if (hasUnseenCompletion({ ...thread, lastVisitedAt })) unread += 1;
  }
  return { working, waiting, unread };
}

function attentionText(attention: Attention): string | null {
  const parts = [
    attention.waiting > 0 ? `${attention.waiting} waiting` : null,
    attention.working > 0 ? `${attention.working} working` : null,
    attention.unread > 0 ? `${attention.unread} unread` : null,
  ].filter((part) => part !== null);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * Each environment's Quest as one row with its conversations' aggregate attention; conversations
 * are chosen inside the Quest. Membership comes from the same source that hides those threads from
 * the ordinary shelves, and stays loaded when collapsed.
 */
export function SidebarQuests({
  treeNavigation = false,
  threads,
  environmentLabelById,
}: {
  treeNavigation?: boolean;
  threads: ReadonlyArray<EnvironmentThreadShell>;
  environmentLabelById: ReadonlyMap<EnvironmentId, string>;
}) {
  const [expanded, setExpanded] = useLocalStorage(
    "t3code:quests-shelf-expanded",
    true,
    Schema.Boolean,
  );
  const { isMobile, setOpenMobile } = useSidebar();
  const membership = useQuestMembership();
  const lastVisitedByKey = useUiStateStore((state) => state.threadLastVisitedAtById);
  const onQuest = useLocation({ select: (location) => location.pathname === "/quests" });
  const search = parseQuestSearch(
    useLocation({ select: (location) => location.search }) as Record<string, unknown>,
  );
  const shellByKey = new Map(
    threads.map((thread) => [
      scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
      thread,
    ]),
  );
  const quests = membership.quests.map(({ environmentId, quest }) => {
    const members = quest.members.flatMap((member) => {
      const shell = shellByKey.get(
        scopedThreadKey(scopeThreadRef(environmentId, member.threadId as ThreadId)),
      );
      return shell ? [shell] : [];
    });
    return { environmentId, quest, members };
  });
  const attention = attentionText(
    attentionOf(
      quests.flatMap((quest) => quest.members),
      lastVisitedByKey,
    ),
  );
  const closeMobile = () => {
    if (isMobile) setOpenMobile(false);
  };
  return (
    <div data-thread-selection-safe>
      <CollapsibleSectionHeader
        role={treeNavigation ? "treeitem" : undefined}
        tabIndex={treeNavigation ? -1 : undefined}
        data-sidebar-row={treeNavigation ? "shelf:quests" : undefined}
        expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        accessory={
          <span className="font-normal tabular-nums">
            {!expanded && attention ? attention : Math.max(quests.length, 1)}
          </span>
        }
      >
        Quests
      </CollapsibleSectionHeader>
      {expanded ? (
        <ul aria-label="Quests" role={treeNavigation ? "group" : undefined}>
          {quests.length === 0 ? (
            <li className="list-none px-(--sidebar-row-content-inset) py-1 text-xs text-muted-foreground">
              Loading Quests…
            </li>
          ) : null}
          {quests.map(({ environmentId, quest, members }) => {
            const rowId = `quest:${environmentId}:${quest.questId}`;
            const isHere = onQuest && (search.env ?? quests[0]?.environmentId) === environmentId;
            const questAttention = attentionText(attentionOf(members, lastVisitedByKey));
            return (
              <li key={rowId} className="list-none py-0.5">
                <Link
                  to="/quests"
                  search={{ env: environmentId }}
                  aria-label={quest.title}
                  aria-current={isHere ? "page" : undefined}
                  role={treeNavigation ? "treeitem" : undefined}
                  tabIndex={treeNavigation ? -1 : undefined}
                  data-sidebar-row={treeNavigation ? rowId : undefined}
                  data-sidebar-parent={treeNavigation ? "shelf:quests" : undefined}
                  className={cn(
                    "block",
                    sidebarRowStyles.surface,
                    isHere ? sidebarRowStyles.active : sidebarRowStyles.idle,
                  )}
                  onClick={closeMobile}
                >
                  <div className="px-(--sidebar-row-content-inset) py-(--sidebar-content-inset)">
                    <div className="flex h-5 min-w-0 items-center gap-1.5 text-xs text-secondary-label">
                      <CompassIcon aria-hidden className="size-4 shrink-0" />
                      <span className="truncate">
                        {membership.quests.length > 1
                          ? (environmentLabelById.get(environmentId) ?? "Environment")
                          : "product-research"}
                      </span>
                      {questAttention ? (
                        <span className="ms-auto shrink-0">{questAttention}</span>
                      ) : null}
                    </div>
                    <div className="mt-1 truncate text-sm font-medium text-foreground">
                      {quest.title}
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

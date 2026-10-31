import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, QuestConversation, ThreadId } from "@t3tools/contracts";
import { Link, useLocation } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { CompassIcon, MessageSquareIcon } from "lucide-react";

import { useLocalStorage } from "~/hooks/useLocalStorage";
import { CollapsibleSectionHeader } from "~/components/ui/collapsible-section-header";
import { useSidebar } from "~/components/ui/sidebar";
import { parseQuestSearch } from "~/components/quests/questContext";
import { useQuestDraftStore } from "~/components/quests/questDraftStore";
import { questEnvironment } from "~/components/quests/questEnvironment";
import { cn } from "~/lib/utils";
import { useQuietThreadShell } from "~/state/entities";
import { usePrimaryEnvironmentId } from "~/state/environments";
import { useEnvironmentQuery } from "~/state/query";
import { sidebarRowStyles } from "./sidebarRowStyles";

export function SidebarQuests({ treeNavigation = false }: { treeNavigation?: boolean }) {
  const [expanded, setExpanded] = useLocalStorage(
    "t3code:quests-shelf-expanded",
    true,
    Schema.Boolean,
  );
  const { isMobile, setOpenMobile } = useSidebar();
  const primaryId = usePrimaryEnvironmentId();
  const onQuest = useLocation({ select: (location) => location.pathname === "/quests" });
  const search = parseQuestSearch(
    useLocation({ select: (location) => location.search }) as Record<string, unknown>,
  );
  const environmentId = ((onQuest ? search.env : undefined) ?? primaryId) as EnvironmentId | null;
  const { data: quest } = useEnvironmentQuery(
    expanded && environmentId ? questEnvironment.get({ environmentId, input: {} }) : null,
  );
  const remembered = useQuestDraftStore((store) =>
    environmentId ? store.conversations[environmentId] : undefined,
  );
  const shownConversation = !onQuest
    ? null
    : (search.thread ?? (search.view === "conversation" ? remembered : null) ?? null);
  const conversations = quest?.conversations.toReversed() ?? [];
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
        accessory={<span className="font-normal tabular-nums">1</span>}
      >
        Quests
      </CollapsibleSectionHeader>
      {expanded ? (
        <ul aria-label="Quests" role={treeNavigation ? "group" : undefined}>
          <li className="list-none py-0.5">
            <Link
              to="/quests"
              search={environmentId ? { env: environmentId } : {}}
              aria-label="Market tracking"
              role={treeNavigation ? "treeitem" : undefined}
              tabIndex={treeNavigation ? -1 : undefined}
              data-sidebar-row={treeNavigation ? "quest:market-tracking" : undefined}
              data-sidebar-parent={treeNavigation ? "shelf:quests" : undefined}
              className={cn(
                "block",
                sidebarRowStyles.surface,
                onQuest && !shownConversation ? sidebarRowStyles.active : sidebarRowStyles.idle,
              )}
              onClick={closeMobile}
            >
              <div className="px-(--sidebar-row-content-inset) py-(--sidebar-content-inset)">
                <div className="flex h-5 min-w-0 items-center gap-1.5 text-xs text-secondary-label">
                  <CompassIcon aria-hidden className="size-4 shrink-0" />
                  <span className="truncate">product-research</span>
                </div>
                <div className="mt-1 truncate text-sm font-medium text-foreground">
                  Market tracking
                </div>
              </div>
            </Link>
            {environmentId && conversations.length > 0 ? (
              <ul
                aria-label="Market tracking conversations"
                role={treeNavigation ? "group" : undefined}
              >
                {conversations.map((conversation) => (
                  <QuestConversationRow
                    key={conversation.threadId}
                    environmentId={environmentId}
                    conversation={conversation}
                    active={shownConversation === conversation.threadId}
                    treeNavigation={treeNavigation}
                    onOpen={closeMobile}
                  />
                ))}
              </ul>
            ) : null}
          </li>
        </ul>
      ) : null}
    </div>
  );
}

function QuestConversationRow({
  environmentId,
  conversation,
  active,
  treeNavigation,
  onOpen,
}: {
  environmentId: EnvironmentId;
  conversation: QuestConversation;
  active: boolean;
  treeNavigation: boolean;
  onOpen: () => void;
}) {
  const shell = useQuietThreadShell(
    scopeThreadRef(environmentId, conversation.threadId as ThreadId),
  );
  return (
    <li className="list-none py-px ps-4">
      <Link
        to="/quests"
        search={{ env: environmentId, view: "conversation", thread: conversation.threadId }}
        role={treeNavigation ? "treeitem" : undefined}
        tabIndex={treeNavigation ? -1 : undefined}
        data-sidebar-row={treeNavigation ? `quest-thread:${conversation.threadId}` : undefined}
        data-sidebar-parent={treeNavigation ? "quest:market-tracking" : undefined}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex h-7 items-center gap-1.5 px-(--sidebar-row-content-inset) text-sm",
          sidebarRowStyles.surface,
          active ? sidebarRowStyles.active : sidebarRowStyles.idle,
        )}
        onClick={onOpen}
      >
        <MessageSquareIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{shell?.title ?? conversation.title}</span>
      </Link>
    </li>
  );
}

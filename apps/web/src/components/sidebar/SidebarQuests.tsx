import { Link } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { CompassIcon } from "lucide-react";

import { useLocalStorage } from "~/hooks/useLocalStorage";
import { CollapsibleSectionHeader } from "~/components/ui/collapsible-section-header";
import { useSidebar } from "~/components/ui/sidebar";
import { cn } from "~/lib/utils";
import { sidebarRowStyles } from "./sidebarRowStyles";

export function SidebarQuests({ treeNavigation = false }: { treeNavigation?: boolean }) {
  const [expanded, setExpanded] = useLocalStorage(
    "t3code:quests-shelf-expanded",
    true,
    Schema.Boolean,
  );
  const { isMobile, setOpenMobile } = useSidebar();
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
              aria-label="Market tracking"
              role={treeNavigation ? "treeitem" : undefined}
              tabIndex={treeNavigation ? -1 : undefined}
              data-sidebar-row={treeNavigation ? "quest:market-tracking" : undefined}
              data-sidebar-parent={treeNavigation ? "shelf:quests" : undefined}
              className={cn("block", sidebarRowStyles.surface)}
              activeProps={{ className: sidebarRowStyles.active }}
              inactiveProps={{ className: sidebarRowStyles.idle }}
              onClick={() => {
                if (isMobile) setOpenMobile(false);
              }}
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
          </li>
        </ul>
      ) : null}
    </div>
  );
}

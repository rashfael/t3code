import { Link } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { CompassIcon } from "lucide-react";

import { useLocalStorage } from "~/hooks/useLocalStorage";
import { CollapsibleSectionHeader } from "~/components/ui/collapsible-section-header";
import { useSidebar } from "~/components/ui/sidebar";

export function SidebarQuests() {
  const [expanded, setExpanded] = useLocalStorage(
    "t3code:quests-shelf-expanded",
    true,
    Schema.Boolean,
  );
  const { isMobile, setOpenMobile } = useSidebar();
  return (
    <div className="mx-0.5" data-thread-selection-safe>
      <CollapsibleSectionHeader
        expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        accessory={<span className="font-normal tabular-nums">1</span>}
      >
        Quests
      </CollapsibleSectionHeader>
      {expanded ? (
        <ul aria-label="Quests">
          <li className="list-none">
            <Link
              to="/quests"
              className="flex min-h-9 items-center gap-2 rounded-md px-2.5 text-sm text-sidebar-foreground hover:bg-sidebar-row-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70"
              activeProps={{ className: "bg-sidebar-accent" }}
              onClick={() => {
                if (isMobile) setOpenMobile(false);
              }}
            >
              <CompassIcon aria-hidden className="size-4 shrink-0" />
              <span className="truncate">Market tracking</span>
            </Link>
          </li>
        </ul>
      ) : null}
    </div>
  );
}

import type { EnvironmentId } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { CompassIcon } from "lucide-react";

import { useEnvironmentQuery } from "~/state/query";
import { questEnvironment } from "./questEnvironment";
import { QUEST_TITLE } from "./questModel";

/** Shown above a normal thread that is linked to the Quest, so the Quest stays one step away. */
export function QuestThreadBar({
  environmentId,
  threadId,
}: {
  environmentId: EnvironmentId | null;
  threadId: string | null;
}) {
  const { data: link } = useEnvironmentQuery(
    environmentId && threadId
      ? questEnvironment.threadLink({ environmentId, input: { threadId } })
      : null,
  );
  if (!environmentId || !link) return null;
  const tab = "rounded px-2 py-1 text-muted-foreground hover:bg-accent hover:text-foreground";
  return (
    <nav
      aria-label="Quest conversation"
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-1.5 text-xs"
    >
      <span className="flex min-w-0 items-center gap-1.5 font-medium">
        <CompassIcon aria-hidden className="size-3.5 shrink-0" />
        Quest · {QUEST_TITLE}
      </span>
      {link.about ? (
        <span className="min-w-0 truncate text-muted-foreground">About: {link.about}</span>
      ) : null}
      <span className="ms-auto flex items-center gap-1">
        <Link to="/quests" search={{ env: environmentId, view: "overview" }} className={tab}>
          Overview
        </Link>
        <Link
          to="/quests"
          search={{ env: environmentId, view: "conversation", thread: link.threadId }}
          className={tab}
        >
          Open in Quest
        </Link>
        <Link
          to="/quests"
          search={{
            env: environmentId,
            view: "map",
            ...(link.workId ? { work: link.workId } : {}),
          }}
          className={tab}
        >
          Work map
        </Link>
      </span>
    </nav>
  );
}

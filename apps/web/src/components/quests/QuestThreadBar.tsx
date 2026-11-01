import { QUEST_DEFAULT_ID, type EnvironmentId } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { CompassIcon } from "lucide-react";

import { useEnvironmentQuery } from "~/state/query";
import { questEnvironment } from "./questEnvironment";

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
  const at = {
    env: environmentId,
    ...(link.questId === QUEST_DEFAULT_ID ? {} : { quest: link.questId }),
  };
  const tab = "rounded px-2 py-1 text-muted-foreground hover:bg-accent hover:text-foreground";
  return (
    <nav
      aria-label="Quest conversation"
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-1.5 text-xs"
    >
      <span className="flex min-w-0 items-center gap-1.5 font-medium">
        <CompassIcon aria-hidden className="size-3.5 shrink-0" />
        Quest · {link.questTitle}
      </span>
      {link.role === "core" ? (
        <span className="min-w-0 truncate text-muted-foreground">Core conversation</span>
      ) : link.purpose || link.about ? (
        <span className="min-w-0 truncate text-muted-foreground">
          {link.purpose || `About: ${link.about}`}
        </span>
      ) : null}
      <span className="ms-auto flex items-center gap-1">
        <Link to="/quests" search={{ ...at, view: "overview" }} className={tab}>
          Overview
        </Link>
        <Link
          to="/quests"
          search={{ ...at, view: "conversation", thread: link.threadId }}
          className={tab}
        >
          Open in Quest
        </Link>
        <Link
          to="/quests"
          search={{
            ...at,
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

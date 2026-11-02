import { questLinkSearch, type QuestLink } from "@t3tools/shared/questLinks";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { parseQuestSearch } from "../quests/questContext";

/** Opens the linked result, proposal, decision, work or document in its own Quest. */
export function MarkdownQuestLink(props: {
  readonly link: QuestLink;
  readonly children: ReactNode;
}) {
  return (
    <Link to="/quests" search={parseQuestSearch(questLinkSearch(props.link))}>
      {props.children}
    </Link>
  );
}

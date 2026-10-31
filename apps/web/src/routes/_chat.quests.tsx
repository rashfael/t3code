import { createFileRoute } from "@tanstack/react-router";

import { QuestPage } from "../components/quests/QuestPage";
import { parseQuestSearch } from "../components/quests/questContext";

export const Route = createFileRoute("/_chat/quests")({
  validateSearch: parseQuestSearch,
  component: QuestPage,
});

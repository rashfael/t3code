import { createFileRoute } from "@tanstack/react-router";

import { QuestPage } from "../components/quests/QuestPage";

export const Route = createFileRoute("/_chat/quests")({ component: QuestPage });

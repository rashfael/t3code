import { createFileRoute } from "@tanstack/react-router";

import { QuestPage } from "../components/quests/QuestPage";
import type { QuestSearch } from "../components/quests/questContext";

const VIEWS = ["overview", "conversation", "map"] as const;
const text = (value: unknown) =>
  typeof value === "string" && value.length > 0 && value.length <= 200 ? value : undefined;

export const Route = createFileRoute("/_chat/quests")({
  validateSearch: (raw: Record<string, unknown>): QuestSearch => {
    const view = VIEWS.find((candidate) => candidate === raw.view);
    const work = text(raw.work);
    const question = text(raw.question);
    const about = text(raw.about);
    return {
      ...(view ? { view } : {}),
      ...(work ? { work } : {}),
      ...(question ? { question } : {}),
      ...(about ? { about } : {}),
    };
  },
  component: QuestPage,
});

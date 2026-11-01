import type { EnvironmentId, QuestState, QuestUpdateInput } from "@t3tools/contracts";
import { createContext, use } from "react";

export type QuestView = "overview" | "conversation" | "map";

export interface QuestSearch {
  /** The environment whose Quest is shown; without it, the primary environment's. */
  readonly env?: string;
  readonly view?: QuestView;
  readonly work?: string;
  readonly question?: string;
  /** `work:<id>` or `question:<id>`, preselecting what a new conversation is about. */
  readonly about?: string;
  /** The linked conversation shown in the Conversation view. */
  readonly thread?: string;
}

const VIEWS: ReadonlyArray<QuestView> = ["overview", "conversation", "map"];

function searchText(value: unknown) {
  return typeof value === "string" && value.length > 0 && value.length <= 200 ? value : undefined;
}

export function parseQuestSearch(raw: Record<string, unknown>): QuestSearch {
  const env = searchText(raw.env);
  const view = VIEWS.find((candidate) => candidate === raw.view);
  const work = searchText(raw.work);
  const question = searchText(raw.question);
  const about = searchText(raw.about);
  const thread = searchText(raw.thread);
  return {
    ...(env ? { env } : {}),
    ...(view ? { view } : {}),
    ...(work ? { work } : {}),
    ...(question ? { question } : {}),
    ...(about ? { about } : {}),
    ...(thread ? { thread } : {}),
  };
}

export type PanelEntry =
  | { readonly type: "work"; readonly id: string }
  | { readonly type: "document"; readonly id: string }
  | { readonly type: "question"; readonly id: string }
  | { readonly type: "decisions" }
  | { readonly type: "documents" }
  | { readonly type: "history" };

export type QuestChange = QuestUpdateInput["change"];

export interface QuestWorkspaceContext {
  readonly environmentId: EnvironmentId;
  readonly state: QuestState;
  readonly canWrite: boolean;
  readonly pending: boolean;
  readonly save: (change: QuestChange, source?: QuestUpdateInput["source"]) => Promise<boolean>;
  /** Takes a newer saved state returned by another Quest command. */
  readonly adopt: (state: QuestState) => void;
  /** `push` keeps the current panel one Back step away; `replace` starts a new panel trail. */
  readonly openPanel: (entry: PanelEntry, mode?: "push" | "replace") => void;
  readonly showView: (view: QuestView, extra?: Omit<QuestSearch, "view" | "env">) => void;
}

export const QuestWorkspace = createContext<QuestWorkspaceContext | null>(null);

export function useQuest(): QuestWorkspaceContext {
  const value = use(QuestWorkspace);
  if (!value) throw new Error("Quest views render inside a loaded Quest workspace.");
  return value;
}

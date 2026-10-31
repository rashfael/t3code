import type { EnvironmentId, QuestState, QuestUpdateInput } from "@t3tools/contracts";
import { createContext, use } from "react";

export type QuestView = "overview" | "conversation" | "map";

export interface QuestSearch {
  readonly view?: QuestView;
  readonly work?: string;
  readonly question?: string;
  /** `work:<id>` or `question:<id>`, preselecting what a new conversation is about. */
  readonly about?: string;
}

export type PanelEntry =
  | { readonly type: "work"; readonly id: string }
  | { readonly type: "document"; readonly id: string }
  | { readonly type: "question"; readonly id: string }
  | { readonly type: "decisions" }
  | { readonly type: "history" };

export type QuestChange = QuestUpdateInput["change"];

export interface QuestWorkspaceContext {
  readonly environmentId: EnvironmentId;
  readonly state: QuestState;
  readonly canWrite: boolean;
  readonly pending: boolean;
  readonly save: (change: QuestChange) => Promise<boolean>;
  /** `push` keeps the current panel one Back step away; `replace` starts a new panel trail. */
  readonly openPanel: (entry: PanelEntry, mode?: "push" | "replace") => void;
  readonly showView: (view: QuestView, extra?: Omit<QuestSearch, "view">) => void;
}

export const QuestWorkspace = createContext<QuestWorkspaceContext | null>(null);

export function useQuest(): QuestWorkspaceContext {
  const value = use(QuestWorkspace);
  if (!value) throw new Error("Quest views render inside a loaded Quest workspace.");
  return value;
}

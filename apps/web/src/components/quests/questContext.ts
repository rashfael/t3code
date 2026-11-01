import type { EnvironmentId, QuestState, QuestUpdateInput } from "@t3tools/contracts";
import { createContext, use, type PointerEvent } from "react";

export type QuestView = "overview" | "conversation" | "map" | "decisions" | "documents" | "history";

export interface QuestSearch {
  /** The environment whose Quest is shown; without it, the primary environment's. */
  readonly env?: string;
  /** The Quest shown; without it, the environment's historical Quest. */
  readonly quest?: string;
  readonly view?: QuestView;
  readonly work?: string;
  readonly question?: string;
  /** `work:<id>` or `question:<id>`, preselecting what a new conversation is about. */
  readonly about?: string;
  /** The linked conversation shown in the Conversation view. */
  readonly thread?: string;
}

const VIEWS: ReadonlyArray<QuestView> = [
  "overview",
  "conversation",
  "map",
  "decisions",
  "documents",
  "history",
];

function searchText(value: unknown) {
  return typeof value === "string" && value.length > 0 && value.length <= 200 ? value : undefined;
}

export function parseQuestSearch(raw: Record<string, unknown>): QuestSearch {
  const env = searchText(raw.env);
  const quest = searchText(raw.quest);
  const view = VIEWS.find((candidate) => candidate === raw.view);
  const work = searchText(raw.work);
  const question = searchText(raw.question);
  const about = searchText(raw.about);
  const thread = searchText(raw.thread);
  return {
    ...(env ? { env } : {}),
    ...(quest ? { quest } : {}),
    ...(view ? { view } : {}),
    ...(work ? { work } : {}),
    ...(question ? { question } : {}),
    ...(about ? { about } : {}),
    ...(thread ? { thread } : {}),
  };
}

/** One Quest in one environment. Drafts, panels and open documents are kept per scope. */
export type QuestScopeKey = `${string}|${string}`;

export function questScopeKey(environmentId: EnvironmentId, questId: string): QuestScopeKey {
  return `${environmentId}|${questId}`;
}

/**
 * One Work-map cell by semantic ids: a result effect, a group of results, or a reference to a
 * result recorded elsewhere. Region-level detail stays a `work` entry.
 */
export interface QuestCellEntry {
  readonly type: "cell";
  readonly key: string;
  readonly kind: "effect" | "aggregate" | "reference";
  readonly workId: string;
  readonly effectIds: ReadonlyArray<string>;
}

export type PanelEntry =
  | { readonly type: "work"; readonly id: string }
  | { readonly type: "question"; readonly id: string }
  | QuestCellEntry;

export type QuestChange = QuestUpdateInput["change"];

export interface QuestWorkspaceContext {
  readonly environmentId: EnvironmentId;
  readonly questId: string;
  readonly scope: QuestScopeKey;
  readonly state: QuestState;
  readonly canWrite: boolean;
  readonly pending: boolean;
  /** Resolves to the saved state, or null when nothing was saved. */
  readonly save: (
    change: QuestChange,
    source?: QuestUpdateInput["source"],
  ) => Promise<QuestState | null>;
  /** Takes a newer saved state returned by another Quest command. */
  readonly adopt: (state: QuestState) => void;
  /** `push` keeps the current panel one Back step away; `replace` starts a new panel trail. */
  readonly openPanel: (entry: PanelEntry, mode?: "push" | "replace") => void;
  readonly showView: (view: QuestView, extra?: Omit<QuestSearch, "view" | "env" | "quest">) => void;
  /** Opens a document tab: beside the conversation when it is shown, else in Documents. */
  readonly openDocument: (tabId: string) => void;
  /** Work shown in the details panel without pinning it; null restores the pinned panel. */
  readonly previewWorkId: string | null;
  readonly previewWork: (id: string | null) => void;
  /** Any details entry shown without pinning it, such as a Work-map cell. */
  readonly previewEntry: PanelEntry | null;
  readonly previewPanel: (entry: PanelEntry | null) => void;
  /** The pinned details entry, if any. */
  readonly pinnedEntry: PanelEntry | null;
}

export const QuestWorkspace = createContext<QuestWorkspaceContext | null>(null);

export function useQuest(): QuestWorkspaceContext {
  const value = use(QuestWorkspace);
  if (!value) throw new Error("Quest views render inside a loaded Quest workspace.");
  return value;
}

/**
 * Hover or keyboard focus previews work in the details panel, leaving restores the pinned panel and
 * a click pins it. Touch skips the preview so a tap only pins.
 */
export function useWorkInspection() {
  const { openPanel, previewWork } = useQuest();
  return (id: string) => ({
    onPointerEnter: (event: PointerEvent) => {
      if (event.pointerType !== "touch") previewWork(id);
    },
    onPointerLeave: () => previewWork(null),
    onFocus: () => previewWork(id),
    onBlur: () => previewWork(null),
    onClick: () => {
      previewWork(null);
      openPanel({ type: "work", id });
    },
  });
}

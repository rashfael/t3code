import type { EnvironmentId } from "@t3tools/contracts";
import { create } from "zustand";

import type { PanelEntry, QuestView } from "./questContext";

export type QuestDraft = Readonly<Record<string, string | ReadonlyArray<string>>>;

interface QuestDraftStoreState {
  /** Unsaved editor values by `environmentId|editor:recordId`. An entry means its editor is open. */
  readonly drafts: Readonly<Record<string, QuestDraft>>;
  /** The details trail per environment, so a round trip through a thread returns to it. */
  readonly panels: Readonly<Record<string, ReadonlyArray<PanelEntry>>>;
  /** The conversation last shown per environment, reopened when the route names none. */
  readonly conversations: Readonly<Record<string, string>>;
  /** The Quest view last shown per environment, reopened when the route names nothing. */
  readonly views: Readonly<Record<string, QuestView>>;
  /** Open document tabs per environment, shared by Documents and the split beside a conversation. */
  readonly documents: Readonly<Record<string, QuestDocumentTabs>>;
}

export interface QuestDocumentTabs {
  /** Document ids, or `<id>@<sha256>` for a retained pinned version. */
  readonly open: ReadonlyArray<string>;
  readonly active: string | null;
  /** Whether the open documents are shown beside the conversation. */
  readonly beside: boolean;
}

const NO_DOCUMENT_TABS: QuestDocumentTabs = { open: [], active: null, beside: false };

/**
 * Drafts live outside the Quest page so opening evidence, switching views or visiting a linked
 * thread does not discard them. Only Cancel, a successful save or Reload saved clears one.
 */
export const useQuestDraftStore = create<QuestDraftStoreState>()(() => ({
  drafts: {},
  panels: {},
  conversations: {},
  views: {},
  documents: {},
}));

function draftKey(environmentId: EnvironmentId, key: string) {
  return `${environmentId}|${key}`;
}

export function useQuestDraft(environmentId: EnvironmentId, key: string) {
  const id = draftKey(environmentId, key);
  const draft = useQuestDraftStore((store) => store.drafts[id]);
  return {
    draft,
    /** Opens the editor (an empty draft) or merges changed fields into its draft. */
    update: (fields: QuestDraft = {}) =>
      useQuestDraftStore.setState((store) => ({
        drafts: { ...store.drafts, [id]: { ...store.drafts[id], ...fields } },
      })),
    clear: () =>
      useQuestDraftStore.setState((store) => ({
        drafts: Object.fromEntries(Object.entries(store.drafts).filter(([key]) => key !== id)),
      })),
  };
}

export function clearQuestDrafts(environmentId: EnvironmentId) {
  const prefix = `${environmentId}|`;
  useQuestDraftStore.setState((store) => ({
    drafts: Object.fromEntries(
      Object.entries(store.drafts).filter(([key]) => !key.startsWith(prefix)),
    ),
  }));
}

export function readQuestPanel(environmentId: EnvironmentId): ReadonlyArray<PanelEntry> {
  return useQuestDraftStore.getState().panels[environmentId] ?? [];
}

export function rememberQuestPanel(environmentId: EnvironmentId, panel: ReadonlyArray<PanelEntry>) {
  useQuestDraftStore.setState((store) => ({
    panels: { ...store.panels, [environmentId]: panel },
  }));
}

export function draftText(draft: QuestDraft | undefined, field: string, saved: string): string {
  const value = draft?.[field];
  return typeof value === "string" ? value : saved;
}

export function rememberQuestConversation(environmentId: EnvironmentId, threadId: string) {
  if (useQuestDraftStore.getState().conversations[environmentId] === threadId) return;
  useQuestDraftStore.setState((store) => ({
    conversations: { ...store.conversations, [environmentId]: threadId },
  }));
}

export function readQuestView(environmentId: EnvironmentId): QuestView | undefined {
  return useQuestDraftStore.getState().views[environmentId];
}

export function rememberQuestView(environmentId: EnvironmentId, view: QuestView) {
  if (useQuestDraftStore.getState().views[environmentId] === view) return;
  useQuestDraftStore.setState((store) => ({ views: { ...store.views, [environmentId]: view } }));
}

export function useQuestDocumentTabs(environmentId: EnvironmentId): QuestDocumentTabs {
  return useQuestDraftStore((store) => store.documents[environmentId] ?? NO_DOCUMENT_TABS);
}

function changeDocumentTabs(
  environmentId: EnvironmentId,
  change: (tabs: QuestDocumentTabs) => QuestDocumentTabs,
) {
  useQuestDraftStore.setState((store) => ({
    documents: {
      ...store.documents,
      [environmentId]: change(store.documents[environmentId] ?? NO_DOCUMENT_TABS),
    },
  }));
}

/** Opens or selects a tab; `beside` shows the tabs next to the conversation. */
export function openQuestDocumentTab(environmentId: EnvironmentId, tabId: string, beside: boolean) {
  changeDocumentTabs(environmentId, (tabs) => ({
    open: tabs.open.includes(tabId) ? tabs.open : [...tabs.open, tabId],
    active: tabId,
    beside: beside || tabs.beside,
  }));
}

/** Closes a tab and selects its neighbour. Its unsaved draft stays until saved or cancelled. */
export function closeQuestDocumentTab(environmentId: EnvironmentId, tabId: string) {
  changeDocumentTabs(environmentId, (tabs) => {
    const index = tabs.open.indexOf(tabId);
    const open = tabs.open.filter((item) => item !== tabId);
    const active =
      tabs.active === tabId ? (open[Math.min(index, open.length - 1)] ?? null) : tabs.active;
    return { open, active, beside: tabs.beside && open.length > 0 };
  });
}

export function showQuestDocumentsBeside(environmentId: EnvironmentId, beside: boolean) {
  changeDocumentTabs(environmentId, (tabs) => ({ ...tabs, beside }));
}

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
  /** The decision last selected per environment, shown again when Decisions reopens. */
  readonly decisions: Readonly<Record<string, string>>;
  /** Rendered or source presentation per `environmentId|documentId@version`. */
  readonly readerModes: Readonly<Record<string, "rendered" | "source">>;
  /** The before/after pair a Show changes view compares, kept until explicitly refreshed. */
  readonly comparisons: Readonly<Record<string, QuestComparison>>;
}

/** Either side is null until its read arrives; `requestedAt` rejects a current read older than the request. */
export interface QuestComparison {
  readonly pinSha256: string;
  readonly label: string;
  readonly before: string | null;
  readonly after: string | null;
  readonly afterSha256: string | null;
  readonly readAt: string | null;
  readonly requestedAt: number;
}

export interface QuestDocumentTabs {
  /** Logical document ids; a pinned version is a choice inside its document's tab. */
  readonly open: ReadonlyArray<string>;
  readonly active: string | null;
  /** The pinned SHA-256 each document shows instead of its current version. */
  readonly versions: Readonly<Record<string, string>>;
  /** Whether the open documents are shown beside the conversation. */
  readonly beside: boolean;
  /** The conversation's own tools hold the pane beside it instead of the documents. */
  readonly tools: boolean;
  /** Documents fill the work area instead of sharing it with the conversation. */
  readonly full: boolean;
}

const NO_DOCUMENT_TABS: QuestDocumentTabs = {
  open: [],
  active: null,
  versions: {},
  beside: false,
  tools: false,
  full: false,
};

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
  decisions: {},
  readerModes: {},
  comparisons: {},
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

function without<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([entry]) => entry !== key));
}

/** Splits a tab request: `<id>@<sha256>` selects that pinned version inside the document's tab. */
function parseDocumentTabId(tabId: string): { id: string; sha256: string | null } {
  const at = tabId.lastIndexOf("@");
  return at > 0
    ? { id: tabId.slice(0, at), sha256: tabId.slice(at + 1) }
    : { id: tabId, sha256: null };
}

/** Opens or selects a document; `beside` shows it next to the conversation, taking the pane back. */
export function openQuestDocumentTab(environmentId: EnvironmentId, tabId: string, beside: boolean) {
  const { id, sha256 } = parseDocumentTabId(tabId);
  changeDocumentTabs(environmentId, (tabs) => {
    const versions = without(tabs.versions, id);
    return {
      ...tabs,
      open: tabs.open.includes(id) ? tabs.open : [...tabs.open, id],
      active: id,
      versions: sha256 ? { ...versions, [id]: sha256 } : versions,
      beside: beside || tabs.beside,
      tools: beside ? false : tabs.tools,
    };
  });
}

/** Selects the current version (`null`) or a pinned one inside the document's tab. */
export function selectQuestDocumentVersion(
  environmentId: EnvironmentId,
  documentId: string,
  sha256: string | null,
) {
  changeDocumentTabs(environmentId, (tabs) => {
    const versions = without(tabs.versions, documentId);
    return { ...tabs, versions: sha256 ? { ...versions, [documentId]: sha256 } : versions };
  });
}

/** Closes a tab and selects its neighbour. Callers confirm before closing over an unsaved draft. */
export function closeQuestDocumentTab(environmentId: EnvironmentId, tabId: string) {
  changeDocumentTabs(environmentId, (tabs) => {
    const index = tabs.open.indexOf(tabId);
    const open = tabs.open.filter((item) => item !== tabId);
    const versions = without(tabs.versions, tabId);
    const active =
      tabs.active === tabId ? (open[Math.min(index, open.length - 1)] ?? null) : tabs.active;
    return { ...tabs, open, active, versions, beside: tabs.beside && open.length > 0 };
  });
}

export function showQuestDocumentsBeside(environmentId: EnvironmentId, beside: boolean) {
  changeDocumentTabs(environmentId, (tabs) => ({
    ...tabs,
    beside,
    tools: false,
    full: beside && tabs.full,
  }));
}

/** Gives the pane beside the conversation to its own tools, or back to the documents. */
export function showQuestConversationTools(environmentId: EnvironmentId, tools: boolean) {
  changeDocumentTabs(environmentId, (tabs) =>
    tabs.tools === tools ? tabs : { ...tabs, tools, full: tools ? false : tabs.full },
  );
}

export function showQuestDocumentsFull(environmentId: EnvironmentId, full: boolean) {
  changeDocumentTabs(environmentId, (tabs) => ({ ...tabs, full }));
}

export function useRememberedQuestDecision(environmentId: EnvironmentId): string | null {
  return useQuestDraftStore((store) => store.decisions[environmentId] ?? null);
}

export function rememberQuestDecision(environmentId: EnvironmentId, questionId: string | null) {
  useQuestDraftStore.setState((store) => {
    const decisions = without(store.decisions, environmentId);
    return { decisions: questionId ? { ...decisions, [environmentId]: questionId } : decisions };
  });
}

function readerKey(environmentId: EnvironmentId, documentId: string, version: string | null) {
  return `${environmentId}|${documentId}@${version ?? "current"}`;
}

export function useQuestReaderMode(
  environmentId: EnvironmentId,
  documentId: string,
  version: string | null,
) {
  const key = readerKey(environmentId, documentId, version);
  const mode = useQuestDraftStore((store) => store.readerModes[key] ?? "rendered");
  return {
    rendered: mode === "rendered",
    setRendered: (rendered: boolean) =>
      useQuestDraftStore.setState((store) => ({
        readerModes: { ...store.readerModes, [key]: rendered ? "rendered" : "source" },
      })),
  };
}

/**
 * Scroll offsets by reader, so a passage survives switching tabs, versions and placements. Kept
 * outside React state: a scroll only needs restoring on the next mount, never a render.
 */
const readerPositions = new Map<string, number>();

export function readerPosition(
  environmentId: EnvironmentId,
  documentId: string,
  version: string | null,
  mode: string,
) {
  const key = `${readerKey(environmentId, documentId, version)}|${mode}`;
  return {
    read: () => readerPositions.get(key) ?? 0,
    write: (offset: number) => readerPositions.set(key, offset),
  };
}

function comparisonKey(environmentId: EnvironmentId, documentId: string) {
  return `${environmentId}|${documentId}`;
}

export function useQuestComparison(environmentId: EnvironmentId, documentId: string) {
  const key = comparisonKey(environmentId, documentId);
  const comparison = useQuestDraftStore((store) => store.comparisons[key] ?? null);
  return {
    comparison,
    set: (next: QuestComparison) =>
      useQuestDraftStore.setState((store) => ({
        comparisons: { ...store.comparisons, [key]: next },
      })),
    clear: () =>
      useQuestDraftStore.setState((store) => {
        return { comparisons: without(store.comparisons, key) };
      }),
  };
}

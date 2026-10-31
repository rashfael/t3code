import type { EnvironmentId } from "@t3tools/contracts";
import { create } from "zustand";

import type { PanelEntry } from "./questContext";

export type QuestDraft = Readonly<Record<string, string | ReadonlyArray<string>>>;

interface QuestDraftStoreState {
  /** Unsaved editor values by `environmentId|editor:recordId`. An entry means its editor is open. */
  readonly drafts: Readonly<Record<string, QuestDraft>>;
  /** The details trail per environment, so a round trip through a thread returns to it. */
  readonly panels: Readonly<Record<string, ReadonlyArray<PanelEntry>>>;
}

/**
 * Drafts live outside the Quest page so opening evidence, switching views or visiting a linked
 * thread does not discard them. Only Cancel, a successful save or Reload saved clears one.
 */
export const useQuestDraftStore = create<QuestDraftStoreState>()(() => ({
  drafts: {},
  panels: {},
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

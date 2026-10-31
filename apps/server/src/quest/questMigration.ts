import type { QuestHistoryEntry, QuestState, QuestWork } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { questExampleRelations, questExampleWork } from "./questSeed.ts";

/** The first prototype's saved shape, which has no `schemaVersion`. */
export const QuestStateV1 = Schema.Struct({
  revision: Schema.Number,
  work: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      parentId: Schema.NullOr(Schema.String),
      title: Schema.String,
      state: Schema.Literals(["active", "attention", "review", "deferred", "done"]),
      owner: Schema.String,
      agent: Schema.String,
      understanding: Schema.String,
      documentIds: Schema.Array(Schema.String),
      priorAttempts: Schema.String,
      findings: Schema.String,
      handoff: Schema.String,
    }),
  ),
  documents: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      title: Schema.String,
      body: Schema.String,
      kind: Schema.Literals(["living", "evidence"]),
      source: Schema.String,
      sha256: Schema.String,
    }),
  ),
  questions: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      workId: Schema.String,
      title: Schema.String,
      context: Schema.String,
      alternatives: Schema.Array(Schema.String),
      answer: Schema.NullOr(Schema.String),
      deferred: Schema.Boolean,
      applied: Schema.Boolean,
      proposal: Schema.Boolean,
    }),
  ),
});
export type QuestStateV1 = typeof QuestStateV1.Type;

const RECOVERY_ID = "retained-attempt";

/**
 * Brings a first-prototype Quest to the current shape. Saved records keep their content; example
 * records are added only where their ids are missing. `fresh` marks a new install, whose baseline
 * is revision 0; an upgrade gets a new revision so clients holding the old shape must reload.
 */
export function migrateQuestV1(
  saved: QuestStateV1,
  options: { readonly at: string; readonly fresh: boolean },
): QuestState {
  const savedIds = new Set(saved.work.map((item) => item.id));
  const documentIds = new Set(saved.documents.map((doc) => doc.id));
  const recovery = saved.work.find((item) => item.id === RECOVERY_ID);
  // The seed placed the recovery attempt under Deferred; an edited placement stays where it is.
  const moveRecovery =
    recovery?.parentId === "deferred" && questExampleWork.some((item) => item.id === "m2-i3");
  const work: Array<QuestWork> = saved.work.map((item) => ({
    ...item,
    kind: item.id === RECOVERY_ID ? "attempt" : "work",
    parentId: item.id === RECOVERY_ID && moveRecovery ? "m2-i3" : item.parentId,
  }));
  for (const item of questExampleWork) {
    if (savedIds.has(item.id)) continue;
    work.push({ ...item, documentIds: item.documentIds.filter((id) => documentIds.has(id)) });
  }
  const byId = new Map(work.map((item) => [item.id, item]));
  // Keep only added records whose parent chain reaches the root without a cycle.
  const reachesRoot = (item: QuestWork) => {
    const seen = new Set<string>();
    let parentId = item.parentId;
    while (parentId !== null) {
      const parent = byId.get(parentId);
      if (!parent || seen.has(parentId)) return false;
      seen.add(parentId);
      parentId = parent.parentId;
    }
    return true;
  };
  const kept = work.filter((item) => savedIds.has(item.id) || reachesRoot(item));
  const keptIds = new Set(kept.map((item) => item.id));
  const relations = questExampleRelations.filter(
    (relation) =>
      keptIds.has(relation.from) &&
      keptIds.has(relation.to) &&
      (relation.documentId === null || documentIds.has(relation.documentId)),
  );
  const addedCount = kept.filter((item) => !savedIds.has(item.id)).length;
  const changes: Array<QuestHistoryEntry["changes"][number]> = [];
  if (addedCount > 0)
    changes.push({
      label: "Example records added from captured sources",
      before: null,
      after: `${addedCount} work records and ${relations.length} source-quoted relations`,
    });
  if (moveRecovery)
    changes.push({
      label: `${recovery!.title} · parent`,
      before: "Deferred evaluation and report obligations",
      after: "M2-I3 evaluation",
    });
  const revision = options.fresh ? saved.revision : saved.revision + 1;
  const baseline: QuestHistoryEntry = {
    id: `baseline-${revision}`,
    revision,
    at: options.at,
    kind: "baseline",
    targetId: null,
    summary: options.fresh
      ? "Example created from captured sources. History is recorded from here."
      : `Saved prototype upgraded from revision ${saved.revision}. Earlier changes were saved but not recorded as history; this is the earliest recorded state.`,
    changes,
  };
  return {
    schemaVersion: 2,
    revision,
    currentWorkId: keptIds.has("milestone-a") ? "milestone-a" : null,
    work: kept,
    relations,
    documents: saved.documents,
    questions: saved.questions.map((question) => ({ ...question, rationale: null })),
    conversations: [],
    history: [baseline],
  };
}

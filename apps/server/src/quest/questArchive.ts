import type {
  QuestDomain,
  QuestRecordChange,
  QuestRevisionRecord,
  QuestState,
} from "@t3tools/contracts";

/** Keyed record collections of a Quest domain; scalars are recorded under `quest`. */
const COLLECTIONS = {
  work: (item: QuestDomain["work"][number]) => item.id,
  relations: (item: QuestDomain["relations"][number]) => item.id,
  documents: (item: QuestDomain["documents"][number]) => item.id,
  questions: (item: QuestDomain["questions"][number]) => item.id,
  conversations: (item: QuestDomain["conversations"][number]) => item.threadId,
  corePredecessors: (item: QuestDomain["corePredecessors"][number]) => item.conversation.threadId,
  files: (item: QuestDomain["files"][number]) => item.id,
  pendingWrites: (item: QuestDomain["pendingWrites"][number]) => item.id,
} as const;
type Collection = keyof typeof COLLECTIONS;
const COLLECTION_NAMES = Object.keys(COLLECTIONS) as ReadonlyArray<Collection>;
const SCALARS = ["currentWorkId", "workspace"] as const;

export function questDomain(state: QuestState): QuestDomain {
  const { schemaVersion: _version, revision: _revision, history: _history, ...domain } = state;
  return domain;
}

function keyOf(collection: Collection, item: unknown): string {
  return (COLLECTIONS[collection] as (value: unknown) => string)(item);
}

/** Full before/after records of everything a revision changed, including removed associations. */
export function diffQuestDomain(
  before: QuestDomain,
  after: QuestDomain,
): Pick<QuestRevisionRecord, "changes" | "order"> {
  const changes: Array<QuestRecordChange> = [];
  const order: Record<string, ReadonlyArray<string>> = {};
  for (const collection of COLLECTION_NAMES) {
    const previous = new Map(
      (before[collection] as ReadonlyArray<unknown>).map((item) => [keyOf(collection, item), item]),
    );
    const next = (after[collection] as ReadonlyArray<unknown>).map(
      (item) => [keyOf(collection, item), item] as const,
    );
    const nextKeys = new Set(next.map(([key]) => key));
    let changed = false;
    for (const [id, item] of next) {
      const prior = previous.get(id) ?? null;
      if (prior !== null && JSON.stringify(prior) === JSON.stringify(item)) continue;
      changes.push({ collection, id, before: prior, after: item });
      changed = true;
    }
    for (const [id, item] of previous) {
      if (nextKeys.has(id)) continue;
      changes.push({ collection, id, before: item, after: null });
      changed = true;
    }
    const keys = next.map(([key]) => key);
    if (changed || keys.join("\n") !== [...previous.keys()].join("\n")) order[collection] = keys;
  }
  for (const field of SCALARS) {
    if (JSON.stringify(before[field]) === JSON.stringify(after[field])) continue;
    changes.push({ collection: "quest", id: field, before: before[field], after: after[field] });
  }
  return { changes, order };
}

/** Replays saved records onto an earlier domain. No business rule runs again. */
export function replayQuestRecord(domain: QuestDomain, record: QuestRevisionRecord): QuestDomain {
  const next: Record<string, unknown> = { ...domain };
  for (const collection of COLLECTION_NAMES) {
    const changes = record.changes.filter((change) => change.collection === collection);
    const order = record.order[collection];
    if (changes.length === 0 && order === undefined) continue;
    const items = new Map(
      (domain[collection] as ReadonlyArray<unknown>).map((item) => [keyOf(collection, item), item]),
    );
    for (const change of changes) {
      if (change.after === null) items.delete(change.id);
      else items.set(change.id, change.after);
    }
    const keys = order ?? [...items.keys()];
    next[collection] = keys.flatMap((key) => (items.has(key) ? [items.get(key)] : []));
  }
  for (const change of record.changes) {
    if (change.collection === "quest") next[change.id] = change.after;
  }
  return next as QuestDomain;
}

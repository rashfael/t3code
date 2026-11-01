import type { QuestContribution, QuestState } from "@t3tools/contracts";

/**
 * One result effect as the Work map shows it: a read-only view of a saved contribution. Nothing
 * here is stored; cells, keys and positions are derived from it on every layout.
 */
export interface MapEffect {
  readonly id: string;
  readonly contribution: QuestContribution;
  /** The work whose territory holds the filled cell. */
  readonly homeWorkId: string | null;
  /** Other work it affects; those territories show a reference, not a second filled effect. */
  readonly alsoWorkIds: ReadonlyArray<string>;
  /** The coarser result this effect refines, when the record names one. */
  readonly parentId: string | null;
  /** Finer effects that refine this one. A refined result is carried by them, not drawn twice. */
  readonly childIds: ReadonlyArray<string>;
  /** Scope still to be delivered: outlined, never filled. */
  readonly planned: boolean;
  /** Earlier versions this record supersedes, newest first. They are its history, not more surface. */
  readonly history: ReadonlyArray<QuestContribution>;
  /** How the record was established, such as a reconstruction from delivery records. */
  readonly basis: string | null;
  /** Correction notes recorded against this same effect. */
  readonly refinements: ReadonlyArray<string>;
  /** Review, verification and correction episodes that name this effect. */
  readonly episodes: ReadonlyArray<MapEpisode>;
}

/** A recorded review, verification or correction round. It deepens an effect; it adds no surface. */
export interface MapEpisode {
  readonly id: string;
  readonly kind: string;
  readonly lens: string;
  readonly checkedCandidate: string;
  readonly outcome: string;
  readonly source: string;
}

function readEpisodes(state: QuestState): ReadonlyArray<MapEpisode & { effectIds: string[] }> {
  const raw = (state as unknown as Record<string, unknown>).episodes;
  if (!Array.isArray(raw)) return [];
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  return raw.flatMap((item: Record<string, unknown>) => {
    const effectIds = Array.isArray(item.affectedEffectIds)
      ? item.affectedEffectIds.filter((id) => typeof id === "string")
      : [];
    if (typeof item.id !== "string" || effectIds.length === 0) return [];
    return [
      {
        id: item.id,
        kind: text(item.kind),
        lens: text(item.lens),
        checkedCandidate: text(item.checkedCandidate),
        outcome: text(item.outcome),
        source: text(item.source),
        effectIds,
      },
    ];
  });
}

// Optional fields a finer effect record may carry; older records have none of them.
function optionalText(record: QuestContribution, key: string): string | null {
  const value = (record as unknown as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function optionalTexts(record: QuestContribution, key: string): ReadonlyArray<string> {
  const value = (record as unknown as Record<string, unknown>)[key];
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

const PLANNED_STATUSES = new Set(["planned", "in-progress", "proposed"]);

/**
 * Current effects of a Quest. A superseded record folds into its successor's history; a set-aside
 * record is not shown as an effect on the result.
 */
export function mapEffects(state: QuestState): ReadonlyArray<MapEffect> {
  const byId = new Map(state.contributions.map((item) => [item.id, item]));
  const supersededBy = new Map<string, string>();
  for (const item of state.contributions)
    if (item.supersedes && byId.has(item.supersedes)) supersededBy.set(item.supersedes, item.id);
  const workIds = new Set(state.work.map((item) => item.id));
  const current = state.contributions.filter(
    (item) => !supersededBy.has(item.id) && item.disposition !== "set-aside",
  );
  const currentIds = new Set(current.map((item) => item.id));
  const parentOf = (item: QuestContribution) => {
    const parent = optionalText(item, "parentContributionId");
    return parent && currentIds.has(parent) && parent !== item.id ? parent : null;
  };
  const episodes = readEpisodes(state);
  const children = new Map<string, Array<string>>();
  for (const item of current) {
    const parent = parentOf(item);
    if (parent) children.set(parent, [...(children.get(parent) ?? []), item.id]);
  }
  return current.map((item) => {
    const targets = [item.workId, ...item.affectedWorkIds].filter(
      (id, index, all): id is string => id !== null && workIds.has(id) && all.indexOf(id) === index,
    );
    const history: Array<QuestContribution> = [];
    const seen = new Set([item.id]);
    let earlier = item.supersedes ? byId.get(item.supersedes) : undefined;
    while (earlier && !seen.has(earlier.id)) {
      seen.add(earlier.id);
      history.push(earlier);
      earlier = earlier.supersedes ? byId.get(earlier.supersedes) : undefined;
    }
    const status = optionalText(item, "status");
    return {
      id: item.id,
      contribution: item,
      homeWorkId: targets[0] ?? null,
      alsoWorkIds: targets.slice(1),
      parentId: parentOf(item),
      childIds: children.get(item.id) ?? [],
      planned: status !== null && PLANNED_STATUSES.has(status),
      history,
      basis: optionalText(item, "evidenceStatus"),
      refinements: optionalTexts(item, "refinementEvidence"),
      episodes: episodes.filter((episode) => episode.effectIds.includes(item.id)),
    };
  });
}

/** The evidence ref of a registered Quest file, matched by its path inside the Quest folder. */
export function evidenceFile(state: QuestState, ref: string) {
  const path = ref.split("#")[0]!;
  return state.files.find((file) => path === file.path || path.endsWith(`/${file.path}`)) ?? null;
}

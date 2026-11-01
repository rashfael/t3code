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
  /** Its id in a registered reconstruction corpus, from an `effect:` evidence ref. */
  readonly reconstructionId: string | null;
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

/**
 * Associations a result states through its evidence refs, since results have no fields for them:
 * `effect:<id>` names its reconstruction id (or, after the first, a related effect), `review:<id>`
 * a review episode in the registered ledger whose note gives kind · lens · checked candidate, and
 * an `other` ref equal to another result's id the coarser result it refines.
 */
function statedLinks(record: QuestContribution, resultIds: ReadonlySet<string>) {
  const own = record.evidence.find(
    (item) => item.ref.startsWith("effect:") && item.note.startsWith("Reconstruction id"),
  );
  const parent = record.evidence.find(
    (item) => item.kind === "other" && item.ref !== record.id && resultIds.has(item.ref),
  );
  const episodes = record.evidence
    .filter((item) => item.ref.startsWith("review:"))
    .map((item): MapEpisode => {
      const source = /\(([^)]+)\)\s*$/.exec(item.note)?.[1] ?? "";
      const [kind = "", lens = "", checked = ""] = item.note
        .replace(/\s*\([^)]+\)\s*$/, "")
        .split(" · ");
      return {
        id: item.ref.slice("review:".length),
        kind,
        lens,
        checkedCandidate: checked.replace(/^checked\s+/, ""),
        outcome: "",
        source,
      };
    });
  return {
    reconstructionId: own ? own.ref.slice("effect:".length) : null,
    parentId: parent?.ref ?? null,
    episodes,
  };
}

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
  const links = new Map(current.map((item) => [item.id, statedLinks(item, currentIds)]));
  const parentOf = (item: QuestContribution) => links.get(item.id)?.parentId ?? null;
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
    const stated = links.get(item.id)!;
    return {
      id: item.id,
      contribution: item,
      homeWorkId: targets[0] ?? null,
      alsoWorkIds: targets.slice(1),
      parentId: parentOf(item),
      childIds: children.get(item.id) ?? [],
      // Results record delivered or learned effects; planned scope is planned work, not a result.
      planned: false,
      history,
      basis: stated.reconstructionId ? "source-backed-reconstruction" : null,
      reconstructionId: stated.reconstructionId,
      // Correction notes stay in the result's own summary; nothing records them separately.
      refinements: [],
      episodes: stated.episodes,
    };
  });
}

/** The evidence ref of a registered Quest file, matched by its path inside the Quest folder. */
export function evidenceFile(state: QuestState, ref: string) {
  const path = ref.split("#")[0]!;
  return state.files.find((file) => path === file.path || path.endsWith(`/${file.path}`)) ?? null;
}

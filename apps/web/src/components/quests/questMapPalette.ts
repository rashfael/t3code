import type { QuestState, QuestWork } from "@t3tools/contracts";

import { workstreamHues } from "./questModel";

/** How one identity hue appears on the map; status is carried by hatching, outline and marks. */
export interface MapTone {
  /** Ground of a scope with recorded work. */
  readonly ground: string;
  /** Hatching colour of planned or deferred ground. */
  readonly hatch: string;
  /** One result effect. */
  readonly effect: string;
  /** Several results shown together. */
  readonly grouped: string;
  readonly swatch: string;
}

// Literal classes so Tailwind generates them; keyed by the hue the shared workstream palette picks.
const TONES: Record<string, MapTone> = {
  sky: {
    ground: "fill-sky-500/10 dark:fill-sky-400/16",
    hatch: "text-sky-600/40 dark:text-sky-400/35",
    effect: "fill-sky-500/45 dark:fill-sky-400/55",
    grouped: "fill-sky-500/65 dark:fill-sky-300/70",
    swatch: "bg-sky-500/60",
  },
  violet: {
    ground: "fill-violet-500/10 dark:fill-violet-400/16",
    hatch: "text-violet-600/40 dark:text-violet-400/35",
    effect: "fill-violet-500/40 dark:fill-violet-400/55",
    grouped: "fill-violet-500/60 dark:fill-violet-300/70",
    swatch: "bg-violet-500/60",
  },
  emerald: {
    ground: "fill-emerald-500/10 dark:fill-emerald-400/16",
    hatch: "text-emerald-600/40 dark:text-emerald-400/35",
    effect: "fill-emerald-500/40 dark:fill-emerald-400/55",
    grouped: "fill-emerald-500/60 dark:fill-emerald-300/70",
    swatch: "bg-emerald-500/60",
  },
  amber: {
    ground: "fill-amber-500/10 dark:fill-amber-400/16",
    hatch: "text-amber-600/40 dark:text-amber-400/35",
    effect: "fill-amber-500/45 dark:fill-amber-400/55",
    grouped: "fill-amber-500/65 dark:fill-amber-300/70",
    swatch: "bg-amber-500/60",
  },
  rose: {
    ground: "fill-rose-500/10 dark:fill-rose-400/16",
    hatch: "text-rose-600/40 dark:text-rose-400/35",
    effect: "fill-rose-500/40 dark:fill-rose-400/55",
    grouped: "fill-rose-500/60 dark:fill-rose-300/70",
    swatch: "bg-rose-500/60",
  },
  teal: {
    ground: "fill-teal-500/10 dark:fill-teal-400/16",
    hatch: "text-teal-600/40 dark:text-teal-400/35",
    effect: "fill-teal-500/40 dark:fill-teal-400/55",
    grouped: "fill-teal-500/60 dark:fill-teal-300/70",
    swatch: "bg-teal-500/60",
  },
};

export const NEUTRAL_TONE: MapTone = {
  ground: "fill-muted-foreground/8",
  hatch: "text-muted-foreground/40",
  effect: "fill-foreground/20 dark:fill-foreground/30",
  grouped: "fill-foreground/32",
  swatch: "bg-muted-foreground/40",
};

/**
 * The identity tone of each work item: its workstream's hue, the hue of its single workstream, or
 * its parent's. Work spanning several workstreams stays neutral rather than taking one of them.
 */
export function mapTones(state: QuestState) {
  const hues = workstreamHues(state);
  const toneOfStream = (id: string) => {
    const hue = /fill-([a-z]+)-\d+/.exec(hues.get(id) ?? "")?.[1];
    return hue ? (TONES[hue] ?? null) : null;
  };
  const byId = new Map(state.work.map((item) => [item.id, item]));
  const known = new Map<string, MapTone>();
  const toneOf = (work: QuestWork, seen: Set<string> = new Set()): MapTone => {
    const cached = known.get(work.id);
    if (cached) return cached;
    let tone: MapTone = NEUTRAL_TONE;
    const streams = work.workstreamIds ?? [];
    if (work.role === "workstream") tone = toneOfStream(work.id) ?? NEUTRAL_TONE;
    else if (streams.length === 1) tone = toneOfStream(streams[0]!) ?? NEUTRAL_TONE;
    else if (streams.length === 0 && work.parentId && !seen.has(work.id)) {
      seen.add(work.id);
      const parent = byId.get(work.parentId);
      if (parent) tone = toneOf(parent, seen);
    }
    known.set(work.id, tone);
    return tone;
  };
  const legend = state.work
    .filter((item) => item.role === "workstream")
    .map((item) => ({ id: item.id, title: item.title, tone: toneOf(item) }));
  return { toneOf, legend };
}

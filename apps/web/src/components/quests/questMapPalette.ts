import type { QuestState, QuestWork } from "@t3tools/contracts";

import { workstreamSlots } from "./questModel";

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

// Literal classes so Tailwind generates them; one per shared workstream palette slot.
const TONES: ReadonlyArray<MapTone> = [
  {
    ground: "fill-stream-1/22",
    hatch: "text-stream-1/55",
    effect: "fill-stream-1/80",
    grouped: "fill-stream-1/95",
    swatch: "bg-stream-1",
  },
  {
    ground: "fill-stream-2/22",
    hatch: "text-stream-2/55",
    effect: "fill-stream-2/80",
    grouped: "fill-stream-2/95",
    swatch: "bg-stream-2",
  },
  {
    ground: "fill-stream-3/22",
    hatch: "text-stream-3/55",
    effect: "fill-stream-3/80",
    grouped: "fill-stream-3/95",
    swatch: "bg-stream-3",
  },
  {
    ground: "fill-stream-4/22",
    hatch: "text-stream-4/55",
    effect: "fill-stream-4/80",
    grouped: "fill-stream-4/95",
    swatch: "bg-stream-4",
  },
  {
    ground: "fill-stream-5/22",
    hatch: "text-stream-5/55",
    effect: "fill-stream-5/80",
    grouped: "fill-stream-5/95",
    swatch: "bg-stream-5",
  },
  {
    ground: "fill-stream-6/22",
    hatch: "text-stream-6/55",
    effect: "fill-stream-6/80",
    grouped: "fill-stream-6/95",
    swatch: "bg-stream-6",
  },
];

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
  const slots = workstreamSlots(state);
  const toneOfStream = (id: string) => {
    const slot = slots.get(id);
    return slot === undefined ? null : (TONES[slot] ?? null);
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

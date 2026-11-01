import { questQuestionStatus, type QuestWork } from "@t3tools/contracts";
import {
  BotIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  CrosshairIcon,
  MessageSquareIcon,
} from "lucide-react";
import { useState, type KeyboardEvent, type PointerEvent } from "react";

import { cn } from "~/lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { useQuest, useWorkInspection, type QuestCellEntry } from "./questContext";
import { cellSelection } from "./QuestMapCellDetail";
import { mapEffects } from "./questMapEffects";
import {
  boundaryPath,
  cellsPath,
  insetCellPath,
  layoutTerritory,
  sitePoint,
  territoryLinks,
  type PlacedUnit,
  type Region,
  type Territory,
  type TerritoryLink,
} from "./questTerritory";
import { LABEL_SIZE, MAP_SCALE } from "./questMapLabels";
import { mapTones, NEUTRAL_TONE } from "./questMapPalette";
import {
  childrenOf,
  deliveryLeaves,
  describeCounts,
  questionStatusLabels,
  workPath,
  workStateLabels,
} from "./questModel";
import { useQuestConversationThreads, conversationStatusLabel } from "./QuestConversations";

const chipClass =
  "inline-flex max-w-full items-center gap-1 rounded border px-1.5 py-0.5 text-2xs text-muted-foreground";

const stateDot: Record<QuestWork["state"], string> = {
  planned: "border border-muted-foreground bg-transparent",
  active: "bg-info",
  attention: "bg-warning",
  review: "bg-secondary-foreground/60",
  deferred: "border border-dashed border-muted-foreground bg-transparent",
  done: "bg-success",
};

/** Neighbours get a short arrow across their shared border; distant regions a gentle arc. */
function linkPath(link: TerritoryLink) {
  const dx = link.to.x - link.from.x;
  const dy = link.to.y - link.from.y;
  const length = Math.hypot(dx, dy);
  if (length < 40) return `M ${link.from.x} ${link.from.y} L ${link.to.x} ${link.to.y}`;
  const bow = Math.min(40, length * 0.18);
  const mx = (link.from.x + link.to.x) / 2 - (dy / length) * bow;
  const my = (link.from.y + link.to.y) / 2 + (dx / length) * bow;
  return `M ${link.from.x} ${link.from.y} Q ${mx} ${my} ${link.to.x} ${link.to.y}`;
}

const isUncertain = (work: QuestWork) => work.state === "planned" || work.state === "deferred";

function initiallyExpanded(
  state: ReturnType<typeof useQuest>["state"],
  reveal: string | null,
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const id of [state.currentWorkId, reveal]) {
    if (!id) continue;
    for (const item of workPath(state, id)) ids.add(item.id);
  }
  for (const root of childrenOf(state, null)) ids.add(root.id);
  return ids;
}

export function QuestWorkMap({
  selectedId,
  initialFocus,
}: {
  selectedId: string | null;
  initialFocus: string | null;
}) {
  const { state } = useQuest();
  const [expanded, setExpanded] = useState(() => initiallyExpanded(state, initialFocus));
  const [focusId, setFocusId] = useState<string | null>(null);
  const [layout, setLayout] = useState<"territory" | "outline">("territory");
  const focus = focusId ? (state.work.find((item) => item.id === focusId) ?? null) : null;
  // Work whose saved parent is missing starts its own branch rather than vanishing.
  const roots = focus
    ? [focus]
    : state.work.filter(
        (item) => item.parentId === null || !state.work.some((other) => other.id === item.parentId),
      );
  const effects = mapEffects(state);
  // The compiler keeps this across hover, pins and panel changes; only records, folding and focus relayout.
  const territory = layoutTerritory(
    state,
    effects,
    expanded,
    roots.map((item) => item.id),
  );
  const threads = useQuestConversationThreads();
  const toggle = (id: string) =>
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const focusOn = (id: string | null) => {
    setFocusId(id);
    if (id) setExpanded((previous) => new Set([...previous, id]));
  };
  // The region last clicked or focused; unlike the pin it survives closing the details overlay.
  const [targetId, setTargetId] = useState(selectedId);
  const selected = targetId ? state.work.find((item) => item.id === targetId) : undefined;
  const selectedParts = selected ? childrenOf(state, selected.id).length : 0;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <nav aria-label="Map focus" className="flex min-w-0 flex-wrap items-center gap-1 text-sm">
          <button
            type="button"
            className={cn("rounded px-1.5 py-0.5 hover:bg-accent", !focus && "font-medium")}
            onClick={() => focusOn(null)}
          >
            Whole Quest
          </button>
          {focus
            ? workPath(state, focus.id).map((item) => (
                <span key={item.id} className="flex items-center gap-1">
                  <ChevronRightIcon aria-hidden className="size-3 text-muted-foreground" />
                  <button
                    type="button"
                    className={cn(
                      "rounded px-1.5 py-0.5 hover:bg-accent",
                      item.id === focus.id && "font-medium",
                    )}
                    onClick={() => focusOn(item.id)}
                  >
                    {item.title}
                  </button>
                </span>
              ))
            : null}
        </nav>
        <div className="ms-auto flex flex-wrap items-center gap-1">
          {/* Always rendered so choosing a region never shifts the map under the pointer. */}
          <span
            role="group"
            aria-label={selected ? `Selected: ${selected.title}` : "No region selected"}
            className="me-1 flex items-center gap-1 border-e pe-2"
          >
            <span className="max-w-40 truncate text-xs text-muted-foreground">
              {selected?.title ?? "Click a region"}
            </span>
            <Button
              size="xs"
              variant="outline"
              disabled={!selected || selectedParts === 0}
              onClick={() => selected && toggle(selected.id)}
            >
              {selected && expanded.has(selected.id) && selectedParts > 0
                ? "Collapse"
                : `Expand${selectedParts > 0 ? ` ${selectedParts}` : ""}`}
            </Button>
            <Button
              size="xs"
              variant="ghost"
              disabled={!selected || selectedParts === 0}
              aria-label={selected ? `Focus on ${selected.title}` : "Focus"}
              onClick={() => selected && focusOn(selected.id)}
            >
              <CrosshairIcon aria-hidden />
              Focus
            </Button>
          </span>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => setExpanded(new Set(state.work.map((item) => item.id)))}
          >
            Expand all
          </Button>
          <Button size="xs" variant="ghost" onClick={() => setExpanded(new Set())}>
            Collapse all
          </Button>
          <Button
            size="xs"
            variant={layout === "outline" ? "secondary" : "ghost"}
            aria-pressed={layout === "outline"}
            onClick={() => setLayout(layout === "territory" ? "outline" : "territory")}
          >
            Outline
          </Button>
        </div>
      </div>
      {layout === "territory" ? (
        <TerritoryView
          territory={territory}
          selectedId={selectedId}
          threads={threads}
          onToggle={toggle}
          onTarget={setTargetId}
          onShowOutline={() => setLayout("outline")}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <ul role="tree" aria-label="Work outline">
            {roots.map((item) => (
              <MapNode
                key={item.id}
                work={item}
                threads={threads}
                expanded={expanded}
                onToggle={toggle}
                onFocus={focusOn}
                selectedId={selectedId}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function TerritoryView({
  territory,
  selectedId,
  threads,
  onToggle,
  onTarget,
  onShowOutline,
}: {
  territory: Territory;
  selectedId: string | null;
  threads: ReturnType<typeof useQuestConversationThreads>;
  onToggle: (id: string) => void;
  onTarget: (id: string) => void;
  onShowOutline: () => void;
}) {
  const { state, previewWorkId, previewEntry, previewPanel, pinnedEntry, openPanel } = useQuest();
  const inspect = useWorkInspection();
  const pinnedKey = pinnedEntry?.type === "cell" ? pinnedEntry.key : null;
  const previewKey = previewEntry?.type === "cell" ? previewEntry.key : null;
  const active = previewWorkId ?? selectedId;
  const links = territoryLinks(state, territory, active);
  const leaves = territory.regions.filter((region) => !region.expanded);
  const parents = territory.regions.filter((region) => region.expanded);
  const regionOf = new Map(territory.regions.map((region) => [region.work.id, region]));
  const { toneOf } = mapTones(state);
  const missing = territory.undrawn.length + territory.unreachable.length;
  const { bounds } = territory;
  const signals = (work: QuestWork) => {
    const waiting = state.questions.some((question) => {
      if (question.workId !== work.id) return false;
      const status = questQuestionStatus(question);
      return status === "open" || status === "recorded";
    });
    const working = state.conversations.some(
      (item) =>
        item.workId === work.id &&
        conversationStatusLabel(threads.get(item.threadId) ?? null) === "agent working",
    );
    return { needsYou: waiting || work.state === "attention", working };
  };
  const describe = (region: Region) => {
    const { needsYou, working } = signals(region.work);
    const results = territory.units.filter(
      (unit) => unit.workId === region.work.id && unit.kind !== "reference",
    ).length;
    return [
      region.work.title,
      "Scope",
      region.work.kind === "attempt" ? "Attempt" : null,
      workStateLabels[region.work.state],
      state.currentWorkId === region.work.id ? "Current milestone" : null,
      region.childCount > 0
        ? `${region.childCount} ${region.childCount === 1 ? "part" : "parts"}, ${region.expanded ? "expanded" : "folded"}`
        : null,
      results > 0 ? `${results} ${results === 1 ? "result" : "results"}` : null,
      needsYou ? "Needs you" : null,
      working ? "Agent working" : null,
    ]
      .filter(Boolean)
      .join(" · ");
  };
  const interact = (region: Region) => {
    const handlers = inspect(region.work.id);
    const id = region.work.id;
    return {
      ...handlers,
      onClick: () => {
        onTarget(id);
        handlers.onClick();
      },
      tabIndex: 0,
      role: "button",
      "aria-label": describe(region),
      "aria-pressed": selectedId === region.work.id,
      "data-work-id": region.work.id,
      onKeyDown: (event: KeyboardEvent) => {
        const opens = event.key === "ArrowRight" || event.key === "+";
        const closes = event.key === "ArrowLeft" || event.key === "-";
        if (region.childCount > 0 && (opens ? !region.expanded : closes && region.expanded)) {
          event.preventDefault();
          onToggle(id);
          return;
        }
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onTarget(id);
        handlers.onClick();
      },
      onDoubleClick: () => {
        if (region.childCount > 0) onToggle(id);
      },
      className: "cursor-pointer outline-none",
    };
  };
  // Cells preview and pin in the details column, like work does.
  const cellHandlers = (unit: PlacedUnit) => {
    const entry = { type: "cell" as const, ...cellSelection(unit) };
    const pin = () => {
      previewPanel(null);
      onTarget(unit.workId);
      openPanel(entry);
    };
    return {
      tabIndex: 0,
      role: "button",
      "aria-label": `${unitLabel(unit)} · in ${regionOf.get(unit.workId)?.work.title ?? ""}`,
      "aria-pressed": pinnedKey === unit.key,
      "data-effect-key": unit.key,
      className: "cursor-pointer outline-none",
      onPointerEnter: (event: PointerEvent) => {
        if (event.pointerType !== "touch") previewPanel(entry);
      },
      onPointerLeave: () => previewPanel(null),
      onFocus: () => previewPanel(entry),
      onBlur: () => previewPanel(null),
      onClick: pin,
      onKeyDown: (event: KeyboardEvent) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        pin();
      },
    };
  };

  const hoveredCellWork = previewEntry?.type === "cell" ? previewEntry.workId : null;
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <MapLegend
          territory={territory}
          toneOf={toneOf}
          active={active}
          hoveredCellWork={hoveredCellWork}
          signals={signals}
          interact={interact}
          cellEntry={(effectId) => {
            const unit =
              territory.units.find(
                (item) =>
                  item.kind !== "reference" &&
                  item.effects.some((effect) => effect.id === effectId),
              ) ??
              territory.units.find((item) => item.effects.some((effect) => effect.id === effectId));
            return unit ? { type: "cell" as const, ...cellSelection(unit) } : null;
          }}
        />
        <div
          role="group"
          aria-label="Work map"
          className="scrollbar-gutter-both flex min-h-0 flex-1 overflow-auto p-3"
        >
          <svg
            viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`}
            // A fixed scale keeps names readable; a large map scrolls instead of shrinking.
            width={bounds.width * MAP_SCALE}
            height={bounds.height * MAP_SCALE}
            className="m-auto block shrink-0"
          >
            <defs>
              <pattern
                id="quest-territory-hatch"
                width="7"
                height="7"
                patternUnits="userSpaceOnUse"
                patternTransform="rotate(45)"
              >
                <line x1="0" y1="0" x2="0" y2="7" stroke="currentColor" strokeWidth="0.8" />
              </pattern>
              <marker
                id="quest-territory-arrow"
                viewBox="0 0 10 10"
                refX="7"
                refY="5"
                markerWidth="5"
                markerHeight="5"
                orient="auto"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" className="fill-foreground" />
              </marker>
            </defs>
            {leaves.map((region) => {
              const uncertain = isUncertain(region.work);
              const isActive = active === region.work.id;
              return (
                <g key={region.work.id} {...interact(region)}>
                  <path
                    d={cellsPath(region.cells)}
                    className={cn(
                      uncertain ? toneOf(region.work).hatch : toneOf(region.work).ground,
                      "stroke-foreground/8",
                    )}
                    fill={uncertain ? "url(#quest-territory-hatch)" : undefined}
                    strokeWidth={0.6}
                  />
                  <path
                    d={boundaryPath(region.cells)}
                    fill="none"
                    strokeWidth={isActive ? 1.4 : 0.7}
                    strokeDasharray={
                      uncertain || region.work.kind === "attempt" ? "5 3" : undefined
                    }
                    className={isActive ? "stroke-foreground/80" : "stroke-foreground/30"}
                  />
                </g>
              );
            })}
            {territory.units.map((unit) => {
              const isShown = previewKey === unit.key;
              const isPinned = pinnedKey === unit.key;
              const site = sitePoint(unit.cell);
              const filled = unit.kind !== "reference" && !unit.planned;
              // A dotted reference to a result of the hovered region elsewhere: related, not the region.
              const related =
                unit.kind === "reference" &&
                active !== null &&
                unit.workId !== active &&
                unit.effects.some((effect) => effect.homeWorkId === active);
              const region = regionOf.get(unit.workId);
              const tone = region ? toneOf(region.work) : NEUTRAL_TONE;
              return (
                <g key={unit.key} {...cellHandlers(unit)}>
                  <path
                    d={insetCellPath(unit.cell)}
                    className={cn(
                      filled
                        ? unit.kind === "aggregate"
                          ? tone.grouped
                          : tone.effect
                        : "fill-background/70",
                      isShown || isPinned || related ? "stroke-foreground" : "stroke-foreground/45",
                    )}
                    strokeWidth={
                      isPinned ? 1.6 : isShown ? 1.2 : related ? 1.1 : filled ? 0.4 : 0.7
                    }
                    strokeDasharray={
                      unit.kind === "reference" ? "1.5 2.5" : unit.planned ? "4 2.5" : undefined
                    }
                  />
                  {unit.kind === "aggregate" ? (
                    <text
                      x={site.x}
                      y={site.y}
                      textAnchor="middle"
                      dominantBaseline="central"
                      pointerEvents="none"
                      style={{ fontSize: LABEL_SIZE }}
                      className="fill-foreground font-semibold"
                    >
                      {unit.effects.length}
                    </text>
                  ) : null}
                </g>
              );
            })}
            {parents.map((region) => (
              <path
                key={region.work.id}
                d={boundaryPath(region.cells)}
                fill="none"
                pointerEvents="none"
                strokeWidth={
                  state.currentWorkId === region.work.id
                    ? 1.6
                    : active === region.work.id
                      ? 1.4
                      : 1.1
                }
                strokeDasharray={isUncertain(region.work) ? "6 3" : undefined}
                className={
                  state.currentWorkId === region.work.id || active === region.work.id
                    ? "stroke-foreground/85"
                    : "stroke-foreground/45"
                }
              />
            ))}
            {leaves
              .filter((region) => state.currentWorkId === region.work.id)
              .map((region) => (
                <path
                  key={`current:${region.work.id}`}
                  d={boundaryPath(region.cells)}
                  fill="none"
                  pointerEvents="none"
                  strokeWidth={1.6}
                  className="stroke-foreground/85"
                />
              ))}
            {links.map((link) => {
              const d = linkPath(link);
              return (
                <g key={link.id} data-link={link.type} pointerEvents="none">
                  <path d={d} fill="none" strokeWidth={3} className="stroke-background" />
                  <path
                    d={d}
                    fill="none"
                    strokeWidth={1}
                    strokeDasharray={
                      link.type === "retries" ? "5 3" : link.viaAncestor ? "2 2.5" : undefined
                    }
                    markerEnd="url(#quest-territory-arrow)"
                    className="stroke-foreground"
                  />
                </g>
              );
            })}
          </svg>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-4 py-1.5 text-2xs text-muted-foreground">
        <span>
          Filled cell: one result · dotted: recorded elsewhere · hatched: rough planned scope ·
          heavy outline: current milestone · cell size is not effort
        </span>
        {territory.unplaced.length > 0 ? (
          <span>{territory.unplaced.length} results name no work in this view</span>
        ) : null}
        {missing > 0 ? (
          <button type="button" className="ms-auto underline" onClick={onShowOutline}>
            {missing} not drawn here · Outline lists all work
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Names live beside the map, not on it: every drawn region in layout order with its workstream
 * colour, previewing and pinning like the map, plus the most recently recorded changes.
 */
function MapLegend({
  territory,
  toneOf,
  active,
  hoveredCellWork,
  signals,
  interact,
  cellEntry,
}: {
  territory: Territory;
  toneOf: ReturnType<typeof mapTones>["toneOf"];
  active: string | null;
  hoveredCellWork: string | null;
  signals: (work: QuestWork) => { needsYou: boolean; working: boolean };
  interact: (region: Region) => Record<string, unknown>;
  cellEntry: (effectId: string) => QuestCellEntry | null;
}) {
  const { state, previewWork, previewPanel, openPanel } = useQuest();
  const drawn = new Set(territory.regions.map((region) => region.work.id));
  const recent: Array<{
    id: string;
    summary: string;
    at: string;
    revision: number;
    reconstructed: boolean;
    open: () => void;
    preview: (on: boolean) => void;
  }> = [];
  const effectById = new Map(
    territory.units.flatMap((unit) => unit.effects).map((effect) => [effect.id, effect]),
  );
  const seen = new Set<string>();
  for (const entry of state.history.toReversed()) {
    if (recent.length >= 6) break;
    const target = entry.targetId;
    if (target === null || seen.has(target)) continue;
    if (entry.kind === "contribution") {
      const cell = cellEntry(target);
      if (!cell) continue;
      seen.add(target);
      recent.push({
        id: entry.id,
        summary: entry.summary,
        at: entry.at,
        revision: entry.revision,
        reconstructed: effectById.get(target)?.reconstructionId != null,
        open: () => openPanel(cell),
        preview: (on) => previewPanel(on ? cell : null),
      });
    } else if (entry.kind === "work" && drawn.has(target)) {
      seen.add(target);
      recent.push({
        id: entry.id,
        summary: entry.summary,
        at: entry.at,
        revision: entry.revision,
        reconstructed: false,
        open: () => openPanel({ type: "work", id: target }),
        preview: (on) => previewWork(on ? target : null),
      });
    }
  }
  return (
    <nav
      aria-label="Map legend"
      className="max-h-48 shrink-0 overflow-y-auto border-b py-2 text-sm md:max-h-none md:w-72 md:border-e md:border-b-0"
    >
      <ul>
        {territory.regions.map((region) => {
          const { needsYou, working } = signals(region.work);
          const handlers = interact(region);
          const lit = active === region.work.id || hoveredCellWork === region.work.id;
          return (
            <li key={region.work.id}>
              <div
                {...handlers}
                aria-label={undefined}
                aria-current={state.currentWorkId === region.work.id ? "step" : undefined}
                className={cn(
                  "flex cursor-pointer items-start gap-2 py-1 pe-3 outline-none hover:bg-accent focus-visible:bg-accent",
                  lit && "bg-accent",
                )}
                style={{ paddingInlineStart: `${0.75 + region.depth * 0.875}rem` }}
              >
                <span
                  aria-hidden
                  className={cn(
                    "mt-1 size-3 shrink-0 rounded-sm",
                    toneOf(region.work).swatch,
                    isUncertain(region.work) && "opacity-45",
                  )}
                />
                <span
                  className={cn(
                    "min-w-0 flex-1",
                    region.expanded || state.currentWorkId === region.work.id
                      ? "font-medium"
                      : undefined,
                    isUncertain(region.work) && "text-muted-foreground",
                  )}
                >
                  {region.work.title}
                </span>
                {needsYou ? (
                  <CircleAlertIcon
                    aria-label="Needs you"
                    className="mt-0.5 size-3.5 shrink-0 text-warning"
                  />
                ) : null}
                {working ? (
                  <BotIcon
                    aria-label="Agent working"
                    className="mt-0.5 size-3.5 shrink-0 text-info"
                  />
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {recent.length > 0 ? (
        <section aria-label="Recently recorded" className="mt-3 border-t pt-2">
          <h3 className="px-3 text-xs font-medium text-muted-foreground">Recently recorded</h3>
          <ol>
            {recent.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="w-full px-3 py-1 text-start hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                  onPointerEnter={() => item.preview(true)}
                  onPointerLeave={() => item.preview(false)}
                  onFocus={() => item.preview(true)}
                  onBlur={() => item.preview(false)}
                  onClick={() => {
                    item.preview(false);
                    item.open();
                  }}
                >
                  <span className="line-clamp-2 text-xs">{item.summary}</span>
                  <span className="text-2xs text-muted-foreground">
                    Revision {item.revision} · recorded {recentFormat.format(new Date(item.at))}
                    {item.reconstructed ? " · reconstruction of earlier work" : null}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </nav>
  );
}

const recentFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" });

function unitLabel(unit: PlacedUnit) {
  const first = unit.effects[0]!;
  if (unit.effects.length > 1)
    return `${unit.effects.length} results${unit.kind === "reference" ? " recorded elsewhere" : ""}: ${unit.effects.map((effect) => effect.contribution.title).join(", ")}`;
  const prefix =
    unit.kind === "reference"
      ? "Result recorded elsewhere"
      : unit.planned
        ? "Planned effect"
        : "Result";
  return `${prefix}: ${first.contribution.title}`;
}

function MapNode({
  work,
  threads,
  expanded,
  onToggle,
  onFocus,
  selectedId,
}: {
  work: QuestWork;
  threads: ReturnType<typeof useQuestConversationThreads>;
  expanded: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onFocus: (id: string) => void;
  selectedId: string | null;
}) {
  const { state, openPanel } = useQuest();
  const parts = childrenOf(state, work.id);
  const isOpen = expanded.has(work.id);
  const byId = (id: string) => state.work.find((item) => item.id === id)?.title ?? id;
  const after = state.relations.filter((r) => r.type === "follows" && r.from === work.id);
  const before = state.relations.filter((r) => r.type === "follows" && r.to === work.id);
  const retries = state.relations.filter((r) => r.type === "retries" && r.from === work.id);
  const retriedBy = state.relations.filter((r) => r.type === "retries" && r.to === work.id);
  const questions = state.questions.filter((question) => question.workId === work.id);
  const conversations = state.conversations.filter((item) => item.workId === work.id);
  const isCurrent = state.currentWorkId === work.id;
  const leaves = deliveryLeaves(state, work.id);
  const attemptCount = parts.filter((item) => item.kind === "attempt").length;
  const workPartCount = parts.length - attemptCount;
  const linkChips = [
    ...(after.length ? [`After: ${after.map((r) => byId(r.to)).join(", ")}`] : []),
    ...(before.length ? [`Before: ${before.map((r) => byId(r.from)).join(", ")}`] : []),
    ...(retries.length ? [`Retries: ${retries.map((r) => byId(r.to)).join(", ")}`] : []),
    ...(retriedBy.length ? [`Retried by: ${retriedBy.map((r) => byId(r.from)).join(", ")}`] : []),
  ];
  const example = [...after, ...before, ...retries, ...retriedBy].some(
    (relation) => relation.provenance === "example",
  );
  return (
    <li
      role="treeitem"
      aria-expanded={parts.length > 0 ? isOpen : undefined}
      aria-selected={selectedId === work.id}
      aria-label={work.title}
      className="list-none"
    >
      <div className="flex items-start gap-1 py-1">
        {parts.length > 0 ? (
          <button
            type="button"
            className="mt-2.5 rounded p-1 hover:bg-accent"
            aria-label={`${isOpen ? "Collapse" : "Expand"} ${work.title}`}
            onClick={() => onToggle(work.id)}
          >
            {isOpen ? (
              <ChevronDownIcon className="size-3.5" />
            ) : (
              <ChevronRightIcon className="size-3.5" />
            )}
          </button>
        ) : (
          <span className="w-5.5 shrink-0" />
        )}
        <div
          className={cn(
            "group min-w-0 flex-1 rounded-lg border bg-card",
            work.kind === "attempt" && "border-dashed bg-transparent",
            isCurrent && "border-info/60",
            selectedId === work.id && "ring-2 ring-ring",
          )}
        >
          <button
            type="button"
            className="block w-full px-3 py-2 text-left"
            onClick={() => openPanel({ type: "work", id: work.id })}
          >
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span
                aria-hidden
                className={cn("size-2 shrink-0 rounded-full", stateDot[work.state])}
              />
              {work.kind === "attempt" ? "Attempt · " : ""}
              {workStateLabels[work.state]}
              {isCurrent ? (
                <Badge variant="info" size="sm">
                  Current milestone
                </Badge>
              ) : null}
            </span>
            <span className="mt-0.5 block text-sm font-medium">{work.title}</span>
            {parts.length > 0 && !isOpen ? (
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {[
                  workPartCount > 0
                    ? `${workPartCount} ${workPartCount === 1 ? "part" : "parts"} · ${describeCounts(leaves)}`
                    : null,
                  attemptCount > 0
                    ? `${attemptCount} earlier ${attemptCount === 1 ? "attempt" : "attempts"}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            ) : null}
          </button>
          {linkChips.length + questions.length + conversations.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 px-3 pb-2">
              {linkChips.map((chip) => (
                <span key={chip} className={chipClass}>
                  {chip}
                  {example ? " · example link" : ""}
                </span>
              ))}
              {questions.map((question) => {
                const status = questQuestionStatus(question);
                return (
                  <button
                    key={question.id}
                    type="button"
                    className={cn(
                      chipClass,
                      "hover:bg-accent",
                      (status === "open" || status === "recorded") &&
                        "border-warning/50 text-warning-foreground",
                    )}
                    onClick={() => openPanel({ type: "question", id: question.id })}
                  >
                    Decision · {questionStatusLabels[status].toLowerCase()}
                  </button>
                );
              })}
              {conversations.map((conversation) => {
                const thread = threads.get(conversation.threadId) ?? null;
                return (
                  <span key={conversation.threadId} className={chipClass}>
                    <MessageSquareIcon aria-hidden className="size-3 shrink-0" />
                    {thread?.title ?? conversation.title} · {conversationStatusLabel(thread)}
                  </span>
                );
              })}
            </div>
          ) : null}
        </div>
        {parts.length > 0 ? (
          <div className="mt-1.5">
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={`Focus on ${work.title}`}
              title="Show only this branch"
              onClick={() => onFocus(work.id)}
            >
              <CrosshairIcon />
            </Button>
          </div>
        ) : null}
      </div>
      {parts.length > 0 && isOpen ? (
        <ul role="group" className="ms-3 border-s ps-3">
          {parts.map((part) => (
            <MapNode
              key={part.id}
              work={part}
              threads={threads}
              expanded={expanded}
              onToggle={onToggle}
              onFocus={onFocus}
              selectedId={selectedId}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

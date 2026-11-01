import type { QuestWork } from "@t3tools/contracts";
import { BotIcon, ChevronLeftIcon, ChevronRightIcon, CircleAlertIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "~/lib/utils";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { useQuest, useWorkInspection } from "./questContext";
import { conversationStatusLabel, useQuestConversationThreads } from "./QuestConversations";
import {
  deliveryLeaves,
  describeCounts,
  phaseLabels,
  workStateLabels,
  workstreamSlots,
} from "./questModel";
import { layoutRoadmap, ribbonD, ROADMAP_BAR, type RoadmapStop } from "./questRoadmap";

const ribbonClass: Record<QuestWork["state"], string> = {
  planned: "fill-muted-foreground stroke-muted-foreground",
  active: "fill-info stroke-info",
  attention: "fill-warning stroke-warning",
  review: "fill-secondary-foreground stroke-secondary-foreground",
  deferred: "fill-muted-foreground stroke-muted-foreground",
  done: "fill-success stroke-success",
};

type Overflow = { readonly earlier: boolean; readonly later: boolean };

function overflowOf(element: HTMLElement): Overflow {
  return {
    earlier: element.scrollLeft > 1,
    later: element.scrollLeft + element.clientWidth < element.scrollWidth - 1,
  };
}

function keepIfSame(next: Overflow) {
  return (previous: Overflow) =>
    previous.earlier === next.earlier && previous.later === next.later ? previous : next;
}

// Literal classes so Tailwind generates them; one per workstream palette slot. Ribbons into
// planned milestones are lighter but keep their colour.
const streamRibbon = [
  {
    reached: "fill-stream-1/80 stroke-stream-1 dark:fill-stream-1/85",
    ahead: "fill-stream-1/50 stroke-stream-1 dark:fill-stream-1/55",
  },
  {
    reached: "fill-stream-2/80 stroke-stream-2 dark:fill-stream-2/85",
    ahead: "fill-stream-2/50 stroke-stream-2 dark:fill-stream-2/55",
  },
  {
    reached: "fill-stream-3/80 stroke-stream-3 dark:fill-stream-3/85",
    ahead: "fill-stream-3/50 stroke-stream-3 dark:fill-stream-3/55",
  },
  {
    reached: "fill-stream-4/80 stroke-stream-4 dark:fill-stream-4/85",
    ahead: "fill-stream-4/50 stroke-stream-4 dark:fill-stream-4/55",
  },
  {
    reached: "fill-stream-5/80 stroke-stream-5 dark:fill-stream-5/85",
    ahead: "fill-stream-5/50 stroke-stream-5 dark:fill-stream-5/55",
  },
  {
    reached: "fill-stream-6/80 stroke-stream-6 dark:fill-stream-6/85",
    ahead: "fill-stream-6/50 stroke-stream-6 dark:fill-stream-6/55",
  },
] as const;

/** The workstream a ribbon continues: one both ends share, else where it leads, else where it starts. */
function ribbonStream(source: QuestWork, target: QuestWork): string | null {
  const from = source.workstreamIds ?? [];
  const to = target.workstreamIds ?? [];
  return to.find((id) => from.includes(id)) ?? to[0] ?? from[0] ?? null;
}

/**
 * Milestone overview as a Sankey: explicit milestones and the dependencies between them, or for
 * older Quests the current work fanning out to its parts. Ribbon width is the explicit planned
 * focus of the work a ribbon leads into; unset focus is a neutral width with a faded, dashed ribbon.
 */
export function QuestRoadmap({ selectedWorkId }: { selectedWorkId: string | null }) {
  const { state, openPanel, previewWorkId } = useQuest();
  const inspect = useWorkInspection();
  const threads = useQuestConversationThreads();
  const roadmap = layoutRoadmap(state);
  const scroller = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState<Overflow>({ earlier: false, later: false });
  const updateOverflow = () => {
    if (scroller.current) setOverflow(keepIfSame(overflowOf(scroller.current)));
  };
  const pan = (direction: -1 | 1) =>
    scroller.current?.scrollBy({
      left: direction * scroller.current.clientWidth * 0.75,
      behavior: "smooth",
    });
  // Past work keeps the left edge; scroll only as far as the current milestone and its next step need.
  const reach = roadmap
    ? Math.max(0, ...roadmap.stops.filter((stop) => stop.isCurrent).map((stop) => stop.x)) +
      roadmap.column * 1.5
    : 0;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the current milestone in the scrolled viewport of a plan too deep to fit
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    element.scrollLeft = Math.max(0, reach - element.clientWidth);
    setOverflow(keepIfSame(overflowOf(element)));
  }, [reach]);
  if (!roadmap) return null;
  const slots = workstreamSlots(state);
  const byId = new Map(roadmap.stops.map((stop) => [stop.work.id, stop]));
  const working = (stop: RoadmapStop) =>
    stop.threadIds.filter(
      (id) => conversationStatusLabel(threads.get(id) ?? null) === "agent working",
    ).length;
  const lowestInColumn = new Map<number, RoadmapStop>();
  const columnSize = new Map<number, number>();
  for (const stop of roadmap.stops) {
    columnSize.set(stop.column, (columnSize.get(stop.column) ?? 0) + 1);
    const lowest = lowestInColumn.get(stop.column);
    if (!lowest || stop.y > lowest.y) lowestInColumn.set(stop.column, stop);
  }
  const highlighted = previewWorkId ?? selectedWorkId;
  const half = ROADMAP_BAR / 2;

  return (
    <section aria-label="Milestone roadmap" className="relative border-b">
      {overflow.earlier ? (
        <Button
          size="icon-sm"
          variant="outline"
          aria-label="Earlier milestones"
          className="absolute top-1/2 left-2 z-10 -translate-y-1/2"
          onClick={() => pan(-1)}
        >
          <ChevronLeftIcon />
        </Button>
      ) : null}
      {overflow.later ? (
        <Button
          size="icon-sm"
          variant="outline"
          aria-label="Later milestones"
          className="absolute top-1/2 right-2 z-10 -translate-y-1/2"
          onClick={() => pan(1)}
        >
          <ChevronRightIcon />
        </Button>
      ) : null}
      <div ref={scroller} className="overflow-x-auto" onScroll={updateOverflow}>
        <div className="relative mx-auto" style={{ width: roadmap.width, height: roadmap.height }}>
          <svg
            aria-hidden
            width={roadmap.width}
            height={roadmap.height}
            className="absolute inset-0"
          >
            {roadmap.paths.map((path) => {
              const source = byId.get(path.source);
              const target = byId.get(path.target);
              if (!source || !target) return null;
              const unset = target.work.focus === undefined;
              const lit = highlighted === source.work.id || highlighted === target.work.id;
              const stream = ribbonStream(source.work, target.work);
              const slot = stream === null ? undefined : slots.get(stream);
              const ahead = target.work.state === "planned" || target.work.state === "deferred";
              const points = [
                { x: source.x + half, y: path.sourceY },
                ...path.via,
                { x: target.x - half, y: path.targetY },
              ];
              return (
                <g
                  key={path.id}
                  className={
                    slot === undefined
                      ? ribbonClass[target.work.state]
                      : streamRibbon[slot]![ahead ? "ahead" : "reached"]
                  }
                  fillOpacity={
                    slot === undefined ? (ahead ? 0.3 : 0.6) + (lit ? 0.25 : 0) : lit ? 1 : 0.9
                  }
                  strokeOpacity={unset ? 0.3 : 0}
                  strokeWidth={0.75}
                  strokeDasharray={unset ? "3 3" : undefined}
                >
                  {points.slice(1).map((point, index) => (
                    <path
                      key={`${point.x}:${point.y}`}
                      d={ribbonD(points[index]!.x, points[index]!.y, point.x, point.y, path.width)}
                    />
                  ))}
                </g>
              );
            })}
            {roadmap.stops.map((stop) => {
              const height = Math.max(stop.inHeight, stop.outHeight);
              const split = stop.inHeight !== stop.outHeight;
              const bar = stop.isCurrent ? "fill-info" : "fill-foreground/70";
              return (
                <g key={stop.work.id} className="cursor-pointer" {...inspect(stop.work.id)}>
                  {/* A wider transparent target keeps thin bars easy to hover and tap. */}
                  <rect
                    x={stop.x - 8}
                    y={stop.y - height / 2 - 4}
                    width={16}
                    height={height + 8}
                    fill="transparent"
                  />
                  {split ? (
                    <>
                      <rect
                        x={stop.x - half}
                        y={stop.y - stop.inHeight / 2}
                        width={half}
                        height={stop.inHeight}
                        className={bar}
                      />
                      <rect
                        x={stop.x}
                        y={stop.y - stop.outHeight / 2}
                        width={half}
                        height={stop.outHeight}
                        className={bar}
                      />
                    </>
                  ) : (
                    <rect
                      x={stop.x - half}
                      y={stop.y - height / 2}
                      width={ROADMAP_BAR}
                      height={height}
                      className={bar}
                    />
                  )}
                  {selectedWorkId === stop.work.id ? (
                    <rect
                      x={stop.x - half - 3}
                      y={stop.y - height / 2 - 3}
                      width={ROADMAP_BAR + 6}
                      height={height + 6}
                      rx={2}
                      fill="none"
                      strokeWidth={2}
                      className="stroke-ring"
                    />
                  ) : null}
                </g>
              );
            })}
            {roadmap.gap ? (
              <rect
                x={roadmap.gap.x - half}
                y={roadmap.gap.y - 8}
                width={ROADMAP_BAR}
                height={16}
                fill="none"
                strokeDasharray="2 2"
                className="stroke-muted-foreground/60"
              />
            ) : null}
          </svg>
          {roadmap.stops.map((stop) => (
            <RoadmapLabel
              key={stop.work.id}
              stop={stop}
              below={
                (columnSize.get(stop.column) ?? 0) > 1 && lowestInColumn.get(stop.column) === stop
              }
              areaHeight={roadmap.height}
              working={working(stop)}
              isSelected={selectedWorkId === stop.work.id}
              streams={(stop.work.workstreamIds ?? []).map(
                (id) => state.work.find((item) => item.id === id)?.title ?? id,
              )}
              inspection={inspect(stop.work.id)}
              onOpenNeed={() => {
                const need = stop.needs.length === 1 ? stop.needs[0]! : null;
                openPanel(
                  need?.type === "question"
                    ? { type: "question", id: need.id }
                    : { type: "work", id: need?.id ?? stop.work.id },
                );
              }}
              summary={
                stop.role !== "successor"
                  ? describeCounts(deliveryLeaves(state, stop.work.id))
                  : null
              }
            />
          ))}
          {roadmap.gap ? (
            <span
              className="absolute -translate-y-1/2 ps-3 text-xs whitespace-nowrap text-muted-foreground italic"
              style={{ left: roadmap.gap.x, top: roadmap.gap.y }}
            >
              No later milestone recorded
            </span>
          ) : null}
          <p className="absolute bottom-1 left-3 text-2xs text-muted-foreground">
            Width: planned focus · faded dashed: not set
          </p>
        </div>
      </div>
    </section>
  );
}

function RoadmapLabel({
  stop,
  below,
  areaHeight,
  working,
  isSelected,
  streams,
  summary,
  inspection,
  onOpenNeed,
}: {
  stop: RoadmapStop;
  below: boolean;
  areaHeight: number;
  working: number;
  isSelected: boolean;
  streams: ReadonlyArray<string>;
  summary: string | null;
  inspection: ReturnType<ReturnType<typeof useWorkInspection>>;
  onOpenNeed: () => void;
}) {
  const { work } = stop;
  const needs = stop.needs.length;
  const height = Math.max(stop.inHeight, stop.outHeight);
  const description = [
    stop.isCurrent ? "Current milestone" : stop.role === "successor" ? "Follows" : null,
    workStateLabels[work.state],
    work.phase ? phaseLabels[work.phase] : null,
    streams.length > 0 ? streams.join(", ") : null,
    work.focus === undefined ? "Planned focus not set" : `Planned focus ${work.focus} of 5`,
    summary && summary !== "No parts recorded" ? summary : null,
  ]
    .filter(Boolean)
    .join(" · ");
  // Angled so long names fit between columns; the full title is in the details panel.
  return (
    <div
      className={cn(
        "absolute flex max-w-80 items-center gap-1 whitespace-nowrap",
        below ? "origin-top-left rotate-[18deg]" : "origin-bottom-left -rotate-[18deg]",
      )}
      // Anchored by the corner nearest the bar, which is also the rotation origin.
      style={
        below
          ? { left: stop.x - 2, top: stop.y + height / 2 + 4 }
          : { left: stop.x - 2, bottom: areaHeight - (stop.y - height / 2 - 4) }
      }
    >
      <button
        type="button"
        aria-label={`${work.title} · ${description}`}
        aria-current={isSelected ? "true" : undefined}
        {...inspection}
        className={cn(
          "min-w-0 cursor-pointer truncate rounded-sm bg-background/90 px-1 text-sm leading-5 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
          stop.isCurrent ? "font-semibold" : "font-medium",
          work.state === "planned" || work.state === "deferred"
            ? "text-muted-foreground"
            : "text-foreground",
          isSelected && "underline decoration-2",
        )}
      >
        {work.title}
      </button>
      {needs > 0 ? (
        <Badge
          variant="warning"
          size="sm"
          render={
            <button
              type="button"
              aria-label={
                needs === 1
                  ? `Needs you: ${stop.needs[0]!.title}`
                  : `${needs} items need you in ${work.title}`
              }
              onClick={onOpenNeed}
            />
          }
        >
          <CircleAlertIcon aria-hidden />
          {needs}
        </Badge>
      ) : null}
      {stop.reviewCount > 0 ? (
        <Badge variant="secondary" size="sm">
          {stop.reviewCount} to review
        </Badge>
      ) : null}
      {working > 0 ? (
        <Badge
          variant="info"
          size="sm"
          aria-label={`Agent working in ${working} linked conversations`}
        >
          <BotIcon aria-hidden />
          {working}
        </Badge>
      ) : null}
    </div>
  );
}

import type { QuestWork } from "@t3tools/contracts";
import { BotIcon, CircleAlertIcon } from "lucide-react";

import { cn } from "~/lib/utils";

import { Badge } from "../ui/badge";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useQuest } from "./questContext";
import { conversationStatusLabel, useQuestConversationThreads } from "./QuestConversations";
import { deliveryLeaves, describeCounts, workStateLabels } from "./questModel";
import {
  layoutRoadmap,
  ROADMAP_LABEL,
  roadmapPathD,
  roadmapTrunkD,
  type RoadmapStop,
} from "./questRoadmap";

const dotClass: Record<QuestWork["state"], string> = {
  planned: "fill-background stroke-muted-foreground",
  active: "fill-info stroke-info",
  attention: "fill-warning stroke-warning",
  review: "fill-secondary-foreground/60 stroke-secondary-foreground/60",
  deferred: "fill-background stroke-muted-foreground [stroke-dasharray:2_2]",
  done: "fill-success stroke-success",
};

/** Drawn inside one translucent group, so lanes that overlap at forks and joins do not mix. */
const pathClass: Record<QuestWork["state"], string> = {
  planned: "stroke-muted-foreground/60",
  active: "stroke-info",
  attention: "stroke-warning",
  review: "stroke-secondary-foreground/60",
  deferred: "stroke-muted-foreground/60 [stroke-dasharray:4_6]",
  done: "stroke-success",
};

/** Milestone-level paths above the overview: what runs side by side, what joins, what is next. */
export function QuestRoadmap({ selectedWorkId }: { selectedWorkId: string | null }) {
  const { state, openPanel } = useQuest();
  const threads = useQuestConversationThreads();
  const roadmap = layoutRoadmap(state);
  if (!roadmap) return null;
  const byId = new Map(roadmap.stops.map((stop) => [stop.work.id, stop]));
  const milestone = roadmap.stops[0]!;
  const firstFork = roadmap.paths.find((path) => path.kind === "fork");
  const firstPart = firstFork ? byId.get(firstFork.target) : undefined;
  const working = (stop: RoadmapStop) =>
    stop.threadIds.filter(
      (id) => conversationStatusLabel(threads.get(id) ?? null) === "agent working",
    ).length;

  return (
    <section aria-label="Milestone roadmap" className="border-b">
      <div className="overflow-x-auto">
        <div className="relative mx-auto" style={{ width: roadmap.width, height: roadmap.height }}>
          <svg
            aria-hidden
            width={roadmap.width}
            height={roadmap.height}
            className="absolute inset-0"
            fill="none"
          >
            <g opacity={0.6} strokeWidth={4} strokeLinecap="round">
              {roadmap.paths.map((path) => {
                const source = byId.get(path.source);
                const target = byId.get(path.target);
                if (!source || !target) return null;
                // A lane keeps the colour of the part it carries, so forks take their target's state.
                const lane = source.role === "milestone" ? target : source;
                return (
                  <path
                    key={path.id}
                    d={roadmapPathD(source, target)}
                    className={pathClass[lane.work.state]}
                  />
                );
              })}
              {firstPart ? (
                <path
                  d={roadmapTrunkD(milestone, firstPart)}
                  className={pathClass[milestone.work.state]}
                />
              ) : null}
            </g>
            {roadmap.stops.map((stop) => (
              <g key={stop.work.id}>
                {stop.role === "milestone" ? (
                  <circle cx={stop.x} cy={stop.y} r={11} className="fill-info/15" />
                ) : null}
                <circle
                  cx={stop.x}
                  cy={stop.y}
                  r={stop.role === "milestone" ? 7 : 5.5}
                  strokeWidth={2}
                  className={dotClass[stop.work.state]}
                />
              </g>
            ))}
            {roadmap.gap ? (
              <circle
                cx={roadmap.gap.x}
                cy={roadmap.gap.y}
                r={5.5}
                strokeWidth={2}
                className="fill-background stroke-muted-foreground/60 [stroke-dasharray:2_2]"
              />
            ) : null}
          </svg>
          {roadmap.stops.map((stop) => (
            <RoadmapLabel
              key={stop.work.id}
              stop={stop}
              working={working(stop)}
              isSelected={selectedWorkId === stop.work.id}
              onOpen={() => openPanel({ type: "work", id: stop.work.id })}
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
              className="absolute flex h-6 items-center ps-4 text-xs text-muted-foreground italic"
              style={{ left: roadmap.gap.x - 6, top: roadmap.gap.y - 12 }}
            >
              No later milestone recorded
            </span>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function RoadmapLabel({
  stop,
  working,
  isSelected,
  summary,
  onOpen,
  onOpenNeed,
}: {
  stop: RoadmapStop;
  working: number;
  isSelected: boolean;
  summary: string | null;
  onOpen: () => void;
  onOpenNeed: () => void;
}) {
  const { work } = stop;
  const needs = stop.needs.length;
  const description = [
    stop.role === "milestone" ? "Current milestone" : stop.role === "successor" ? "Follows" : null,
    workStateLabels[work.state],
    summary && summary !== "No parts recorded" ? summary : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div
      className="absolute flex h-6 items-center gap-1"
      style={{ left: stop.x - 12, top: stop.y - 12, width: ROADMAP_LABEL }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label={`${work.title} · ${description}`}
              aria-current={isSelected ? "true" : undefined}
              onClick={onOpen}
              className={cn(
                "group flex h-6 min-w-0 items-center rounded-md ps-5 pe-0.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                isSelected && "ring-2 ring-ring ring-inset",
              )}
            />
          }
        >
          <span
            className={cn(
              "truncate rounded-sm bg-background px-1 group-hover:underline",
              stop.role === "milestone" ? "font-semibold" : "font-medium",
              work.state === "planned" || work.state === "deferred"
                ? "text-muted-foreground"
                : "text-foreground",
            )}
          >
            {work.title}
          </span>
        </TooltipTrigger>
        <TooltipPopup side="top">
          <span className="block font-medium">{work.title}</span>
          <span className="block">{description}</span>
        </TooltipPopup>
      </Tooltip>
      <span className="flex shrink-0 items-center gap-1 rounded-md bg-background empty:hidden">
        {needs > 0 ? (
          <Tooltip>
            <TooltipTrigger
              render={
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
                />
              }
            >
              <CircleAlertIcon aria-hidden />
              {needs}
            </TooltipTrigger>
            <TooltipPopup side="top">
              {stop.needs.map((need) => (
                <span key={`${need.type}:${need.id}`} className="block">
                  {need.title}
                </span>
              ))}
            </TooltipPopup>
          </Tooltip>
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
      </span>
    </div>
  );
}

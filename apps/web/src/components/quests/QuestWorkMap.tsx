import { questQuestionStatus, type QuestWork } from "@t3tools/contracts";
import { ChevronDownIcon, ChevronRightIcon, CrosshairIcon, MessageSquareIcon } from "lucide-react";
import { useState, type KeyboardEvent } from "react";

import { cn } from "~/lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { useQuest, useWorkInspection } from "./questContext";
import {
  boundaryPath,
  cellsPath,
  FIELD_HEIGHT,
  FIELD_WIDTH,
  layoutTerritory,
  territoryLinks,
  type Region,
  type Territory,
} from "./questTerritory";
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

/** Recorded states are filled; planned and deferred scope is hatched, since its extent is a guess. */
const regionFill: Record<QuestWork["state"], string> = {
  planned: "text-muted-foreground",
  active: "fill-info/30 stroke-info/30",
  attention: "fill-warning/35 stroke-warning/35",
  review: "fill-secondary-foreground/20 stroke-secondary-foreground/20",
  deferred: "text-muted-foreground/60",
  done: "fill-success/25 stroke-success/25",
};

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
          territory={layoutTerritory(
            state,
            expanded,
            roots.map((item) => item.id),
          )}
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
  const { state, previewWorkId } = useQuest();
  const inspect = useWorkInspection();
  const active = previewWorkId ?? selectedId;
  const links = territoryLinks(state, territory, active);
  const leaves = territory.regions.filter((region) => !region.expanded);
  const parents = territory.regions.filter((region) => region.expanded);
  const missing = territory.undrawn.length + territory.unreachable.length;
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
    return [
      region.work.title,
      region.work.kind === "attempt" ? "Attempt" : null,
      workStateLabels[region.work.state],
      state.currentWorkId === region.work.id ? "Current milestone" : null,
      region.childCount > 0
        ? `${region.childCount} ${region.childCount === 1 ? "part" : "parts"}, ${region.expanded ? "expanded" : "folded"}`
        : null,
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

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        role="group"
        aria-label="Work map"
        className="scrollbar-gutter-both min-h-0 flex-1 overflow-auto p-3"
      >
        <svg
          viewBox={`0 0 ${FIELD_WIDTH} ${FIELD_HEIGHT}`}
          className="mx-auto block h-auto max-h-full w-full"
          style={{ maxWidth: FIELD_WIDTH * 1.4 }}
        >
          <defs>
            <pattern
              id="quest-territory-hatch"
              width="7"
              height="7"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <line x1="0" y1="0" x2="0" y2="7" stroke="currentColor" strokeWidth="1.4" />
            </pattern>
            <marker
              id="quest-territory-arrow"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
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
                  className={regionFill[region.work.state]}
                  fill={uncertain ? "url(#quest-territory-hatch)" : undefined}
                  stroke={uncertain ? "none" : undefined}
                  strokeWidth={0.8}
                  opacity={region.work.kind === "attempt" ? 0.6 : 1}
                />
                <path
                  d={boundaryPath(region.cells)}
                  fill="none"
                  strokeWidth={isActive ? 2.5 : 1}
                  strokeDasharray={uncertain || region.work.kind === "attempt" ? "4 3" : undefined}
                  className={isActive ? "stroke-foreground" : "stroke-foreground/35"}
                />
              </g>
            );
          })}
          {parents.map((region) => (
            <path
              key={region.work.id}
              d={boundaryPath(region.cells)}
              fill="none"
              pointerEvents="none"
              strokeWidth={Math.max(1.5, 4 - region.depth)}
              className={
                state.currentWorkId === region.work.id
                  ? "stroke-info"
                  : active === region.work.id
                    ? "stroke-foreground"
                    : "stroke-foreground/60"
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
                strokeWidth={3}
                className="stroke-info"
              />
            ))}
          {links.map((link) => {
            const mx = (link.from.x + link.to.x) / 2;
            const my =
              (link.from.y + link.to.y) / 2 - Math.abs(link.to.x - link.from.x) * 0.15 - 12;
            return (
              <path
                key={link.id}
                data-link={link.type}
                d={`M ${link.from.x} ${link.from.y} Q ${mx} ${my} ${link.to.x} ${link.to.y}`}
                fill="none"
                pointerEvents="none"
                strokeWidth={2}
                strokeDasharray={
                  link.type === "retries" ? "6 4" : link.viaAncestor ? "2 3" : undefined
                }
                markerEnd="url(#quest-territory-arrow)"
                className="stroke-foreground"
              />
            );
          })}
          {leaves.map((region) => (
            <RegionLabel key={region.work.id} region={region} {...signals(region.work)} />
          ))}
          {parents.map((region) => {
            // Expanded regions name themselves at their top edge, clear of their parts' names.
            const title =
              region.work.title.length > 34
                ? `${region.work.title.slice(0, 33)}…`
                : region.work.title;
            return (
              <g key={region.work.id} {...interact(region)}>
                <text
                  x={region.crest.x}
                  y={Math.max(14, region.crest.y - 2)}
                  textAnchor="middle"
                  strokeWidth={4}
                  className={cn(
                    "text-2xs font-semibold tracking-wide uppercase [paint-order:stroke] stroke-background",
                    state.currentWorkId === region.work.id ? "fill-info" : "fill-foreground/80",
                  )}
                >
                  {title}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-4 py-1.5 text-2xs text-muted-foreground">
        <span>Filled: recorded state · hatched, dashed edge: planned or deferred scope</span>
        <span>Arrows: recorded order around the inspected region</span>
        <span>Area is not effort · double-click, arrow keys or the toolbar expand</span>
        {missing > 0 ? (
          <button type="button" className="ms-auto underline" onClick={onShowOutline}>
            {missing} not drawn here · Outline lists all work
          </button>
        ) : null}
      </div>
    </div>
  );
}

function RegionLabel({
  region,
  needsYou,
  working,
}: {
  region: Region;
  needsYou: boolean;
  working: boolean;
}) {
  const marks = `${needsYou ? "! " : ""}${working ? "● " : ""}`;
  const fits = Math.floor(region.span / 7.5) - marks.length;
  if (fits < 4) return null;
  const title =
    region.work.title.length > fits
      ? `${region.work.title.slice(0, fits - 1)}…`
      : region.work.title;
  return (
    <text
      x={region.anchor.x}
      y={region.anchor.y}
      textAnchor="middle"
      dominantBaseline="middle"
      pointerEvents="none"
      strokeWidth={3}
      className={cn(
        "text-xs [paint-order:stroke] stroke-background",
        isUncertain(region.work) ? "fill-muted-foreground" : "fill-foreground font-medium",
      )}
    >
      {needsYou ? <tspan className="fill-warning font-bold">! </tspan> : null}
      {working ? <tspan className="fill-info">● </tspan> : null}
      {title}
    </text>
  );
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

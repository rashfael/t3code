import { questQuestionStatus, type QuestWork } from "@t3tools/contracts";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  CrosshairIcon,
  MessageSquareIcon,
  MinusIcon,
  PlusIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent } from "react";

import { cn } from "~/lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { useQuest } from "./questContext";
import {
  edgePath,
  layoutWorkGraph,
  NODE_HEIGHT,
  NODE_WIDTH,
  type GraphEdge,
  type GraphNode,
} from "./questGraph";
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

const edgeStyles: Record<GraphEdge["kind"], { className: string; dash?: string; label: string }> = {
  part: { className: "text-border", label: "Part of" },
  follows: { className: "text-info", label: "Comes before" },
  retries: { className: "text-warning", dash: "6 4", label: "Retried by" },
};

const ZOOM_STEPS = [0.5, 0.67, 0.8, 1, 1.25] as const;

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
  const [layout, setLayout] = useState<"graph" | "outline">("graph");
  const focus = focusId ? (state.work.find((item) => item.id === focusId) ?? null) : null;
  const roots = focus ? [focus] : childrenOf(state, null);
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
            onClick={() => setLayout(layout === "graph" ? "outline" : "graph")}
          >
            Outline
          </Button>
        </div>
      </div>
      {layout === "graph" ? (
        <WorkGraphView
          rootIds={roots.map((item) => item.id)}
          expanded={expanded}
          onToggle={toggle}
          onFocus={focusOn}
          selectedId={selectedId}
          threads={threads}
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

function WorkGraphView({
  rootIds,
  expanded,
  onToggle,
  onFocus,
  selectedId,
  threads,
}: {
  rootIds: ReadonlyArray<string>;
  expanded: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onFocus: (id: string) => void;
  selectedId: string | null;
  threads: ReturnType<typeof useQuestConversationThreads>;
}) {
  const { state } = useQuest();
  const [zoom, setZoom] = useState(1);
  const viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const graph = layoutWorkGraph(state, expanded, rootIds);
  const nodes = new Map(graph.nodes.map((node) => [node.work.id, node]));
  const hasExample = graph.edges.some((edge) => edge.relation?.provenance === "example");
  const kinds = new Set(graph.edges.map((edge) => edge.kind));
  const reveal = selectedId ?? state.currentWorkId;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- scrolls the browser viewport to the work the map was opened for
  useEffect(() => {
    const element = viewport.current?.querySelector<HTMLElement>(`[data-work-id="${reveal}"]`);
    element?.scrollIntoView({ block: "center", inline: "center" });
  }, [reveal]);

  function zoomBy(step: 1 | -1) {
    const index = ZOOM_STEPS.findIndex((value) => value >= zoom);
    const next = ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, index + step))]!;
    setZoom(next);
  }

  function fit() {
    const element = viewport.current;
    if (!element) return;
    const scale = Math.min(
      1,
      element.clientWidth / graph.width,
      element.clientHeight / graph.height,
    );
    setZoom(Math.max(0.3, Math.floor(scale * 100) / 100));
  }

  function startPan(event: PointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest("button") || !viewport.current) return;
    drag.current = {
      x: event.clientX,
      y: event.clientY,
      left: viewport.current.scrollLeft,
      top: viewport.current.scrollTop,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function pan(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current || !viewport.current) return;
    viewport.current.scrollLeft = drag.current.left - (event.clientX - drag.current.x);
    viewport.current.scrollTop = drag.current.top - (event.clientY - drag.current.y);
  }

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={viewport}
        role="group"
        aria-label="Work map"
        className="absolute inset-0 cursor-grab overflow-auto active:cursor-grabbing"
        onPointerDown={startPan}
        onPointerMove={pan}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      >
        <div style={{ width: graph.width * zoom, height: graph.height * zoom }}>
          <div
            className="relative origin-top-left"
            style={{ width: graph.width, height: graph.height, transform: `scale(${zoom})` }}
          >
            <svg
              aria-hidden
              className="pointer-events-none absolute inset-0"
              width={graph.width}
              height={graph.height}
            >
              <defs>
                {(["follows", "retries"] as const).map((kind) => (
                  <marker
                    key={kind}
                    id={`quest-arrow-${kind}`}
                    viewBox="0 0 10 10"
                    refX="9"
                    refY="5"
                    markerWidth="7"
                    markerHeight="7"
                    orient="auto-start-reverse"
                    className={edgeStyles[kind].className}
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
                  </marker>
                ))}
              </defs>
              {graph.edges.map((edge) => {
                const source = nodes.get(edge.source);
                const target = nodes.get(edge.target);
                if (!source || !target) return null;
                const style = edgeStyles[edge.kind];
                const example = edge.relation?.provenance === "example";
                return (
                  <path
                    key={edge.id}
                    data-edge={edge.kind}
                    d={edgePath(source, target, edge.kind)}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={edge.kind === "part" ? 1.25 : 1.75}
                    strokeDasharray={example ? "2 4" : style.dash}
                    opacity={edge.viaAncestor ? 0.5 : 1}
                    markerEnd={edge.kind === "part" ? undefined : `url(#quest-arrow-${edge.kind})`}
                    className={style.className}
                  />
                );
              })}
            </svg>
            {graph.nodes.map((node) => (
              <GraphCard
                key={node.work.id}
                node={node}
                selected={selectedId === node.work.id}
                threads={threads}
                onToggle={onToggle}
                onFocus={onFocus}
              />
            ))}
          </div>
        </div>
      </div>
      <div className="pointer-events-none absolute inset-x-3 bottom-3 flex flex-wrap items-end justify-between gap-2">
        <ul
          aria-label="Map legend"
          className="pointer-events-auto flex flex-wrap gap-x-3 gap-y-1 rounded-md border bg-background/95 px-2.5 py-1.5 text-2xs text-muted-foreground"
        >
          {(["part", "follows", "retries"] as const)
            .filter((kind) => kind === "part" || kinds.has(kind))
            .map((kind) => (
              <li key={kind} className="flex items-center gap-1.5">
                <svg aria-hidden width="22" height="8" className={edgeStyles[kind].className}>
                  <line
                    x1="1"
                    y1="4"
                    x2="21"
                    y2="4"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeDasharray={edgeStyles[kind].dash}
                  />
                </svg>
                {edgeStyles[kind].label}
              </li>
            ))}
          {hasExample ? <li>Dotted: example link</li> : null}
          <li>Faded: via a collapsed item</li>
        </ul>
        <div
          role="toolbar"
          aria-label="Zoom"
          className="pointer-events-auto flex items-center gap-0.5 rounded-md border bg-background/95 p-0.5"
        >
          <Button size="icon-xs" variant="ghost" aria-label="Zoom out" onClick={() => zoomBy(-1)}>
            <MinusIcon />
          </Button>
          <span className="w-10 text-center text-2xs tabular-nums">{Math.round(zoom * 100)}%</span>
          <Button size="icon-xs" variant="ghost" aria-label="Zoom in" onClick={() => zoomBy(1)}>
            <PlusIcon />
          </Button>
          <Button size="xs" variant="ghost" onClick={fit}>
            Fit
          </Button>
        </div>
      </div>
    </div>
  );
}

function GraphCard({
  node,
  selected,
  threads,
  onToggle,
  onFocus,
}: {
  node: GraphNode;
  selected: boolean;
  threads: ReturnType<typeof useQuestConversationThreads>;
  onToggle: (id: string) => void;
  onFocus: (id: string) => void;
}) {
  const { state, openPanel } = useQuest();
  const { work } = node;
  const waiting = state.questions.filter((question) => {
    if (question.workId !== work.id) return false;
    const status = questQuestionStatus(question);
    return status === "open" || status === "recorded";
  });
  const conversations = state.conversations.filter((item) => item.workId === work.id);
  const running = conversations.filter((item) => {
    const thread = threads.get(item.threadId) ?? null;
    return conversationStatusLabel(thread) === "agent working";
  });
  const isCurrent = state.currentWorkId === work.id;
  return (
    <div
      data-work-id={work.id}
      className={cn(
        "absolute flex rounded-lg border bg-card text-left shadow-xs",
        work.kind === "attempt" && "border-dashed bg-background",
        isCurrent && "border-info",
        selected && "ring-2 ring-ring",
      )}
      style={{ left: node.x, top: node.y, width: NODE_WIDTH, height: NODE_HEIGHT }}
    >
      <button
        type="button"
        aria-label={`${work.title} · ${work.kind === "attempt" ? "Attempt · " : ""}${workStateLabels[work.state]}`}
        aria-pressed={selected}
        className="min-w-0 flex-1 rounded-s-lg px-2.5 py-1.5 text-left hover:bg-accent/50"
        onClick={() => openPanel({ type: "work", id: work.id })}
      >
        <span className="flex items-center gap-1.5 text-2xs text-muted-foreground">
          <span aria-hidden className={cn("size-2 shrink-0 rounded-full", stateDot[work.state])} />
          <span className="truncate">
            {work.kind === "attempt" ? "Attempt · " : ""}
            {workStateLabels[work.state]}
            {isCurrent ? " · Current" : ""}
          </span>
          {waiting.length > 0 ? (
            <Badge variant="warning" size="sm" className="ms-auto">
              {waiting.length} {waiting.length === 1 ? "decision" : "decisions"}
            </Badge>
          ) : null}
          {conversations.length > 0 ? (
            <span className={cn("flex items-center gap-0.5", waiting.length === 0 && "ms-auto")}>
              <MessageSquareIcon aria-hidden className="size-3" />
              {conversations.length}
              <span className="sr-only">
                linked {conversations.length === 1 ? "conversation" : "conversations"}
                {running.length ? `, ${running.length} agent working` : ""}
              </span>
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 line-clamp-2 text-xs font-medium leading-snug">{work.title}</span>
      </button>
      {node.childCount > 0 ? (
        <span className="flex flex-col border-s">
          <button
            type="button"
            className="flex flex-1 items-center gap-0.5 px-1.5 text-2xs text-muted-foreground hover:bg-accent"
            aria-label={`${node.expanded ? "Collapse" : "Expand"} ${work.title}`}
            aria-expanded={node.expanded}
            onClick={() => onToggle(work.id)}
          >
            {node.expanded ? (
              <MinusIcon aria-hidden className="size-3" />
            ) : (
              <>
                <PlusIcon aria-hidden className="size-3" />
                <span className="tabular-nums">{node.childCount}</span>
              </>
            )}
          </button>
          <button
            type="button"
            className="flex flex-1 items-center justify-center border-t px-1.5 text-muted-foreground hover:bg-accent"
            aria-label={`Focus on ${work.title}`}
            onClick={() => onFocus(work.id)}
          >
            <CrosshairIcon aria-hidden className="size-3" />
          </button>
        </span>
      ) : null}
    </div>
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

import { questQuestionStatus } from "@t3tools/contracts";
import { ChevronRightIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { useQuest } from "./questContext";
import {
  childrenOf,
  deliveryLeaves,
  describeCounts,
  questionStatusLabels,
  questionStatusOrder,
  questionsByStatus,
  reviewGroups,
  rootWork,
  workStateLabels,
  workStateVariants,
} from "./questModel";
import { HistoryEntryRow } from "./QuestPanel";

function Section({
  title,
  aside,
  className,
  children,
}: {
  title: string;
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={className}>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Row({
  title,
  detail,
  meta,
  onClick,
}: {
  title: string;
  detail?: string;
  meta?: ReactNode;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-start gap-3 border-b py-2 text-left hover:bg-accent/40"
      >
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-medium">{title}</span>
            {meta}
          </span>
          {detail ? (
            <span className="mt-0.5 line-clamp-1 block text-xs text-muted-foreground">
              {detail}
            </span>
          ) : null}
        </span>
        <ChevronRightIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      </button>
    </li>
  );
}

export function QuestOverview() {
  const { state, openPanel, showView } = useQuest();
  const current = state.work.find((item) => item.id === state.currentWorkId) ?? null;
  const decisions = questionsByStatus(state.questions);
  const roots = rootWork(state);
  const unresolved = state.work.filter(
    (item) => item.state === "attention" || (item.findings.trim() && item.state !== "done"),
  );
  const attempts = state.work.filter((item) => item.kind === "attempt");
  const waiting = state.questions.filter((question) => {
    const status = questQuestionStatus(question);
    return status === "open" || status === "recorded";
  });
  const reviews = reviewGroups(state);
  const waitingWork = new Set(waiting.map((question) => question.workId));
  const actionable = state.work.filter(
    (item) => item.state === "attention" && !waitingWork.has(item.id),
  );
  const decisionCounts = questionStatusOrder.filter((status) => decisions[status].length > 0);
  const recent = state.history.toReversed().slice(0, 4);
  return (
    <div className="mx-auto max-w-6xl px-6 py-5">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Section title="Current milestone">
          {current ? (
            <div className="rounded-lg border bg-card p-3.5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={workStateVariants[current.state]}>
                  {workStateLabels[current.state]}
                </Badge>
                <h3 className="text-base font-semibold">{current.title}</h3>
              </div>
              <p className="mt-1.5 line-clamp-3 whitespace-pre-wrap text-sm">
                {current.understanding}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                {describeCounts(deliveryLeaves(state, current.id))}
              </p>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => showView("map", { work: current.id })}
                >
                  Show in map
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => openPanel({ type: "work", id: current.id })}
                >
                  Details
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => showView("conversation", { about: `work:${current.id}` })}
                >
                  Discuss
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No current milestone. Set one from a work item’s details.
            </p>
          )}
        </Section>

        <Section title="Needs attention">
          {waiting.length + reviews.length + actionable.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing waiting.</p>
          ) : (
            <ul>
              {waiting.map((question) => {
                const status = questQuestionStatus(question);
                return (
                  <Row
                    key={question.id}
                    title={question.title}
                    detail={
                      status === "recorded"
                        ? `Recorded: ${question.answer ?? ""}`
                        : (state.work.find((item) => item.id === question.workId)?.title ?? "")
                    }
                    meta={
                      <>
                        <Badge variant="warning" size="sm">
                          {status === "recorded" ? "Ready to apply" : "Decision"}
                        </Badge>
                        {question.proposal ? (
                          <Badge variant="outline" size="sm">
                            Proposed
                          </Badge>
                        ) : null}
                      </>
                    }
                    onClick={() => openPanel({ type: "question", id: question.id })}
                  />
                );
              })}
              {actionable.map((item) => (
                <Row
                  key={item.id}
                  title={item.title}
                  detail={item.understanding}
                  meta={
                    <Badge variant="warning" size="sm">
                      {workStateLabels[item.state]}
                    </Badge>
                  }
                  onClick={() => openPanel({ type: "work", id: item.id })}
                />
              ))}
              {reviews.map(({ parent, items }) => (
                <Row
                  key={parent?.id ?? "root"}
                  title={parent ? parent.title : "Awaiting review"}
                  detail={items.map((item) => item.title).join(", ")}
                  meta={
                    <Badge variant="secondary" size="sm">
                      {items.length} to review
                    </Badge>
                  }
                  onClick={() =>
                    items.length === 1
                      ? openPanel({ type: "work", id: items[0]!.id })
                      : showView("map", { work: parent?.id ?? items[0]!.id })
                  }
                />
              ))}
            </ul>
          )}
        </Section>
      </div>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <Section
          title="Understanding"
          aside={
            decisionCounts.length > 0 ? (
              <button
                type="button"
                onClick={() => openPanel({ type: "decisions" })}
                className="text-xs text-muted-foreground hover:text-foreground hover:underline"
              >
                {decisionCounts
                  .map(
                    (status) =>
                      `${decisions[status].length} ${questionStatusLabels[status].toLowerCase()}`,
                  )
                  .join(" · ")}
              </button>
            ) : null
          }
        >
          {unresolved.length > 0 ? (
            <ul>
              {unresolved.map((item) => (
                <Row
                  key={item.id}
                  title={item.title}
                  detail={item.state === "attention" ? item.understanding : item.findings}
                  meta={
                    <Badge variant={workStateVariants[item.state]} size="sm">
                      {item.kind === "attempt" ? "Attempt · " : ""}
                      {workStateLabels[item.state]}
                    </Badge>
                  }
                  onClick={() => openPanel({ type: "work", id: item.id })}
                />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No open findings.</p>
          )}
        </Section>

        <Section
          title="Delivery"
          aside={
            attempts.length > 0 ? (
              <span className="text-xs text-muted-foreground">
                {attempts.length} earlier {attempts.length === 1 ? "attempt" : "attempts"}
              </span>
            ) : null
          }
        >
          <ul>
            {roots.flatMap((root) =>
              childrenOf(state, root.id)
                .filter((branch) => branch.kind === "work")
                .map((branch) => {
                  const leaves = deliveryLeaves(state, branch.id);
                  return (
                    <Row
                      key={branch.id}
                      title={branch.title}
                      detail={
                        leaves.length > 0 ? describeCounts(leaves) : workStateLabels[branch.state]
                      }
                      onClick={() => showView("map", { work: branch.id })}
                    />
                  );
                }),
            )}
          </ul>
        </Section>
      </div>

      <Section
        title="Recent changes"
        className="mt-6"
        aside={
          <Button size="xs" variant="ghost" onClick={() => openPanel({ type: "history" })}>
            All history
          </Button>
        }
      >
        <ul>
          {recent.map((entry) => (
            <HistoryEntryRow key={entry.id} entry={entry} />
          ))}
        </ul>
      </Section>
    </div>
  );
}

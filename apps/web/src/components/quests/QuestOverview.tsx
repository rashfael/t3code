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
  children,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mt-8 first:mt-0">
      <div className="mb-3 flex items-baseline justify-between gap-3">
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
        className="flex w-full items-start gap-3 border-b py-3 text-left hover:bg-accent/40"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{title}</span>
          {detail ? (
            <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
              {detail}
            </span>
          ) : null}
          {meta ? <span className="mt-1.5 flex flex-wrap gap-1.5">{meta}</span> : null}
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
  const recent = state.history.toReversed().slice(0, 4);
  return (
    <div className="mx-auto max-w-5xl px-6 py-6">
      <p className="mb-6 max-w-3xl text-sm text-muted-foreground">
        Reconstructed from captures of the market-tracking work records taken on 31 October 2026.
        Edits change these prototype records only; nothing here resumes the original work.
      </p>

      <Section title="Current milestone">
        {current ? (
          <div className="rounded-lg border bg-card p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={workStateVariants[current.state]}>
                {workStateLabels[current.state]}
              </Badge>
              <h3 className="text-base font-semibold">{current.title}</h3>
            </div>
            <p className="mt-2 max-w-3xl whitespace-pre-wrap text-sm">{current.understanding}</p>
            <p className="mt-3 text-xs text-muted-foreground">
              Parts: {describeCounts(deliveryLeaves(state, current.id))}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => showView("map", { work: current.id })}
              >
                Show in work map
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
            No current milestone is marked. Choose one from a work item’s details.
          </p>
        )}
      </Section>

      <div className="mt-8 grid gap-8 md:grid-cols-2">
        <Section title="Understanding">
          <p className="mb-3 text-xs text-muted-foreground">
            Decisions and open uncertainty. Recording an answer does not change work until it is
            applied.
          </p>
          <ul className="mb-4 flex flex-wrap gap-2" aria-label="Decisions by status">
            {(["open", "recorded", "deferred", "applied"] as const).map((status) => (
              <li key={status}>
                <button
                  type="button"
                  onClick={() => openPanel({ type: "decisions" })}
                  className="rounded-md border px-2.5 py-1.5 text-xs hover:bg-accent"
                >
                  <strong className="tabular-nums">{decisions[status].length}</strong>{" "}
                  {questionStatusLabels[status].toLowerCase()}
                </button>
              </li>
            ))}
          </ul>
          <h3 className="mb-1 text-xs font-medium text-muted-foreground">Unresolved</h3>
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
            <p className="text-sm text-muted-foreground">No unresolved findings are recorded.</p>
          )}
        </Section>

        <Section title="Delivery">
          <p className="mb-3 text-xs text-muted-foreground">
            Counts include only work without sub-parts. Attempts are kept as history and are not
            counted as progress.
          </p>
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
                        leaves.length > 0
                          ? describeCounts(leaves)
                          : `No parts · ${workStateLabels[branch.state].toLowerCase()}`
                      }
                      onClick={() => showView("map", { work: branch.id })}
                    />
                  );
                }),
            )}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">
            {attempts.length === 0
              ? "No earlier attempts are recorded."
              : `${attempts.length} earlier ${attempts.length === 1 ? "attempt is" : "attempts are"} retained in the work map.`}
          </p>
        </Section>
      </div>

      <Section title="Needs attention">
        {waiting.length + reviews.length + actionable.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing is waiting for a person.</p>
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
                      ? `Answer recorded: ${question.answer ?? ""}. Apply it or revise it.`
                      : question.context
                  }
                  meta={
                    <>
                      <Badge variant="warning" size="sm">
                        Decision · {questionStatusLabels[status].toLowerCase()}
                      </Badge>
                      {question.proposal ? (
                        <Badge variant="outline" size="sm">
                          Prototype proposal, not a live request
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
                title={`${items.length} awaiting review${parent ? ` · ${parent.title}` : ""}`}
                detail={items.map((item) => item.title).join(", ")}
                meta={
                  <Badge variant="secondary" size="sm">
                    Review obligation
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

      <Section
        title="Recent changes"
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

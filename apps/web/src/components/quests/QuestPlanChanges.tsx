import type {
  QuestContribution,
  QuestPlanProposal,
  QuestPlanStatus,
  QuestProvenance,
  QuestResultSource,
  QuestState,
} from "@t3tools/contracts";
import {
  questPlanEditChecks,
  questPlanEditSummary,
  type QuestPlanEditCheck,
} from "@t3tools/shared/questPlan";
import { ArrowLeftIcon, MessageSquareIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Textarea } from "../ui/textarea";
import { useQuest } from "./questContext";

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export const planStatusLabels: Record<QuestPlanStatus, string> = {
  proposed: "Proposed plan change",
  deferred: "Deferred plan change",
  declined: "Declined plan change",
  applied: "Applied plan change",
  superseded: "Superseded plan change",
  withdrawn: "Withdrawn plan change",
};

export const resultDispositionLabels: Record<QuestContribution["disposition"], string> = {
  open: "Not yet used in the plan",
  incorporated: "Used in the plan",
  superseded: "Replaced by a newer result",
  "set-aside": "Set aside",
};

const checkLabels: Record<QuestPlanEditCheck["status"], string> = {
  ready: "Ready",
  already: "Already in the plan",
  stale: "Changed since proposed",
  invalid: "Can't apply",
};

const checkVariants = {
  ready: "success",
  already: "outline",
  stale: "warning",
  invalid: "error",
} as const satisfies Record<QuestPlanEditCheck["status"], string>;

/** Which list group a record belongs to in Decisions. */
export function planGroups(state: QuestState) {
  return {
    proposals: state.proposals.filter(
      (item) => item.status === "proposed" || item.status === "deferred",
    ),
    decided: state.proposals.filter(
      (item) => item.status !== "proposed" && item.status !== "deferred",
    ),
    results: state.contributions.filter((item) => item.disposition === "open"),
    earlierResults: state.contributions.filter((item) => item.disposition !== "open"),
  };
}

function discussionName(state: QuestState, threadId: string): string {
  const conversation = state.conversations.find((item) => item.threadId === threadId);
  if (!conversation) return "a discussion no longer in the Quest";
  return conversation.role === "core"
    ? "the core conversation"
    : conversation.purpose || conversation.title;
}

function Origin({
  source,
  provenance,
  children,
}: {
  source: QuestResultSource | null;
  provenance: QuestProvenance;
  children?: ReactNode;
}) {
  const { state, showView } = useQuest();
  return (
    <p className="text-xs text-muted-foreground">
      {source ? (
        <>
          From{" "}
          <button
            type="button"
            className="cursor-pointer underline underline-offset-2"
            onClick={() => showView("conversation", { thread: source.threadId })}
          >
            {discussionName(state, source.threadId)}
          </button>
          {source.runId ? ` · run ${source.runId.slice(0, 12)}` : ""}
          {provenance === "observed"
            ? " · recorded by its agent"
            : " · attribution reported by a client"}
        </>
      ) : (
        "No discussion named"
      )}
      {children}
    </p>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-6">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Text({ children }: { children: string }) {
  return <p className="whitespace-pre-wrap text-sm leading-relaxed">{children}</p>;
}

function Frame({
  label,
  onBack,
  header,
  children,
  actions,
}: {
  label: string;
  onBack: (() => void) | null;
  header: ReactNode;
  children: ReactNode;
  actions: ReactNode;
}) {
  return (
    <article aria-label={label} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="scrollbar-gutter-both min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-5">
          {onBack ? (
            <Button size="sm" variant="ghost" className="-ms-2 mb-2" onClick={onBack}>
              <ArrowLeftIcon aria-hidden />
              Back to decisions
            </Button>
          ) : null}
          {header}
          {children}
        </div>
      </div>
      {actions}
    </article>
  );
}

function ResultLink({ id, onSelect }: { id: string; onSelect: (id: string) => void }) {
  const { state } = useQuest();
  const result = state.contributions.find((item) => item.id === id);
  return (
    <button
      type="button"
      className="cursor-pointer text-start underline underline-offset-2"
      onClick={() => onSelect(id)}
    >
      {result?.title ?? id}
    </button>
  );
}

export function ProposalWorkspace({
  proposal,
  onBack,
  onSelect,
}: {
  proposal: QuestPlanProposal;
  onBack: (() => void) | null;
  onSelect: (id: string) => void;
}) {
  const { state, canWrite, pending, save, showView } = useQuest();
  const open = proposal.status === "proposed" || proposal.status === "deferred";
  const initial = questPlanEditChecks(
    state,
    proposal.edits,
    new Set(proposal.edits.map((edit) => edit.id)),
  );
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () =>
      new Set(
        proposal.edits
          .filter((edit) => initial.get(edit.id)?.status === "ready")
          .map((edit) => edit.id),
      ),
  );
  const [note, setNote] = useState("");
  const checks = questPlanEditChecks(state, proposal.edits, selected);
  const blocked = [...selected].some((id) => {
    const status = checks.get(id)?.status;
    return status === "stale" || status === "invalid";
  });
  const appliedIds = proposal.decisions.findLast(
    (item) => item.status === "applied",
  )?.selectedEditIds;
  const successor =
    proposal.status === "superseded" || proposal.status === "withdrawn"
      ? proposal.decisions.at(-1)?.byProposalId
      : null;
  const withdrawal = proposal.status === "withdrawn" ? proposal.decisions.at(-1) : undefined;
  const needsRevision =
    open && proposal.edits.some((edit) => checks.get(edit.id)?.status === "stale");

  function toggle(id: string, checked: boolean) {
    const next = new Set(selected);
    if (checked) next.add(id);
    else next.delete(id);
    setSelected(next);
  }

  async function decide(decision: "apply" | "defer" | "decline" | "reopen") {
    const saved = await save({
      type: "plan-decide",
      proposalId: proposal.id,
      decision,
      selectedEditIds:
        decision === "apply"
          ? proposal.edits.flatMap((edit) => (selected.has(edit.id) ? [edit.id] : []))
          : [],
      note,
    });
    if (saved) setNote("");
  }

  return (
    <Frame
      label={proposal.title}
      onBack={onBack}
      header={
        <>
          <p className="text-xs text-muted-foreground">
            {planStatusLabels[proposal.status]} · based on revision {proposal.baseRevision}
          </p>
          <h2 className="mt-1 text-xl font-semibold">{proposal.title}</h2>
          <div className="mt-1">
            <Origin source={proposal.source} provenance={proposal.provenance}>
              {" · "}
              {dateFormat.format(new Date(proposal.proposedAt))}
            </Origin>
          </div>
          {proposal.rationale ? (
            <div className="mt-3">
              <Text>{proposal.rationale}</Text>
            </div>
          ) : null}
        </>
      }
      actions={
        canWrite ? (
          <div className="shrink-0 border-t bg-background">
            <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-2 px-6 py-3">
              {open ? (
                <>
                  <Textarea
                    aria-label="Note"
                    placeholder="Note (optional)"
                    rows={1}
                    className="min-w-48 flex-1"
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                  />
                  <Button
                    disabled={pending || selected.size === 0 || blocked}
                    onClick={() => void decide("apply")}
                  >
                    Apply {selected.size} of {proposal.edits.length}
                  </Button>
                  {proposal.status === "proposed" ? (
                    <Button
                      variant="outline"
                      disabled={pending}
                      onClick={() => void decide("defer")}
                    >
                      Defer
                    </Button>
                  ) : null}
                  <Button variant="ghost" disabled={pending} onClick={() => void decide("decline")}>
                    Decline
                  </Button>
                </>
              ) : proposal.status === "declined" ? (
                <Button variant="outline" disabled={pending} onClick={() => void decide("reopen")}>
                  Reopen
                </Button>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {proposal.status === "applied"
                    ? "Applied changes stay in the plan. A later proposal can change them again."
                    : proposal.status === "withdrawn"
                      ? "Withdrawn by the discussion that proposed it. Only that discussion can restore it."
                      : "Superseded proposals stay as they were proposed."}
                </p>
              )}
            </div>
          </div>
        ) : (
          <p className="shrink-0 border-t px-6 py-3 text-xs text-muted-foreground">Read only</p>
        )
      }
    >
      {proposal.contributionIds.length > 0 ? (
        <Section title="Uses results">
          <ul className="grid gap-1 text-sm">
            {proposal.contributionIds.map((id) => {
              const result = state.contributions.find((item) => item.id === id);
              return (
                <li key={id} className="flex flex-wrap items-baseline gap-x-2">
                  <ResultLink id={id} onSelect={onSelect} />
                  {result ? (
                    <span className="text-xs text-muted-foreground">
                      {resultDispositionLabels[result.disposition]}
                      {result.source ? ` · ${discussionName(state, result.source.threadId)}` : ""}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Section>
      ) : null}
      <Section title={open ? "Changes to the plan" : "Proposed changes"}>
        <ul className="grid gap-2">
          {proposal.edits.map((edit) => {
            const summary = questPlanEditSummary(state, edit);
            const check = checks.get(edit.id);
            const applied = appliedIds?.includes(edit.id);
            return (
              <li key={edit.id} className="rounded-lg border p-3 text-sm">
                <div className="flex items-start gap-2">
                  {open && canWrite ? (
                    <Checkbox
                      aria-label={`Apply: ${summary.label}`}
                      className="mt-0.5"
                      checked={selected.has(edit.id)}
                      disabled={pending}
                      onCheckedChange={(checked) => toggle(edit.id, checked === true)}
                    />
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{summary.label}</p>
                    {summary.before !== null ? (
                      <p className="mt-1 whitespace-pre-wrap break-words text-muted-foreground line-through decoration-muted-foreground/50">
                        {summary.before}
                      </p>
                    ) : null}
                    {summary.after !== null ? (
                      <p className="mt-1 whitespace-pre-wrap break-words">{summary.after}</p>
                    ) : null}
                    {open && check && check.detail ? (
                      <p className="mt-1 text-xs text-muted-foreground">{check.detail}</p>
                    ) : null}
                  </div>
                  {open && check ? (
                    <Badge variant={checkVariants[check.status]} size="sm">
                      {checkLabels[check.status]}
                    </Badge>
                  ) : applied !== undefined ? (
                    <Badge variant={applied ? "success" : "outline"} size="sm">
                      {applied ? "Applied" : "Not applied"}
                    </Badge>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
        {needsRevision ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>Part of the plan changed since this was proposed.</span>
            {proposal.source ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => showView("conversation", { thread: proposal.source!.threadId })}
              >
                <MessageSquareIcon aria-hidden />
                Ask for a revision
              </Button>
            ) : null}
          </div>
        ) : null}
      </Section>
      {withdrawal ? (
        <p className="mt-4 text-sm">
          Withdrawn by its author{withdrawal.note ? `: ${withdrawal.note}` : "."}
        </p>
      ) : null}
      {successor ? (
        <p className="mt-4 text-sm">
          {withdrawal ? "In favour of" : "Replaced by"}{" "}
          <button
            type="button"
            className="cursor-pointer underline underline-offset-2"
            onClick={() => onSelect(successor)}
          >
            {state.proposals.find((item) => item.id === successor)?.title ?? successor}
          </button>
        </p>
      ) : null}
      {proposal.supersedes ? (
        <p className="mt-4 text-sm">
          Replaces{" "}
          <button
            type="button"
            className="cursor-pointer underline underline-offset-2"
            onClick={() => onSelect(proposal.supersedes!)}
          >
            {state.proposals.find((item) => item.id === proposal.supersedes)?.title ??
              proposal.supersedes}
          </button>
        </p>
      ) : null}
      {proposal.decisions.length > 0 ? (
        <Section title={`Decisions · ${proposal.decisions.length}`}>
          <ul className="grid gap-1 text-sm">
            {proposal.decisions.toReversed().map((item) => (
              <li key={`${item.revision}-${item.status}`}>
                <span className="text-muted-foreground">
                  {dateFormat.format(new Date(item.at))} · revision {item.revision} ·{" "}
                </span>
                {planStatusLabels[item.status]}
                {item.status === "applied" ? ` (${item.selectedEditIds.length} changes)` : ""}
                {item.note ? <span className="text-muted-foreground"> · {item.note}</span> : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </Frame>
  );
}

export function ResultWorkspace({
  result,
  onBack,
  onSelect,
}: {
  result: QuestContribution;
  onBack: (() => void) | null;
  onSelect: (id: string) => void;
}) {
  const { state, canWrite, pending, save, openPanel, openDocument } = useQuest();
  const [note, setNote] = useState("");
  const title = (id: string) => state.work.find((item) => item.id === id)?.title ?? id;
  const usedBy = state.proposals.filter((item) => item.contributionIds.includes(result.id));
  const by = result.dispositionBy;
  const changeable = result.disposition === "open" || result.disposition === "set-aside";

  async function dispose(disposition: "open" | "set-aside") {
    const saved = await save({
      type: "contribution-dispose",
      contributionId: result.id,
      disposition,
      note,
    });
    if (saved) setNote("");
  }

  const workButton = (id: string) => (
    <button
      key={id}
      type="button"
      className="cursor-pointer text-start underline underline-offset-2"
      onClick={() => openPanel({ type: "work", id })}
    >
      {title(id)}
    </button>
  );

  return (
    <Frame
      label={result.title}
      onBack={onBack}
      header={
        <>
          <p className="text-xs text-muted-foreground">
            Result · {resultDispositionLabels[result.disposition]}
          </p>
          <h2 className="mt-1 text-xl font-semibold">{result.title}</h2>
          <div className="mt-1">
            <Origin source={result.source} provenance={result.provenance}>
              {" · "}
              {dateFormat.format(new Date(result.recordedAt))} · revision {result.recordedRevision}
              {result.contextRevision !== null
                ? ` · worked from revision ${result.contextRevision}`
                : ""}
            </Origin>
          </div>
          <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
            {result.workId ? (
              <>
                <dt className="text-muted-foreground">For</dt>
                <dd>{workButton(result.workId)}</dd>
              </>
            ) : null}
            {result.affectedWorkIds.length > 0 ? (
              <>
                <dt className="text-muted-foreground">Affects</dt>
                <dd className="flex flex-wrap gap-x-3 gap-y-1">
                  {result.affectedWorkIds.map(workButton)}
                </dd>
              </>
            ) : null}
          </dl>
          <div className="mt-4">
            <Text>{result.summary}</Text>
          </div>
        </>
      }
      actions={
        canWrite && changeable ? (
          <div className="shrink-0 border-t bg-background">
            <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-2 px-6 py-3">
              <Textarea
                aria-label="Note"
                placeholder="Note (optional)"
                rows={1}
                className="min-w-48 flex-1"
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
              {result.disposition === "open" ? (
                <Button
                  variant="outline"
                  disabled={pending}
                  onClick={() => void dispose("set-aside")}
                >
                  Set aside
                </Button>
              ) : (
                <Button variant="outline" disabled={pending} onClick={() => void dispose("open")}>
                  Reopen
                </Button>
              )}
            </div>
          </div>
        ) : null
      }
    >
      {result.candidate ? (
        <Section title="Candidate">
          <Text>{result.candidate}</Text>
        </Section>
      ) : null}
      {result.evidence.length > 0 ? (
        <Section title="Evidence">
          <ul className="grid gap-1 text-sm">
            {result.evidence.map((item) => (
              <li key={`${item.kind}:${item.ref}`}>
                <span className="text-muted-foreground">{item.kind} </span>
                <code className="break-all">{item.ref}</code>
                {item.note ? <span className="text-muted-foreground"> · {item.note}</span> : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      {result.limitations ? (
        <Section title="Limitations">
          <Text>{result.limitations}</Text>
        </Section>
      ) : null}
      {result.openQuestions ? (
        <Section title="Open questions">
          <Text>{result.openQuestions}</Text>
        </Section>
      ) : null}
      {result.sources.length > 0 ? (
        <Section title="Sources its discussion pinned">
          <ul className="grid gap-1 text-sm">
            {result.sources.map((pin) => (
              <li key={pin.documentId}>
                <button
                  type="button"
                  className="cursor-pointer underline underline-offset-2"
                  onClick={() => openDocument(pin.documentId)}
                >
                  {pin.path ?? pin.documentId}
                </button>
                <span className="text-muted-foreground">
                  {pin.sha256 ? ` · sha256 ${pin.sha256.slice(0, 12)}` : ` · ${pin.unavailable}`}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      {by || usedBy.length > 0 || result.supersedes ? (
        <Section title="In the plan">
          <ul className="grid gap-1 text-sm">
            {usedBy.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="cursor-pointer underline underline-offset-2"
                  onClick={() => onSelect(item.id)}
                >
                  {item.title}
                </button>
                <span className="text-muted-foreground"> · {planStatusLabels[item.status]}</span>
              </li>
            ))}
            {result.supersedes ? (
              <li>
                Replaces <ResultLink id={result.supersedes} onSelect={onSelect} />
              </li>
            ) : null}
            {by?.contributionId ? (
              <li>
                Replaced by <ResultLink id={by.contributionId} onSelect={onSelect} />
              </li>
            ) : null}
            {by && !by.proposalId && !by.contributionId ? (
              <li className="text-muted-foreground">
                {resultDispositionLabels[result.disposition]} in revision {by.revision}
                {by.note ? ` · ${by.note}` : ""}
              </li>
            ) : null}
          </ul>
        </Section>
      ) : null}
    </Frame>
  );
}

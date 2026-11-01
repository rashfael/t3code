import {
  questAppliedUnderstanding,
  questQuestionStatus,
  type QuestHistoryEntry,
  type QuestQuestion,
  type QuestQuestionStatus,
} from "@t3tools/contracts";
import { ArrowLeftIcon, ChevronRightIcon, MessageSquareIcon, PlusIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { useMediaQuery } from "~/hooks/useMediaQuery";
import { cn } from "~/lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { useQuest } from "./questContext";
import { QuestSelect } from "./QuestConversations";
import {
  draftText,
  rememberQuestDecision,
  useQuestDraft,
  useRememberedQuestDecision,
} from "./questDraftStore";
import { QuestionEditor } from "./QuestEditors";
import { questionsByStatus } from "./questModel";

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

const statusLabels: Record<QuestQuestionStatus, string> = {
  open: "To answer",
  recorded: "To apply",
  deferred: "Deferred",
  applied: "Applied",
};

function addedText(before: string, after: string): string {
  return after.startsWith(before) ? after.slice(before.length).trim() : after;
}

/** The text a list row shows under a question: what is decided so far, else what it affects. */
function rowPreview(question: QuestQuestion, workTitle: string | undefined): string {
  switch (questQuestionStatus(question)) {
    case "open":
      return workTitle ?? "Work no longer in the Quest";
    case "deferred":
      return question.rationale || question.answer || "No reason recorded";
    default:
      return question.answer ?? "";
  }
}

/** Decisions: a compact question list beside the selected question's working area. */
export function QuestDecisions({ requested }: { requested: string | null }) {
  const { environmentId, state, showView } = useQuest();
  const remembered = useRememberedQuestDecision(environmentId);
  // Below lg the app sidebar leaves too little room for a list beside the question.
  const narrow = useMediaQuery("max-lg");
  const groups = questionsByStatus(state.questions);
  const exists = (id: string | null) => state.questions.some((item) => item.id === id);
  const chosen = exists(requested) ? requested : exists(remembered) ? remembered : null;
  const fallback = narrow ? null : (groups.open[0] ?? groups.recorded[0] ?? state.questions[0])?.id;
  const selectedId = chosen ?? fallback ?? null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- records the shown decision in the Quest store so returning to Decisions reopens it
  useEffect(() => {
    if (chosen) rememberQuestDecision(environmentId, chosen);
  }, [environmentId, chosen]);

  function select(id: string | null) {
    rememberQuestDecision(environmentId, id);
    showView("decisions", id ? { question: id } : {});
  }

  const showList = !narrow || selectedId === null;
  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      {showList ? (
        <nav
          aria-label="Decisions"
          className={cn(
            "flex w-72 shrink-0 flex-col gap-4 overflow-y-auto border-r p-3",
            narrow && "w-full border-r-0",
          )}
        >
          <DecisionGroup
            title="To answer"
            questions={groups.open}
            selectedId={selectedId}
            onSelect={select}
          />
          <DecisionGroup
            title="To apply"
            questions={groups.recorded}
            selectedId={selectedId}
            onSelect={select}
          />
          {groups.open.length + groups.recorded.length === 0 ? (
            <p className="px-2 text-sm text-muted-foreground">Nothing waiting for you.</p>
          ) : null}
          <DecisionGroup
            title="Deferred"
            questions={groups.deferred}
            selectedId={selectedId}
            onSelect={select}
            collapsible
          />
          <DecisionGroup
            title="Applied"
            questions={groups.applied}
            selectedId={selectedId}
            onSelect={select}
            collapsible
          />
        </nav>
      ) : null}
      {selectedId !== null ? (
        <QuestionWorkspace
          key={selectedId}
          id={selectedId}
          onBack={narrow ? () => select(null) : null}
        />
      ) : narrow ? null : (
        <p className="p-6 text-sm text-muted-foreground">No decisions in this Quest.</p>
      )}
    </div>
  );
}

function DecisionGroup({
  title,
  questions,
  selectedId,
  onSelect,
  collapsible = false,
}: {
  title: string;
  questions: ReadonlyArray<QuestQuestion>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  collapsible?: boolean;
}) {
  const { state } = useQuest();
  const holdsSelection = questions.some((question) => question.id === selectedId);
  const [open, setOpen] = useState(!collapsible || holdsSelection);
  if (questions.length === 0) return null;
  const expanded = open || holdsSelection;
  return (
    <section aria-label={title}>
      {collapsible ? (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setOpen(!expanded)}
          className="mb-1 flex w-full cursor-pointer items-center gap-1 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
        >
          <ChevronRightIcon
            aria-hidden
            className={cn("size-3 transition-transform", expanded && "rotate-90")}
          />
          {title} · {questions.length}
        </button>
      ) : (
        <h3 className="mb-1 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title} · {questions.length}
        </h3>
      )}
      {expanded ? (
        <ul>
          {questions.map((question) => {
            const isSelected = question.id === selectedId;
            const work = state.work.find((item) => item.id === question.workId);
            return (
              <li key={question.id}>
                <button
                  type="button"
                  aria-current={isSelected ? "page" : undefined}
                  onClick={() => onSelect(question.id)}
                  className={cn(
                    "w-full cursor-pointer rounded px-2 py-1.5 text-left text-sm hover:bg-accent",
                    isSelected && "bg-accent",
                  )}
                >
                  <span className="block">
                    {question.title}
                    {question.proposal ? (
                      <Badge className="ms-1.5" variant="outline" size="sm">
                        Proposed
                      </Badge>
                    ) : null}
                  </span>
                  <span className="line-clamp-2 text-xs text-muted-foreground">
                    {rowPreview(question, work?.title)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
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

function QuestionWorkspace({ id, onBack }: { id: string; onBack: (() => void) | null }) {
  const { environmentId, state, canWrite, pending, openPanel, showView, openDocument } = useQuest();
  const question = state.questions.find((item) => item.id === id);
  const draft = useQuestDraft(environmentId, `question:${id}`);
  const [editingQuestion, setEditingQuestion] = useState(false);
  if (!question)
    return (
      <p className="p-6 text-sm text-muted-foreground">This decision is no longer in the Quest.</p>
    );
  const status = questQuestionStatus(question);
  const work = state.work.find((item) => item.id === question.workId);
  const discussions = state.conversations.filter(
    (item) =>
      item.questionId === question.id || (item.workId !== null && item.workId === question.workId),
  );
  const ownDiscussions = state.conversations.filter(
    (item) => item.role === "focused" && item.questionId === question.id,
  );
  const sources = [
    ...state.files
      .filter((file) => work?.documentIds.includes(file.id))
      .map((file) => ({ id: file.id, title: file.title })),
    ...state.documents
      .filter((doc) => work?.documentIds.includes(doc.id))
      .map((doc) => ({ id: doc.id, title: doc.title })),
  ];
  const record = state.history.filter((entry) => entry.targetId === question.id);
  const lastApply = record.findLast((entry) => entry.kind === "apply") ?? null;
  // An open question always answers here; the other states show their saved content until revised.
  const answering = status === "open" || (status !== "applied" && draft.draft !== undefined);

  function discuss() {
    // Resume the newest discussion of this question; otherwise prepare a new one. Nothing is sent.
    const latest = ownDiscussions.at(-1);
    if (latest) showView("conversation", { thread: latest.threadId });
    else showView("conversation", { about: `question:${id}` });
  }

  return (
    <article aria-label={question.title} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="scrollbar-gutter-both min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-5">
          {onBack ? (
            <Button size="sm" variant="ghost" className="-ms-2 mb-2" onClick={onBack}>
              <ArrowLeftIcon aria-hidden />
              Back to decisions
            </Button>
          ) : null}
          <div className="flex flex-wrap items-start gap-2">
            <div className="min-w-64 flex-1">
              <p className="text-xs text-muted-foreground">
                {statusLabels[status]}
                {work ? (
                  <>
                    {" · "}
                    <button
                      type="button"
                      className="cursor-pointer underline-offset-2 hover:underline"
                      onClick={() => openPanel({ type: "work", id: work.id })}
                    >
                      {work.title}
                    </button>
                  </>
                ) : (
                  " · Work no longer in the Quest"
                )}
              </p>
              <h2 className="mt-1 text-xl font-semibold">{question.title}</h2>
            </div>
            <div className="flex shrink-0 gap-1">
              <Button size="sm" variant="outline" onClick={discuss}>
                <MessageSquareIcon aria-hidden />
                Discuss
              </Button>
              {canWrite && status !== "applied" && !editingQuestion ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => setEditingQuestion(true)}
                >
                  Edit question
                </Button>
              ) : null}
            </div>
          </div>
          {editingQuestion ? (
            <div className="mt-4">
              <QuestionEditor question={question} onDone={() => setEditingQuestion(false)} />
            </div>
          ) : question.context ? (
            <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">{question.context}</p>
          ) : null}
          {sources.length > 0 || discussions.length > 0 ? (
            <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
              {sources.length > 0 ? (
                <>
                  <dt className="text-muted-foreground">Sources</dt>
                  <dd className="flex flex-wrap gap-x-3 gap-y-1">
                    {sources.map((doc) => (
                      <button
                        key={doc.id}
                        type="button"
                        className="cursor-pointer text-start underline underline-offset-2"
                        onClick={() => openDocument(doc.id)}
                      >
                        {doc.title}
                      </button>
                    ))}
                  </dd>
                </>
              ) : null}
              {discussions.length > 0 ? (
                <>
                  <dt className="text-muted-foreground">Discussions</dt>
                  <dd className="flex flex-wrap gap-x-3 gap-y-1">
                    {discussions.map((item) => (
                      <button
                        key={item.threadId}
                        type="button"
                        className="cursor-pointer text-start underline underline-offset-2"
                        onClick={() => showView("conversation", { thread: item.threadId })}
                      >
                        {item.role === "core" ? "Coordinate the Quest" : item.purpose || item.title}
                      </button>
                    ))}
                  </dd>
                </>
              ) : null}
            </dl>
          ) : null}

          {answering ? (
            <AnswerEditor question={question} discussions={discussions} />
          ) : status === "recorded" ? (
            <RecordedAnswer question={question} />
          ) : status === "deferred" ? (
            <Section title="Deferred">
              <SavedAnswer question={question} reasonFirst />
            </Section>
          ) : (
            <Section title="Applied">
              <SavedAnswer question={question} />
              <AppliedChange entry={lastApply} />
            </Section>
          )}
          {status !== "applied" && question.appliedRevision !== null ? (
            <Section title="Earlier application">
              <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                <p>
                  Applied in revision {question.appliedRevision}, before reopening. That text
                  remains in the work.
                </p>
                <AppliedChange entry={lastApply} />
              </div>
            </Section>
          ) : null}
          <EarlierDecisions question={question} record={record} />
        </div>
      </div>
      {canWrite ? (
        <DecisionActions question={question} answering={answering} />
      ) : (
        <p className="shrink-0 border-t px-6 py-3 text-xs text-muted-foreground">Read only</p>
      )}
    </article>
  );
}

function SourceLink({ question }: { question: QuestQuestion }) {
  const { state, showView } = useQuest();
  if (!question.answerSource) return null;
  const conversation = state.conversations.find(
    (item) => item.threadId === question.answerSource?.threadId,
  );
  return (
    <p className="mt-2 text-xs text-muted-foreground">
      From{" "}
      <button
        type="button"
        className="cursor-pointer underline"
        onClick={() => showView("conversation", { thread: question.answerSource!.threadId })}
      >
        {conversation?.purpose || conversation?.title || "a conversation no longer in the Quest"}
      </button>
      {question.answerSource.runId ? ` · run ${question.answerSource.runId.slice(0, 8)}` : ""}
    </p>
  );
}

function SavedAnswer({
  question,
  reasonFirst = false,
}: {
  question: QuestQuestion;
  reasonFirst?: boolean;
}) {
  const reason = question.rationale ? (
    <p className="whitespace-pre-wrap text-sm">
      <span className="text-muted-foreground">Why: </span>
      {question.rationale}
    </p>
  ) : null;
  const answer = question.answer ? (
    <p className="whitespace-pre-wrap text-base">{question.answer}</p>
  ) : (
    <p className="text-sm text-muted-foreground">No answer retained.</p>
  );
  return (
    <div className="grid gap-2 rounded-lg border bg-muted/20 p-4">
      {reasonFirst
        ? (reason ?? <p className="text-sm text-muted-foreground">No reason recorded.</p>)
        : answer}
      {reasonFirst ? answer : reason}
      <SourceLink question={question} />
    </div>
  );
}

function RecordedAnswer({ question }: { question: QuestQuestion }) {
  const { state } = useQuest();
  const work = state.work.find((item) => item.id === question.workId);
  const preview = work ? questAppliedUnderstanding(work, question) : null;
  return (
    <>
      <Section title="Recorded answer">
        <SavedAnswer question={question} />
      </Section>
      <Section title={work ? `Change to ${work.title}` : "Change to work"}>
        {work && preview ? (
          <pre className="whitespace-pre-wrap rounded-lg border bg-success/8 p-3 font-sans text-sm">
            + {addedText(work.understanding, preview)}
          </pre>
        ) : (
          <p className="text-sm text-muted-foreground">
            The affected work is no longer in the Quest, so this answer cannot be applied.
          </p>
        )}
      </Section>
    </>
  );
}

function AppliedChange({ entry }: { entry: QuestHistoryEntry | null }) {
  const change = entry?.changes[0];
  if (!change)
    return <p className="mt-2 text-xs text-muted-foreground">Applied before history began.</p>;
  return (
    <pre className="mt-2 whitespace-pre-wrap rounded border bg-success/8 p-2 font-sans text-xs">
      + {addedText(change.before ?? "", change.after ?? "")}
    </pre>
  );
}

/** One input for the answer: choose an alternative, edit its wording, or write another. */
function AnswerEditor({
  question,
  discussions,
}: {
  question: QuestQuestion;
  discussions: ReadonlyArray<{
    threadId: string;
    purpose: string;
    title: string;
    role: string;
    questionId: string | null;
  }>;
}) {
  const { environmentId, canWrite, pending } = useQuest();
  const draft = useQuestDraft(environmentId, `question:${question.id}`);
  const answer = draftText(draft.draft, "answer", question.answer ?? "");
  const rationale = draftText(draft.draft, "rationale", question.rationale ?? "");
  const writing =
    draftText(draft.draft, "writing", "") === "1" ||
    question.alternatives.length === 0 ||
    (answer.trim() !== "" && !question.alternatives.includes(answer));
  const reasonOpen = draftText(draft.draft, "reasonOpen", "") === "1" || rationale !== "";
  const savedSource = question.answerSource;
  const source = draftText(
    draft.draft,
    "source",
    savedSource?.threadId ??
      (question.answer === null
        ? (discussions.findLast((item) => item.questionId === question.id)?.threadId ?? "")
        : ""),
  );
  const detachedSource =
    savedSource && !discussions.some((item) => item.threadId === savedSource.threadId)
      ? savedSource
      : null;
  const disabled = pending || !canWrite;
  const optionClass = (isSelected: boolean) =>
    cn(
      "flex w-full cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
      isSelected ? "border-primary/60 bg-accent text-foreground" : "hover:bg-muted/40",
      disabled && "cursor-not-allowed opacity-60",
    );
  return (
    <Section title="Your answer">
      <div className="grid gap-2">
        {question.alternatives.map((alternative) => {
          const isSelected = !writing && answer === alternative;
          return (
            <div key={alternative}>
              <button
                type="button"
                aria-pressed={isSelected}
                disabled={disabled}
                className={optionClass(isSelected)}
                onClick={() => draft.update({ answer: alternative, writing: "" })}
              >
                <OptionMark checked={isSelected} />
                <span className="min-w-0 flex-1 whitespace-pre-wrap">{alternative}</span>
              </button>
              {isSelected ? (
                <Button
                  size="xs"
                  variant="ghost"
                  className="ms-8 mt-1"
                  disabled={disabled}
                  onClick={() => draft.update({ writing: "1" })}
                >
                  Edit wording
                </Button>
              ) : null}
            </div>
          );
        })}
        {question.alternatives.length > 0 ? (
          <button
            type="button"
            aria-pressed={writing}
            disabled={disabled}
            className={optionClass(writing)}
            onClick={() =>
              draft.update({
                writing: "1",
                answer: question.alternatives.includes(answer) ? "" : answer,
              })
            }
          >
            <OptionMark checked={writing} />
            <span className="min-w-0 flex-1">Write another answer</span>
          </button>
        ) : null}
        {writing ? (
          <Textarea
            aria-label="Answer"
            autoFocus={question.alternatives.length > 0}
            disabled={disabled}
            value={answer}
            onChange={(event) => draft.update({ answer: event.target.value, writing: "1" })}
            rows={4}
          />
        ) : null}
      </div>
      <div className="mt-4">
        {reasonOpen ? (
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium">Why (optional)</span>
            <Textarea
              disabled={disabled}
              value={rationale}
              onChange={(event) => draft.update({ rationale: event.target.value, reasonOpen: "1" })}
              rows={3}
            />
          </label>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={() => draft.update({ reasonOpen: "1" })}
          >
            <PlusIcon aria-hidden />
            Add why
          </Button>
        )}
      </div>
      {discussions.length > 0 || detachedSource ? (
        <div className="mt-4 flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">From</span>
          <QuestSelect
            label="Answer from conversation"
            value={source}
            onChange={(value) => draft.update({ source: value })}
            options={[
              { value: "", label: "Not from a conversation" },
              ...(detachedSource
                ? [
                    {
                      value: detachedSource.threadId,
                      label: "A conversation no longer in the Quest",
                    },
                  ]
                : []),
              ...discussions.map((item) => ({
                value: item.threadId,
                label: item.role === "core" ? "Coordinate the Quest" : item.purpose || item.title,
              })),
            ]}
          />
        </div>
      ) : null}
    </Section>
  );
}

// The look of ui/radio-group without its keyboard model, as the composer's question panel does.
function OptionMark({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full border border-input bg-background dark:bg-input/32",
        checked ? "shadow-none" : "shadow-xs/5",
      )}
    >
      {checked ? (
        <span className="-inset-px absolute flex items-center justify-center rounded-full bg-primary before:size-1.5 before:rounded-full before:bg-primary-foreground" />
      ) : null}
    </span>
  );
}

/** The decision's primary actions, kept in view below its content. */
function DecisionActions({ question, answering }: { question: QuestQuestion; answering: boolean }) {
  const { environmentId, state, pending, save } = useQuest();
  const draft = useQuestDraft(environmentId, `question:${question.id}`);
  const status = questQuestionStatus(question);
  const work = state.work.find((item) => item.id === question.workId);
  const discussions = state.conversations.filter(
    (item) =>
      item.questionId === question.id || (item.workId !== null && item.workId === question.workId),
  );
  const answer = draftText(draft.draft, "answer", question.answer ?? "");
  const rationale = draftText(draft.draft, "rationale", question.rationale ?? "");
  const savedSource = question.answerSource;
  const source = draftText(
    draft.draft,
    "source",
    savedSource?.threadId ??
      (question.answer === null
        ? (discussions.findLast((item) => item.questionId === question.id)?.threadId ?? "")
        : ""),
  );

  async function saveAnswer(deferred: boolean) {
    const saved = await save(
      {
        type: "answer",
        questionId: question.id,
        answer: deferred ? answer || null : answer,
        rationale: rationale || null,
        deferred,
      },
      savedSource?.threadId === source
        ? savedSource
        : source
          ? { threadId: source, runId: null }
          : undefined,
    );
    if (saved) draft.clear();
  }

  return (
    <div className="shrink-0 border-t bg-background">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-2 px-6 py-3">
        {answering ? (
          <>
            <Button disabled={pending || !answer.trim()} onClick={() => void saveAnswer(false)}>
              {status === "recorded" ? "Record changes" : "Record answer"}
            </Button>
            <Button variant="outline" disabled={pending} onClick={() => void saveAnswer(true)}>
              Defer
            </Button>
            {status !== "open" ? (
              <Button variant="ghost" disabled={pending} onClick={draft.clear}>
                Cancel
              </Button>
            ) : null}
          </>
        ) : status === "recorded" ? (
          <>
            <Button
              disabled={pending || !work}
              onClick={() => void save({ type: "apply", questionId: question.id })}
            >
              Apply to work
            </Button>
            <Button variant="outline" disabled={pending} onClick={() => draft.update()}>
              Revise answer
            </Button>
          </>
        ) : status === "deferred" ? (
          <Button disabled={pending} onClick={() => draft.update()}>
            Answer now
          </Button>
        ) : (
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => void save({ type: "reopen", questionId: question.id })}
          >
            Reopen
          </Button>
        )}
      </div>
    </div>
  );
}

function changeAfter(entry: QuestHistoryEntry, label: string) {
  return entry.changes.find((change) => change.label === label)?.after ?? null;
}

/** Earlier answers lead with what was decided and why; field-level changes stay one step away. */
function EarlierDecisions({
  question,
  record,
}: {
  question: QuestQuestion;
  record: ReadonlyArray<QuestHistoryEntry>;
}) {
  if (record.length === 0)
    return question.answer ? (
      <p className="mt-6 text-xs text-muted-foreground">Answer saved before history began.</p>
    ) : null;
  return (
    <details className="mt-6">
      <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Earlier · {record.length}
      </summary>
      <ul className="mt-2">
        {record.toReversed().map((entry) => {
          const answer = changeAfter(entry, "Answer");
          const rationale = changeAfter(entry, "Rationale");
          const lead =
            entry.kind === "answer"
              ? "Answered"
              : entry.kind === "defer"
                ? "Deferred"
                : entry.kind === "apply"
                  ? "Applied"
                  : entry.kind === "reopen"
                    ? "Reopened"
                    : entry.summary;
          return (
            <li key={entry.id} className="border-b py-2.5 text-sm last:border-b-0">
              <p className="text-xs text-muted-foreground">
                {lead} · {dateFormat.format(new Date(entry.at))}
              </p>
              {answer ? <p className="mt-1 whitespace-pre-wrap">{answer}</p> : null}
              {rationale ? (
                <p className="mt-1 whitespace-pre-wrap text-muted-foreground">Why: {rationale}</p>
              ) : null}
              {entry.kind === "apply" ? <AppliedChange entry={entry} /> : null}
              {entry.changes.length > 0 ? (
                <details className="mt-1">
                  <summary className="cursor-pointer text-xs text-muted-foreground">
                    Changes · revision {entry.revision}
                  </summary>
                  <dl className="mt-1 grid gap-1 text-xs">
                    {entry.changes.map((change) => (
                      <div key={change.label}>
                        <dt className="font-medium">{change.label}</dt>
                        <dd className="whitespace-pre-wrap break-words text-muted-foreground">
                          {change.before ?? "(empty)"} → {change.after ?? "(empty)"}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </details>
              ) : null}
            </li>
          );
        })}
      </ul>
    </details>
  );
}

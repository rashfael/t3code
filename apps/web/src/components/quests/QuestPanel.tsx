import {
  questAppliedUnderstanding,
  questQuestionStatus,
  type QuestHistoryEntry,
  type QuestQuestion,
  type QuestWork,
} from "@t3tools/contracts";
import { ArrowLeftIcon, ChevronRightIcon, XIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Radio, RadioGroup } from "../ui/radio-group";
import { Textarea } from "../ui/textarea";
import { useQuest, type PanelEntry } from "./questContext";
import {
  conversationStatusLabel,
  QuestSelect,
  useQuestConversationThreads,
} from "./QuestConversations";
import {
  DocumentAssociations,
  DocumentEditor,
  Field,
  HandoffEditor,
  QuestionEditor,
  useEditorDraft,
  WorkEditor,
} from "./QuestEditors";
import { draftText, useQuestDraft } from "./questDraftStore";
import { DocumentsList, FileDocumentView, ReconstructRevision } from "./QuestDocuments";
import { QuestMarkdown } from "./QuestMarkdown";
import {
  childrenOf,
  questionStatusLabels,
  questionStatusOrder,
  questionsByStatus,
  workPath,
  workStateLabels,
  workStateVariants,
} from "./questModel";

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

function panelTitle(entry: PanelEntry): string {
  switch (entry.type) {
    case "work":
      return "Work";
    case "document":
      return "Document";
    case "question":
      return "Decision";
    case "decisions":
      return "Decisions";
    case "documents":
      return "Documents";
    case "history":
      return "History";
  }
}

export function QuestPanel({
  entry,
  canGoBack,
  onBack,
  onClose,
}: {
  entry: PanelEntry;
  canGoBack: boolean;
  onBack: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="flex shrink-0 items-center gap-1 border-b px-2 py-1.5">
        {canGoBack ? (
          <Button size="icon-sm" variant="ghost" aria-label="Back" onClick={onBack}>
            <ArrowLeftIcon />
          </Button>
        ) : null}
        <span className="px-1 text-xs font-medium text-muted-foreground">{panelTitle(entry)}</span>
        <span className="ms-auto">
          <Button size="icon-sm" variant="ghost" aria-label="Close details" onClick={onClose}>
            <XIcon />
          </Button>
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {entry.type === "work" ? (
          <WorkInspector id={entry.id} />
        ) : entry.type === "document" ? (
          <DocumentView id={entry.id} />
        ) : entry.type === "question" ? (
          <QuestionView id={entry.id} />
        ) : entry.type === "decisions" ? (
          <DecisionList />
        ) : entry.type === "documents" ? (
          <DocumentsList />
        ) : (
          <HistoryList />
        )}
      </div>
    </>
  );
}

function Block({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mt-6">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function LinkRow({
  children,
  detail,
  onClick,
}: {
  children: ReactNode;
  detail?: ReactNode;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-start gap-2 rounded px-1 py-1.5 text-left text-sm hover:bg-accent"
      >
        <span className="min-w-0 flex-1">
          {children}
          {detail ? <span className="block text-xs text-muted-foreground">{detail}</span> : null}
        </span>
        <ChevronRightIcon aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      </button>
    </li>
  );
}

function Missing({ what }: { what: string }) {
  return <p className="text-sm text-muted-foreground">This {what} is no longer in the Quest.</p>;
}

function historyTarget(entry: QuestHistoryEntry): PanelEntry | null {
  if (!entry.targetId) return null;
  switch (entry.kind) {
    case "work":
    case "current":
      return { type: "work", id: entry.targetId };
    case "document":
      return { type: "document", id: entry.targetId };
    case "answer":
    case "defer":
    case "apply":
    case "reopen":
      return { type: "question", id: entry.targetId };
    default:
      return null;
  }
}

export function HistoryEntryRow({
  entry,
  inPanel = false,
}: {
  entry: QuestHistoryEntry;
  inPanel?: boolean;
}) {
  const { openPanel } = useQuest();
  const target = historyTarget(entry);
  return (
    <li className="border-b py-2.5 text-sm last:border-b-0">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p>
            {entry.kind === "baseline" ? (
              <Badge variant="outline" size="sm">
                Baseline
              </Badge>
            ) : null}{" "}
            {entry.summary}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Revision {entry.revision} · {dateFormat.format(new Date(entry.at))}
          </p>
        </div>
        {target ? (
          <Button
            size="xs"
            variant="ghost"
            onClick={() => openPanel(target, inPanel ? "push" : "replace")}
          >
            Open
          </Button>
        ) : null}
      </div>
      {entry.changes.length > 0 ? (
        <details className="mt-1.5">
          <summary className="cursor-pointer text-xs text-muted-foreground">
            Show what changed
          </summary>
          <dl className="mt-2 space-y-3">
            {entry.changes.map((change) => (
              <div key={change.label}>
                <dt className="text-xs font-medium">{change.label}</dt>
                <dd className="mt-1 grid gap-1 text-xs">
                  <ChangeText label="Before" text={change.before} />
                  <ChangeText label="After" text={change.after} />
                </dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}
    </li>
  );
}

function ChangeText({ label, text }: { label: string; text: string | null }) {
  return (
    <div className="rounded border bg-muted/30 p-2">
      <span className="text-muted-foreground">{label}: </span>
      <span className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words">
        {text ?? "(empty)"}
      </span>
    </div>
  );
}

function WorkInspector({ id }: { id: string }) {
  const { state, canWrite, pending, save, openPanel, showView } = useQuest();
  const threads = useQuestConversationThreads();
  const edit = useEditorDraft("work", id);
  const handoff = useEditorDraft("handoff", id);
  const associations = useEditorDraft("documents", id);
  const work = state.work.find((item) => item.id === id);
  if (!work) return <Missing what="work" />;
  const path = workPath(state, work.id).slice(0, -1);
  const parts = childrenOf(state, work.id);
  const relations = state.relations.filter((r) => r.from === work.id || r.to === work.id);
  const questions = state.questions.filter((question) => question.workId === work.id);
  const conversations = state.conversations.filter((item) => item.workId === work.id);
  const documents = [
    ...state.documents
      .filter((doc) => work.documentIds.includes(doc.id))
      .map((doc) => ({
        id: doc.id,
        title: doc.title,
        detail: doc.kind === "evidence" ? "Evidence · read only" : "Quest note",
      })),
    ...state.files
      .filter((file) => work.documentIds.includes(file.id))
      .map((file) => ({ id: file.id, title: file.title, detail: file.path })),
  ];
  const questionIds = new Set(questions.map((question) => question.id));
  const history = state.history
    .filter(
      (entry) => entry.targetId === work.id || (entry.targetId && questionIds.has(entry.targetId)),
    )
    .toReversed();
  const title = (otherId: string) =>
    state.work.find((item) => item.id === otherId)?.title ?? otherId;
  if (edit.draft) return <WorkEditor work={work} />;
  if (handoff.draft) return <HandoffEditor work={work} />;
  return (
    <article aria-label={work.title}>
      {path.length > 0 ? (
        <nav
          aria-label="Part of"
          className="mb-2 flex flex-wrap items-center gap-1 text-xs text-muted-foreground"
        >
          {path.map((item) => (
            <span key={item.id} className="flex items-center gap-1">
              <button
                type="button"
                className="hover:underline"
                onClick={() => openPanel({ type: "work", id: item.id }, "push")}
              >
                {item.title}
              </button>
              <ChevronRightIcon aria-hidden className="size-3" />
            </span>
          ))}
        </nav>
      ) : null}
      <div className="flex flex-wrap items-center gap-1.5">
        {work.kind === "attempt" ? <Badge variant="outline">Attempt</Badge> : null}
        <Badge variant={workStateVariants[work.state]}>{workStateLabels[work.state]}</Badge>
        {state.currentWorkId === work.id ? <Badge variant="info">Current milestone</Badge> : null}
      </div>
      <h2 className="mt-2 text-lg font-semibold">{work.title}</h2>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {canWrite ? (
          <Button size="sm" variant="outline" disabled={pending} onClick={() => edit.update()}>
            Edit
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => showView("conversation", { about: `work:${work.id}` })}
        >
          {work.state === "attention" ? "Discuss the intervention" : "Discuss"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => showView("map", { work: work.id })}>
          Show in map
        </Button>
        {canWrite && work.kind === "work" && state.currentWorkId !== work.id && parts.length > 0 ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => void save({ type: "current", workId: work.id })}
          >
            Mark as current milestone
          </Button>
        ) : null}
      </div>

      <Block title="Current understanding">
        <p className="whitespace-pre-wrap text-sm">
          {work.understanding || "No understanding recorded."}
        </p>
      </Block>

      <Block title="Delivery and acceptance">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-muted-foreground">State</dt>
          <dd>{workStateLabels[work.state]}</dd>
          <dt className="text-muted-foreground">Human owner</dt>
          <dd>{work.owner || "Not recorded"}</dd>
          <dt className="text-muted-foreground">Agent</dt>
          <dd>{work.agent || "None"}</dd>
          <dt className="text-muted-foreground">Conversations</dt>
          <dd>
            {conversations.length === 0
              ? "None linked"
              : conversations.map((item) => {
                  const thread = threads.get(item.threadId) ?? null;
                  return (
                    <button
                      key={item.threadId}
                      type="button"
                      className="block text-start underline"
                      onClick={() => showView("conversation", { thread: item.threadId })}
                    >
                      {item.purpose || thread?.title || item.title} (
                      {conversationStatusLabel(thread)})
                    </button>
                  );
                })}
          </dd>
        </dl>
      </Block>

      {questions.length > 0 ? (
        <Block title="Decisions">
          <ul>
            {questions.map((question) => (
              <LinkRow
                key={question.id}
                detail={questionStatusLabels[questQuestionStatus(question)]}
                onClick={() => openPanel({ type: "question", id: question.id }, "push")}
              >
                {question.title}
              </LinkRow>
            ))}
          </ul>
        </Block>
      ) : null}

      {relations.length > 0 ? (
        <Block title="Relationships">
          <ul className="space-y-2">
            {relations.map((relation) => {
              const outgoing = relation.from === work.id;
              const other = outgoing ? relation.to : relation.from;
              const label =
                relation.type === "follows"
                  ? outgoing
                    ? "After"
                    : "Before"
                  : outgoing
                    ? "Retries"
                    : "Retried by";
              const source = state.documents.find((doc) => doc.id === relation.documentId);
              return (
                <li key={relation.id} className="rounded border p-2 text-sm">
                  <button
                    type="button"
                    className="font-medium hover:underline"
                    onClick={() => openPanel({ type: "work", id: other }, "push")}
                  >
                    {label}: {title(other)}
                  </button>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {relation.provenance === "capture" ? "Source" : "Example link"}
                    {source ? (
                      <>
                        {": "}
                        <button
                          type="button"
                          className="underline"
                          onClick={() => openPanel({ type: "document", id: source.id }, "push")}
                        >
                          {source.title}
                        </button>
                      </>
                    ) : null}
                  </p>
                  {relation.excerpt ? (
                    <blockquote className="mt-1 border-s-2 ps-2 text-xs">
                      {relation.excerpt}
                    </blockquote>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Block>
      ) : null}

      {parts.length > 0 ? (
        <Block title="Parts and attempts">
          <ul>
            {parts.map((part) => (
              <LinkRow
                key={part.id}
                detail={`${part.kind === "attempt" ? "Attempt · " : ""}${workStateLabels[part.state]}`}
                onClick={() => openPanel({ type: "work", id: part.id }, "push")}
              >
                {part.title}
              </LinkRow>
            ))}
          </ul>
        </Block>
      ) : null}

      <Block
        title="Attempts and handoff"
        action={
          canWrite ? (
            <Button size="xs" variant="ghost" disabled={pending} onClick={() => handoff.update()}>
              Prepare handoff
            </Button>
          ) : null
        }
      >
        {work.priorAttempts || work.findings || work.handoff ? (
          <dl className="space-y-2 text-sm">
            {(
              [
                ["Previous attempts", work.priorAttempts],
                ["Open findings", work.findings],
                ["Handoff", work.handoff],
              ] as const
            )
              .filter(([, text]) => text)
              .map(([label, text]) => (
                <div key={label}>
                  <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
                  <dd className="whitespace-pre-wrap">{text}</dd>
                </div>
              ))}
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">Nothing recorded.</p>
        )}
      </Block>

      <Block
        title="Documents"
        action={
          canWrite && !associations.draft ? (
            <Button
              size="xs"
              variant="ghost"
              disabled={pending}
              onClick={() => associations.update()}
            >
              Manage
            </Button>
          ) : null
        }
      >
        {associations.draft ? (
          <DocumentAssociations work={work} />
        ) : documents.length > 0 ? (
          <ul>
            {documents.map((doc) => (
              <LinkRow
                key={doc.id}
                detail={doc.detail}
                onClick={() => openPanel({ type: "document", id: doc.id }, "push")}
              >
                {doc.title}
              </LinkRow>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No documents associated.</p>
        )}
      </Block>

      <Block title="History">
        {history.length > 0 ? (
          <ul>
            {history.map((entry) => (
              <HistoryEntryRow key={entry.id} entry={entry} inPanel />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            No changes since revision {state.history[0]?.revision ?? 0}.
          </p>
        )}
      </Block>
    </article>
  );
}

function DocumentView({ id }: { id: string }) {
  const { state, canWrite, pending, openPanel } = useQuest();
  const editor = useEditorDraft("document", id);
  const document = state.documents.find((item) => item.id === id);
  const file = state.files.find((item) => item.id === id);
  if (file) return <FileDocumentView file={file} />;
  if (!document) return <Missing what="document" />;
  if (editor.draft) return <DocumentEditor document={document} />;
  const users = state.work.filter((item) => item.documentIds.includes(document.id));
  return (
    <article aria-label={document.title}>
      <div className="flex items-center gap-2">
        {document.kind === "evidence" ? (
          <Badge variant="outline">Evidence · read only</Badge>
        ) : (
          <Badge variant="info">Quest note</Badge>
        )}
        {document.kind === "living" && canWrite ? (
          <span className="ms-auto">
            <Button size="xs" variant="outline" disabled={pending} onClick={() => editor.update()}>
              Edit
            </Button>
          </span>
        ) : null}
      </div>
      <h2 className="mt-2 text-lg font-semibold">{document.title}</h2>
      <p className="mt-1 break-all text-xs text-muted-foreground">
        {document.source}
        {document.sha256 ? (
          <>
            <br />
            Retained content SHA-256: {document.sha256}
          </>
        ) : null}
      </p>
      <div className="mt-4">
        <QuestMarkdown text={document.body} />
      </div>
      {users.length > 0 ? (
        <Block title="Used by">
          <ul>
            {users.map((item) => (
              <LinkRow
                key={item.id}
                onClick={() => openPanel({ type: "work", id: item.id }, "push")}
              >
                {item.title}
              </LinkRow>
            ))}
          </ul>
        </Block>
      ) : null}
    </article>
  );
}

function addedText(before: string, after: string): string {
  return after.startsWith(before) ? after.slice(before.length).trim() : after;
}

function QuestionView({ id }: { id: string }) {
  const { environmentId, state, canWrite, pending, save, openPanel, showView } = useQuest();
  const question = state.questions.find((item) => item.id === id);
  const draft = useQuestDraft(environmentId, `question:${id}`);
  const [editing, setEditing] = useState(false);
  if (!question) return <Missing what="decision" />;
  if (editing) return <QuestionEditor question={question} onDone={() => setEditing(false)} />;
  const discussions = state.conversations.filter(
    (item) =>
      item.questionId === question.id || (item.workId !== null && item.workId === question.workId),
  );
  const answer = draftText(draft.draft, "answer", question.answer ?? "");
  const rationale = draftText(draft.draft, "rationale", question.rationale ?? "");
  // A saved source stays, even a detached one or on a deferral; only an unsourced new answer gets a suggestion.
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
  const setAnswer = (value: string) => draft.update({ answer: value });
  const setRationale = (value: string) => draft.update({ rationale: value });
  async function saveAnswer(deferred: boolean) {
    const saved = await save(
      {
        type: "answer",
        questionId: id,
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
  const status = questQuestionStatus(question);
  const work = state.work.find((item) => item.id === question.workId);
  const answerSource = question.answerSource
    ? (state.conversations.find((item) => item.threadId === question.answerSource?.threadId) ??
      null)
    : null;
  const sources = [
    ...state.documents.filter((doc) => work?.documentIds.includes(doc.id)),
    ...state.files
      .filter((file) => work?.documentIds.includes(file.id))
      .map((file) => ({ id: file.id, title: file.title, kind: "file" as const })),
  ];
  const record = state.history.filter((entry) => entry.targetId === question.id);
  const lastApply = record.findLast((entry) => entry.kind === "apply");
  const preview = work && status === "recorded" ? questAppliedUnderstanding(work, question) : null;
  return (
    <article aria-label={question.title}>
      <div className="flex flex-wrap gap-1.5">
        <Badge variant={status === "open" || status === "recorded" ? "warning" : "secondary"}>
          {questionStatusLabels[status]}
        </Badge>
        {question.proposal ? <Badge variant="outline">Proposed</Badge> : null}
      </div>
      <h2 className="mt-2 text-lg font-semibold">{question.title}</h2>
      <p className="mt-2 whitespace-pre-wrap text-sm">{question.context}</p>
      <dl className="mt-3 text-sm">
        <dt className="text-xs text-muted-foreground">Affects</dt>
        <dd>
          {work ? (
            <button
              type="button"
              className="underline"
              onClick={() => openPanel({ type: "work", id: work.id }, "push")}
            >
              {work.title}
            </button>
          ) : (
            "Work no longer in the Quest"
          )}
        </dd>
      </dl>
      {sources.length > 0 ? (
        <Block title="Sources">
          <ul>
            {sources.map((doc) => (
              <LinkRow
                key={doc.id}
                detail={
                  doc.kind === "evidence"
                    ? "Evidence"
                    : doc.kind === "file"
                      ? "Markdown file"
                      : "Quest note"
                }
                onClick={() => openPanel({ type: "document", id: doc.id }, "push")}
              >
                {doc.title}
              </LinkRow>
            ))}
          </ul>
        </Block>
      ) : null}
      <div className="mt-3">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => showView("conversation", { about: `question:${question.id}` })}
        >
          Discuss in a conversation
        </Button>
        {canWrite && status !== "applied" ? (
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => setEditing(true)}>
            Edit question
          </Button>
        ) : null}
      </div>
      {question.answer && question.answerSource ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Answer recorded from{" "}
          <button
            type="button"
            className="underline"
            onClick={() => showView("conversation", { thread: question.answerSource!.threadId })}
          >
            {answerSource?.purpose ||
              answerSource?.title ||
              "a conversation no longer in the Quest"}
          </button>
          {question.appliedRevision !== null
            ? ` · applied in revision ${question.appliedRevision}`
            : ""}
        </p>
      ) : question.appliedRevision !== null ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Applied in revision {question.appliedRevision}
        </p>
      ) : null}

      {status === "applied" ? (
        <Block title="Applied">
          <p className="text-sm">Recorded answer: {question.answer}</p>
          {question.rationale ? (
            <p className="mt-1 text-sm">Rationale: {question.rationale}</p>
          ) : null}
          {lastApply?.changes[0] ? (
            <div className="mt-2 text-xs">
              <p className="text-muted-foreground">
                Resulting change to {lastApply.changes[0].label}:
              </p>
              <pre className="mt-1 whitespace-pre-wrap rounded border bg-success/8 p-2">
                + {addedText(lastApply.changes[0].before ?? "", lastApply.changes[0].after ?? "")}
              </pre>
            </div>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">Applied before history began.</p>
          )}
          {canWrite ? (
            <div className="mt-3">
              <p className="mb-2 text-xs text-muted-foreground">
                The applied text stays in the work.
              </p>
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => void save({ type: "reopen", questionId: question.id })}
              >
                Reopen for revision
              </Button>
            </div>
          ) : null}
        </Block>
      ) : (
        <Block title={status === "open" ? "Answer" : "Revise the answer"}>
          <fieldset disabled={pending || !canWrite} className="min-w-0">
            <RadioGroup
              value={answer}
              onValueChange={(value) => setAnswer(String(value))}
              className="mb-3"
            >
              {question.alternatives.map((alternative) => (
                <label key={alternative} className="flex gap-2 rounded border p-2.5 text-sm">
                  <Radio value={alternative} />
                  {alternative}
                </label>
              ))}
            </RadioGroup>
            <Field label="Answer">
              <Textarea
                value={answer}
                onChange={(event) => setAnswer(event.target.value)}
                rows={3}
              />
            </Field>
            <Field label="Rationale (optional)">
              <Textarea
                value={rationale}
                onChange={(event) => setRationale(event.target.value)}
                rows={2}
              />
            </Field>
            {discussions.length > 0 || detachedSource ? (
              <Field label="From conversation">
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
                      label: item.purpose || item.title,
                    })),
                  ]}
                />
              </Field>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={!answer.trim()} onClick={() => void saveAnswer(false)}>
                Record answer
              </Button>
              <Button size="sm" variant="outline" onClick={() => void saveAnswer(true)}>
                Defer
              </Button>
            </div>
          </fieldset>
          {preview && work ? (
            <div className="mt-4 rounded-lg border p-3">
              <p className="text-sm font-medium">Applying would change “{work.title}”</p>
              <p className="mt-1 text-xs text-muted-foreground">Adds to current understanding:</p>
              <pre className="mt-2 whitespace-pre-wrap rounded border bg-success/8 p-2 text-xs">
                + {addedText(work.understanding, preview)}
              </pre>
              {canWrite ? (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={pending}
                  onClick={() => void save({ type: "apply", questionId: question.id })}
                >
                  Apply recorded answer to work
                </Button>
              ) : null}
            </div>
          ) : null}
        </Block>
      )}

      <Block title="Record">
        {question.answer &&
        !record.some((entry) => entry.kind === "answer" || entry.kind === "defer") ? (
          <p className="mb-2 text-xs text-muted-foreground">Answer saved before history began.</p>
        ) : null}
        {record.length > 0 ? (
          <ul>
            {record.toReversed().map((entry) => (
              <HistoryEntryRow key={entry.id} entry={entry} inPanel />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No recorded answers yet.</p>
        )}
      </Block>
    </article>
  );
}

function DecisionList() {
  const { state, canWrite, openPanel } = useQuest();
  const [preparing, setPreparing] = useState(false);
  const groups = questionsByStatus(state.questions);
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Decisions</h2>
        {canWrite && !preparing ? (
          <Button size="sm" variant="outline" onClick={() => setPreparing(true)}>
            Prepare a question
          </Button>
        ) : null}
      </div>
      {preparing ? (
        <div className="mt-4">
          <QuestionEditor onDone={() => setPreparing(false)} />
        </div>
      ) : null}
      {questionStatusOrder.map((status) => (
        <Block key={status} title={`${questionStatusLabels[status]} · ${groups[status].length}`}>
          {groups[status].length > 0 ? (
            <ul>
              {groups[status].map((question: QuestQuestion) => (
                <LinkRow
                  key={question.id}
                  detail={`${state.work.find((item: QuestWork) => item.id === question.workId)?.title ?? "Missing work"}${question.proposal ? " · Proposed" : ""}`}
                  onClick={() => openPanel({ type: "question", id: question.id }, "push")}
                >
                  {question.title}
                </LinkRow>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">None.</p>
          )}
        </Block>
      ))}
    </div>
  );
}

function HistoryList() {
  const { state } = useQuest();
  return (
    <div>
      <h2 className="text-lg font-semibold">History</h2>
      <ReconstructRevision />
      <ul className="mt-3">
        {state.history.toReversed().map((entry) => (
          <HistoryEntryRow key={entry.id} entry={entry} inPanel />
        ))}
      </ul>
    </div>
  );
}

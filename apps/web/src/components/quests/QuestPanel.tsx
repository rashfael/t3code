import {
  QUEST_FOCUS_LEVELS,
  questQuestionStatus,
  type QuestHistoryEntry,
  type QuestWork,
} from "@t3tools/contracts";
import { ArrowLeftIcon, ChevronRightIcon, XIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { useQuest, type PanelEntry } from "./questContext";
import { conversationStatusLabel, useQuestConversationThreads } from "./QuestConversations";
import { DocumentAssociations, HandoffEditor, useEditorDraft, WorkEditor } from "./QuestEditors";
import { ReconstructRevision } from "./QuestDocuments";
import {
  childrenOf,
  questionStatusLabels,
  workPath,
  workStateLabels,
  workStateVariants,
} from "./questModel";

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export function QuestPanel({
  entry,
  canGoBack = false,
  onBack,
  onClose,
  preview = false,
}: {
  entry: PanelEntry;
  canGoBack?: boolean;
  onBack?: () => void;
  onClose?: () => void;
  /** A read-only look at hovered or focused work; the pinned panel and its drafts stay underneath. */
  preview?: boolean;
}) {
  return (
    <>
      <div className="flex shrink-0 items-center gap-1 border-b px-2 py-1.5">
        {preview ? (
          <span className="px-1 text-xs text-muted-foreground">Preview · click to pin</span>
        ) : null}
        {canGoBack && onBack ? (
          <Button size="icon-sm" variant="ghost" aria-label="Back" onClick={onBack}>
            <ArrowLeftIcon />
          </Button>
        ) : null}
        {preview ? null : (
          <span className="px-1 text-xs font-medium text-muted-foreground">Work</span>
        )}
        {onClose ? (
          <span className="ms-auto">
            <Button size="icon-sm" variant="ghost" aria-label="Close details" onClick={onClose}>
              <XIcon />
            </Button>
          </span>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <WorkInspector id={entry.id} preview={preview} />
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

function historyTarget(entry: QuestHistoryEntry): PanelEntry | "document" | null {
  if (!entry.targetId) return null;
  switch (entry.kind) {
    case "work":
    case "current":
      return { type: "work", id: entry.targetId };
    case "document":
      return "document";
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
  const { openPanel, openDocument } = useQuest();
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
            onClick={() =>
              target === "document"
                ? openDocument(entry.targetId!)
                : openPanel(target, inPanel ? "push" : "replace")
            }
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

function WorkInspector({ id, preview }: { id: string; preview: boolean }) {
  const { state, canWrite, pending, save, openPanel, showView, openDocument } = useQuest();
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
  if (!preview && edit.draft) return <WorkEditor work={work} />;
  if (!preview && handoff.draft) return <HandoffEditor work={work} />;
  return (
    <article aria-label={preview ? `Preview: ${work.title}` : work.title}>
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

      <PlannedFocus work={work} preview={preview} />

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
                    {relation.provenance === "capture"
                      ? "Source"
                      : relation.provenance === "plan"
                        ? "Applied plan change"
                        : "Example link"}
                    {source ? (
                      <>
                        {": "}
                        <button
                          type="button"
                          className="underline"
                          onClick={() => openDocument(source.id)}
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
              <LinkRow key={doc.id} detail={doc.detail} onClick={() => openDocument(doc.id)}>
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

const focusLabels: Record<number, string> = {
  1: "Light",
  2: "Some",
  3: "Moderate",
  4: "Strong",
  5: "Main",
};

/** An explicit relative plan for where to concentrate work; unset stays visibly unspecified. */
function PlannedFocus({ work, preview }: { work: QuestWork; preview: boolean }) {
  const { canWrite, pending, save } = useQuest();
  const label =
    work.focus === undefined
      ? "Not set"
      : `${work.focus} of 5 · ${focusLabels[work.focus] ?? "Unknown"}`;
  const setFocus = (focus: number | null) => {
    const { focus: _previous, ...rest } = work;
    void save({ type: "work", work: focus === null ? rest : { ...rest, focus } });
  };
  return (
    <section className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <span className="text-muted-foreground">Planned focus</span>
      {canWrite && !preview ? (
        <span role="group" aria-label="Planned focus" className="flex items-center gap-0.5">
          {QUEST_FOCUS_LEVELS.map((level) => (
            <Button
              key={level}
              size="xs"
              variant={work.focus === level ? "secondary" : "ghost"}
              aria-pressed={work.focus === level}
              aria-label={`Planned focus ${level} of 5, ${focusLabels[level]}`}
              disabled={pending || work.focus === level}
              onClick={() => setFocus(level)}
            >
              {level}
            </Button>
          ))}
          <Button
            size="xs"
            variant="ghost"
            disabled={pending || work.focus === undefined}
            onClick={() => setFocus(null)}
          >
            Clear
          </Button>
        </span>
      ) : null}
      <span className={work.focus === undefined ? "text-muted-foreground italic" : undefined}>
        {label}
      </span>
    </section>
  );
}

export function HistoryList() {
  const { state } = useQuest();
  return (
    <div>
      <h2 className="text-lg font-semibold">History</h2>
      <ReconstructRevision />
      <ul className="mt-3">
        {state.history.toReversed().map((entry) => (
          <HistoryEntryRow key={entry.id} entry={entry} />
        ))}
      </ul>
    </div>
  );
}

import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { resolveNewThreadModelSelection } from "@t3tools/shared/usageLimits";
import {
  AuthFilesystemReadScope,
  DEFAULT_SERVER_SETTINGS,
  type EnvironmentId,
  type QuestConversation,
  type QuestOpenConversationInput,
  type QuestPurposeKind,
  type QuestState,
  type ThreadId,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import * as Option from "effect/Option";
import { CompassIcon, GitForkIcon, MessageSquareIcon, PlusIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { cn, randomUUID } from "~/lib/utils";
import { useComposerDraftStore } from "~/composerDraftStore";
import { resolveProjectDefaultProviderModelSelection } from "~/providerInstances";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useProjects, useQuietThreadShells } from "~/state/entities";
import { environmentServerConfigsAtom } from "~/state/server";
import { useEnvironmentQuery } from "~/state/query";
import { useEnvironmentScope } from "~/state/session";
import { useEnvironmentThread } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import type { ChatEmbedding } from "../ChatView.logic";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useQuest } from "./questContext";
import { rememberQuestConversation, useQuestDraftStore } from "./questDraftStore";
import { questEnvironment } from "./questEnvironment";
import { QuestChat } from "./QuestChat";
import { pinnedTabId } from "./QuestDocuments";

export function useQuestConversationThreads(): ReadonlyMap<string, EnvironmentThreadShell> {
  const { environmentId, state } = useQuest();
  const shells = useQuietThreadShells();
  const linked = new Set(state.conversations.map((item) => item.threadId));
  return new Map(
    shells
      .filter((shell) => shell.environmentId === environmentId && linked.has(shell.id))
      .map((shell) => [shell.id, shell]),
  );
}

export function conversationStatusLabel(thread: EnvironmentThreadShell | null): string {
  if (!thread) return "not available";
  if (thread.deletedAt) return "deleted";
  if (thread.archivedAt) return "archived";
  const status = thread.runtime?.status ?? "idle";
  if (status === "idle" || status === "completed")
    return thread.settledOverride === "settled" ? "settled" : "idle";
  if (["preparing", "queued", "starting", "running", "waiting"].includes(status))
    return "agent working";
  return status.replace("_", " ");
}

interface ConversationPresence {
  readonly label: string;
  readonly deleted: boolean;
}

/**
 * What is known about a Quest conversation's thread. The shell list omits older settled threads,
 * so a missing shell is not a deletion: the thread's own detail decides, and is loading until then.
 */
function useConversationPresence(
  environmentId: EnvironmentId,
  conversation: QuestConversation | null,
  shell: EnvironmentThreadShell | null,
): ConversationPresence {
  const reserved = conversation?.creation?.status === "reserved";
  const unlisted = conversation !== null && shell === null && !reserved;
  const detail = useEnvironmentThread(
    unlisted ? environmentId : null,
    unlisted ? (conversation.threadId as ThreadId) : null,
  );
  if (reserved) return { label: "not created yet", deleted: false };
  if (shell)
    return {
      label: conversationStatusLabel(shell),
      deleted: shell.deletedAt != null,
    };
  const thread = Option.getOrNull(detail.data)?.thread ?? null;
  if (detail.status === "deleted" || thread?.deletedAt != null)
    return { label: "deleted", deleted: true };
  if (thread === null) return { label: "loading…", deleted: false };
  return {
    label: thread.archivedAt
      ? "archived"
      : thread.settledOverride === "settled"
        ? "settled"
        : "not in recent threads",
    deleted: false,
  };
}

/** Puts a conversation's prepared context into its composer, never over text already there. */
function restorePreparedContext(environmentId: EnvironmentId, threadId: string, prepared: string) {
  const ref = scopeThreadRef(environmentId, threadId as ThreadId);
  const store = useComposerDraftStore.getState();
  if (store.getComposerDraft(ref)?.prompt.trim()) return;
  store.setPrompt(ref, prepared);
}

interface Subject {
  readonly workId: string | null;
  readonly questionId: string | null;
  readonly title: string | null;
  readonly purposeKind: QuestPurposeKind;
}

/** `about` value for a new open discussion, the Quest's next conversation when nothing narrower applies. */
const OPEN_DISCUSSION = "discussion";

function parseSubject(state: QuestState, about: string | null): Subject | null {
  if (about === OPEN_DISCUSSION)
    return { workId: null, questionId: null, title: "New discussion", purposeKind: "digress" };
  const [kind, id] = about?.split(":") ?? [];
  const work = kind === "work" ? state.work.find((item) => item.id === id) : undefined;
  if (work)
    return {
      workId: work.id,
      questionId: null,
      title: work.title,
      purposeKind: work.state === "attention" ? "intervene" : "discuss-work",
    };
  const question = kind === "question" ? state.questions.find((item) => item.id === id) : undefined;
  if (question)
    return { workId: null, questionId: question.id, title: question.title, purposeKind: "decide" };
  return null;
}

const purposeLabels: Record<QuestPurposeKind, string> = {
  coordinate: "Coordinate",
  "discuss-work": "Discuss",
  decide: "Decide",
  intervene: "Intervene",
  digress: "Discussion",
  linked: "Linked",
};

function defaultPurpose(subject: Subject): string {
  if (subject.purposeKind === "decide") return `Decide: ${subject.title}`;
  if (subject.purposeKind === "intervene") return `Unblock ${subject.title}`;
  if (subject.purposeKind === "digress") return "New discussion";
  return `Discuss ${subject.title}`;
}

function subjectTitle(state: QuestState, conversation: QuestConversation): string | null {
  return (
    state.work.find((item) => item.id === conversation.workId)?.title ??
    state.questions.find((item) => item.id === conversation.questionId)?.title ??
    null
  );
}

/** The model and modes a new thread in this project would start with, as the composer resolves them. */
function newThreadDefaults(environmentId: EnvironmentId, project: EnvironmentProject) {
  const config = appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId);
  const settings = config?.settings ?? DEFAULT_SERVER_SETTINGS;
  const providers = config?.providers ?? [];
  const projectSettings = resolveProjectSettings(settings, project.id, project).settings;
  const { selection } = resolveNewThreadModelSelection({
    defaultSelection:
      projectSettings.defaultModelSelection ??
      resolveProjectDefaultProviderModelSelection(providers, settings, project.id),
    fallbackSelection: settings.fallbackModelSelection ?? null,
    providers,
    settings,
    projectId: project.id,
    now: Date.now(),
  });
  return selection
    ? { modelSelection: selection, runtimeMode: projectSettings.defaultRuntimeMode }
    : null;
}

function useOpenQuestConversation() {
  const { environmentId, state, adopt, showView } = useQuest();
  const projects = useProjects().filter((project) => project.environmentId === environmentId);
  const open = useAtomCommand(questEnvironment.openConversation, { reportFailure: false });
  // One operation per intent until it succeeds, so a retry resolves the same reservation.
  const operations = useRef(new Map<string, string>());
  const [busy, setBusy] = useState(false);
  const preferredProjectId =
    state.conversations.find((item) => item.role === "core")?.projectId ??
    state.conversations.findLast((item) => item.projectId !== null)?.projectId ??
    null;
  const project = projects.find((item) => item.id === preferredProjectId) ?? projects[0] ?? null;

  async function openConversation(
    request: Pick<
      QuestOpenConversationInput,
      "role" | "purposeKind" | "purpose" | "workId" | "questionId" | "resume" | "threadId"
    >,
  ): Promise<string | null> {
    if (busy) return null;
    if (!project) {
      toastManager.add({ type: "error", title: "Add a project to this environment first" });
      return null;
    }
    const defaults = newThreadDefaults(environmentId, project);
    if (!defaults) {
      toastManager.add({ type: "error", title: "No provider is available for a new conversation" });
      return null;
    }
    const intent = JSON.stringify(request);
    const operationId = operations.current.get(intent) ?? randomUUID();
    operations.current.set(intent, operationId);
    setBusy(true);
    const result = await open({
      environmentId,
      input: {
        ...request,
        operationId,
        projectId: project.id,
        modelSelection: defaults.modelSelection,
        runtimeMode: defaults.runtimeMode,
        interactionMode: "default",
      },
    });
    setBusy(false);
    if (result._tag !== "Success") {
      const error = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: "The conversation is not ready",
        description: error instanceof Error ? error.message : undefined,
      });
      return null;
    }
    operations.current.delete(intent);
    adopt(result.value.state);
    const conversation = result.value.state.conversations.find(
      (item) => item.threadId === result.value.threadId,
    );
    // Whether this request reserved it or finished an earlier reservation, the prepared context
    // goes to an empty composer unsent; the owner edits or discards it.
    if (conversation?.prepared)
      restorePreparedContext(environmentId, result.value.threadId, conversation.prepared);
    showView("conversation", { thread: result.value.threadId });
    return result.value.threadId;
  }
  return { openConversation, busy, project };
}

export function QuestConversations({
  about,
  thread,
  beside,
}: {
  about: string | null;
  thread: string | null;
  /** Shown next to the chat column, so a resizable panel there measures only the chat. */
  beside?: ReactNode;
}) {
  const { environmentId, state, canWrite, save, showView } = useQuest();
  const threads = useQuestConversationThreads();
  const remembered = useQuestDraftStore((store) => store.conversations[environmentId] ?? null);
  const { openConversation, busy } = useOpenQuestConversation();
  const subject = parseSubject(state, about);
  const byId = (id: string | null) =>
    state.conversations.find((item) => item.threadId === id) ?? null;
  const selected = thread
    ? byId(thread)
    : subject
      ? null
      : (byId(remembered) ?? state.conversations.find((item) => item.role === "core") ?? null);
  const selectedId = selected?.threadId ?? null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- records the shown conversation in the Quest store so a later visit without one in the route reopens it
  useEffect(() => {
    if (selectedId) rememberQuestConversation(environmentId, selectedId);
  }, [environmentId, selectedId]);

  const navigate = useNavigate();
  const embedding: ChatEmbedding = {
    // The next conversation from a Quest chat is a purpose-bound discussion, started in the Quest.
    openNewThread: async () => {
      showView("conversation", {
        about: selected?.questionId
          ? `question:${selected.questionId}`
          : selected?.workId
            ? `work:${selected.workId}`
            : OPEN_DISCUSSION,
      });
      return true;
    },
    openFork: async (threadRef, origin) => {
      const source = byId(origin.threadId);
      const linked = await save({
        type: "link",
        threadId: threadRef.threadId,
        projectId: source?.projectId ?? null,
        title: `${source?.title ?? "Conversation"} · fork`,
        workId: source?.workId ?? null,
        questionId: source?.questionId ?? null,
        purposeKind: "digress",
        purpose: `Fork of “${source?.title ?? "a conversation"}”`,
        context: "fork",
        origin,
      });
      if (linked) {
        showView("conversation", { thread: threadRef.threadId });
        return;
      }
      toastManager.add({
        type: "error",
        title: "The fork was created but not added to the Quest",
        description: "It stays with the project's threads; it is open there now.",
      });
      await navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId: threadRef.environmentId, threadId: threadRef.threadId },
      });
    },
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <ConversationRail selectedId={selectedId} threads={threads} compact={Boolean(beside)} />
      <div className="flex min-h-0 min-w-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {subject && !thread ? (
            <StartDiscussion
              key={about}
              subject={subject}
              busy={busy}
              canWrite={canWrite}
              onStart={(purpose, resume) =>
                void openConversation({
                  role: "focused",
                  purposeKind: subject.purposeKind,
                  purpose,
                  workId: subject.workId,
                  questionId: subject.questionId,
                  resume,
                })
              }
            />
          ) : selected ? (
            <>
              <ConversationHeader
                conversation={selected}
                thread={threads.get(selected.threadId) ?? null}
              />
              {selected.creation?.status === "reserved" ? (
                <div className="flex flex-col items-start gap-3 p-6 text-sm">
                  <p role="status">
                    This conversation is reserved but not created yet. Nothing has been sent.
                  </p>
                  {canWrite ? (
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        void openConversation({
                          role: selected.role === "core" ? "core" : "focused",
                          purposeKind: selected.purposeKind,
                          purpose: selected.purpose,
                          workId: selected.workId,
                          questionId: selected.questionId,
                          resume: true,
                          threadId: selected.threadId,
                        })
                      }
                    >
                      Create it now
                    </Button>
                  ) : null}
                </div>
              ) : (
                <div className="flex min-h-0 flex-1 flex-col">
                  <QuestChat
                    key={selected.threadId}
                    environmentId={environmentId}
                    threadId={selected.threadId}
                    embedding={embedding}
                  />
                </div>
              )}
            </>
          ) : thread ? (
            <div className="flex flex-col items-start gap-3 p-6 text-sm">
              <p role="alert">This conversation is no longer part of the Quest.</p>
              <Button size="sm" variant="outline" onClick={() => showView("conversation")}>
                Show the Quest's conversations
              </Button>
            </div>
          ) : (
            <div className="p-6 text-sm text-muted-foreground">
              <p>
                Start the core conversation, or discuss a work item or decision from the overview.
              </p>
              {canWrite ? null : <p className="mt-1">Read only</p>}
            </div>
          )}
        </div>
        {beside}
      </div>
    </div>
  );
}

function StartDiscussion({
  subject,
  busy,
  canWrite,
  onStart,
}: {
  subject: Subject;
  busy: boolean;
  canWrite: boolean;
  onStart: (purpose: string, resume: boolean) => void;
}) {
  const { state, showView } = useQuest();
  const [purpose, setPurpose] = useState(defaultPurpose(subject));
  const existing = state.conversations.filter(
    (item) =>
      item.role === "focused" &&
      item.purposeKind === subject.purposeKind &&
      item.workId === subject.workId &&
      item.questionId === subject.questionId,
  );
  return (
    <section aria-label="Start a discussion" className="max-w-xl p-6 text-sm">
      <p className="text-xs text-muted-foreground">{purposeLabels[subject.purposeKind]}</p>
      <h2 className="mt-1 text-base font-semibold">{subject.title}</h2>
      {existing.length > 0 ? (
        <div className="mt-4">
          <p className="mb-2 text-xs text-muted-foreground">Already discussing this</p>
          <ul className="grid gap-1">
            {existing.toReversed().map((item) => (
              <li key={item.threadId}>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => showView("conversation", { thread: item.threadId })}
                >
                  Resume “{item.purpose || item.title}”
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {canWrite ? (
        <form
          className="mt-5 grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            onStart(purpose, false);
          }}
        >
          <label className="text-xs text-muted-foreground" htmlFor="quest-discussion-purpose">
            Purpose
          </label>
          <Input
            id="quest-discussion-purpose"
            value={purpose}
            onChange={(event) => setPurpose(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Creates an ordinary thread with the subject, open decisions and pinned sources prepared
            in its composer. Nothing is sent until you send it.
          </p>
          <div>
            <Button type="submit" size="sm" disabled={busy || !purpose.trim()}>
              {existing.length > 0 ? "Start another discussion" : "Start discussion"}
            </Button>
          </div>
        </form>
      ) : (
        <p className="mt-4 text-muted-foreground">Read only</p>
      )}
    </section>
  );
}

function ConversationRail({
  selectedId,
  threads,
  compact,
}: {
  selectedId: string | null;
  threads: ReadonlyMap<string, EnvironmentThreadShell>;
  /** Documents share the row; below xl the rail yields its width to the chat. */
  compact: boolean;
}) {
  const { environmentId, state, canWrite, showView } = useQuest();
  const { openConversation, busy } = useOpenQuestConversation();
  const core = state.conversations.find((item) => item.role === "core") ?? null;
  const coreThread = core ? (threads.get(core.threadId) ?? null) : null;
  const corePresence = useConversationPresence(environmentId, core, coreThread);
  const coreMissing = core !== null && corePresence.deleted;
  const others = state.conversations.filter((item) => item.role !== "core").toReversed();
  // Listed shells group immediately; unlisted ones resolve their own detail inside their row.
  const groupOf = (item: QuestConversation) => {
    const shell = threads.get(item.threadId);
    if (item.creation?.status === "reserved") return "active";
    if (!shell) return "older";
    return shell.settledOverride === "settled" ? "settled" : "active";
  };
  const active = others.filter((item) => groupOf(item) === "active");
  const settled = others.filter((item) => groupOf(item) === "settled");
  const older = others.filter((item) => groupOf(item) === "older");
  const row = (item: QuestConversation) => (
    <ConversationRow
      key={item.threadId}
      conversation={item}
      shell={threads.get(item.threadId) ?? null}
      isSelected={selectedId === item.threadId}
    />
  );
  return (
    <nav
      aria-label="Quest conversations"
      className={cn(
        "flex w-64 shrink-0 flex-col gap-4 overflow-y-auto border-r p-3",
        compact && "max-xl:hidden",
      )}
    >
      <section aria-label="Core conversation">
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Core
        </h3>
        {core && !coreMissing ? (
          <button
            type="button"
            aria-current={selectedId === core.threadId ? "page" : undefined}
            onClick={() => showView("conversation", { thread: core.threadId })}
            className={`flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent ${selectedId === core.threadId ? "bg-accent" : ""}`}
          >
            <CompassIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">Coordinate the Quest</span>
              <span className="block truncate text-xs text-muted-foreground">
                {corePresence.label}
              </span>
            </span>
          </button>
        ) : coreMissing ? (
          <div className="rounded border border-warning/40 p-2 text-xs">
            <p role="alert">The core conversation was deleted. Its identity stays in the Quest.</p>
            {canWrite ? <ReplaceCore /> : null}
          </div>
        ) : canWrite ? (
          <Button
            size="sm"
            variant="outline"
            className="w-full"
            disabled={busy}
            onClick={() =>
              void openConversation({
                role: "core",
                purposeKind: "coordinate",
                purpose: "",
                workId: null,
                questionId: null,
                resume: true,
              })
            }
          >
            Start the core conversation
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">No core conversation yet · Read only</p>
        )}
        {state.corePredecessors.length > 0 ? (
          <p className="mt-1 px-2 text-xs text-muted-foreground">
            {state.corePredecessors.length} earlier core
            {state.corePredecessors.length > 1 ? "s" : ""} retained
          </p>
        ) : null}
      </section>
      <section aria-label="Discussions">
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Discussions
          </h3>
          {canWrite && core && !coreMissing ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label="New discussion"
                    disabled={busy}
                    onClick={() =>
                      void openConversation({
                        role: "focused",
                        purposeKind: "digress",
                        purpose: "New discussion",
                        workId: null,
                        questionId: null,
                        resume: false,
                      })
                    }
                  />
                }
              >
                <PlusIcon aria-hidden />
              </TooltipTrigger>
              <TooltipPopup>New discussion</TooltipPopup>
            </Tooltip>
          ) : null}
        </div>
        {active.length > 0 ? (
          <ul>{active.map(row)}</ul>
        ) : (
          <p className="px-2 text-xs text-muted-foreground">
            Use Discuss on a work item or decision.
          </p>
        )}
      </section>
      {settled.length > 0 ? (
        <section aria-label="Settled discussions">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Settled · {settled.length}
          </h3>
          <ul>{settled.map(row)}</ul>
        </section>
      ) : null}
      {older.length > 0 ? (
        <section aria-label="Older discussions">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Older · {older.length}
          </h3>
          <ul>{older.map(row)}</ul>
        </section>
      ) : null}
    </nav>
  );
}

function ConversationRow({
  conversation: item,
  shell,
  isSelected,
}: {
  conversation: QuestConversation;
  shell: EnvironmentThreadShell | null;
  isSelected: boolean;
}) {
  const { environmentId, state, showView } = useQuest();
  const presence = useConversationPresence(environmentId, item, shell);
  const about = subjectTitle(state, item);
  return (
    <li>
      <button
        type="button"
        aria-current={isSelected ? "page" : undefined}
        onClick={() => showView("conversation", { thread: item.threadId })}
        className={`flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent ${isSelected ? "bg-accent" : ""}`}
      >
        {item.context === "fork" ? (
          <GitForkIcon aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <MessageSquareIcon
            aria-hidden
            className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
          />
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate">{item.purpose || shell?.title || item.title}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {purposeLabels[item.purposeKind]}
            {about ? ` · ${about}` : ""} · {presence.label}
          </span>
        </span>
      </button>
    </li>
  );
}

function ReplaceCore() {
  const { save } = useQuest();
  const [reason, setReason] = useState("");
  return (
    <form
      className="mt-2 grid gap-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        if (reason.trim()) void save({ type: "core-replace", reason });
      }}
    >
      <Input
        aria-label="Why replace the core"
        placeholder="Why replace it?"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />
      <Button type="submit" size="xs" variant="outline" disabled={!reason.trim()}>
        Retire and replace the core
      </Button>
    </form>
  );
}

function ConversationHeader({
  conversation,
  thread,
}: {
  conversation: QuestConversation;
  thread: EnvironmentThreadShell | null;
}) {
  const { environmentId, state, canWrite, pending, save, openPanel, showView } = useQuest();
  const [details, setDetails] = useState(false);
  const composerEmpty = useComposerDraftStore(
    (store) =>
      !store
        .getComposerDraft(scopeThreadRef(environmentId, conversation.threadId as ThreadId))
        ?.prompt.trim(),
  );
  // Another client, or a lost response, can open an unsent conversation without its context.
  const insertable =
    canWrite &&
    thread !== null &&
    thread.latestRun === null &&
    thread.latestUserMessageAt === null &&
    composerEmpty
      ? conversation.prepared
      : null;
  const [replacing, setReplacing] = useState(false);
  const work = state.work.find((item) => item.id === conversation.workId);
  const question = state.questions.find((item) => item.id === conversation.questionId);
  const origin = conversation.origin
    ? state.conversations.find((item) => item.threadId === conversation.origin?.threadId)
    : undefined;
  return (
    <div className="shrink-0 border-b px-4 py-1.5 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">
          {conversation.role === "core" ? "Core" : purposeLabels[conversation.purposeKind]}
        </Badge>
        {conversation.context === "fork" ? (
          <Badge variant="info">Provider fork</Badge>
        ) : conversation.context === "packet" && conversation.role === "focused" ? (
          <Badge variant="outline">Prepared context · not a fork</Badge>
        ) : null}
        {work || question ? (
          <button
            type="button"
            className="truncate text-muted-foreground underline"
            onClick={() =>
              openPanel(
                work ? { type: "work", id: work.id } : { type: "question", id: question!.id },
              )
            }
          >
            About {work?.title ?? question?.title}
          </button>
        ) : null}
        {conversation.sourceRevision !== null && conversation.sourceRevision !== state.revision ? (
          <span className="text-muted-foreground">
            Context from revision {conversation.sourceRevision}; the Quest is now at{" "}
            {state.revision}
          </span>
        ) : null}
        <span className="ms-auto flex items-center gap-1">
          {insertable ? (
            <Button
              size="xs"
              variant="ghost"
              title="Puts the subject, open decisions and pinned sources in the composer, unsent"
              onClick={() =>
                restorePreparedContext(environmentId, conversation.threadId, insertable)
              }
            >
              Insert prepared context
            </Button>
          ) : null}
          <Button size="xs" variant="ghost" onClick={() => setDetails((value) => !value)}>
            {details ? "Hide details" : "Details"}
          </Button>
          {canWrite && conversation.role !== "core" ? (
            <Button
              size="xs"
              variant="ghost"
              disabled={pending}
              title="The thread returns to its ordinary place in the sidebar"
              onClick={() =>
                void save({ type: "unlink", threadId: conversation.threadId }).then(
                  (ok) => ok && showView("conversation"),
                )
              }
            >
              Detach
            </Button>
          ) : null}
          {canWrite && conversation.role === "core" ? (
            <Button size="xs" variant="ghost" onClick={() => setReplacing((value) => !value)}>
              Replace core
            </Button>
          ) : null}
        </span>
      </div>
      {replacing ? <ReplaceCore /> : null}
      {details ? (
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt className="text-muted-foreground">Purpose</dt>
          <dd>{conversation.purpose || "Not recorded"}</dd>
          {origin || conversation.origin ? (
            <>
              <dt className="text-muted-foreground">Forked from</dt>
              <dd>
                {origin ? (
                  <button
                    type="button"
                    className="underline"
                    onClick={() => showView("conversation", { thread: origin.threadId })}
                  >
                    {origin.purpose || origin.title}
                  </button>
                ) : (
                  conversation.origin?.threadId
                )}
              </dd>
            </>
          ) : null}
          {conversation.creation ? (
            <>
              <dt className="text-muted-foreground">Requested model</dt>
              <dd>
                {conversation.creation.requested.modelSelection.model} (this client's default)
              </dd>
              <dt className="text-muted-foreground">Thread model</dt>
              <dd>
                {thread?.modelSelection.model ??
                  conversation.creation.effectiveModelSelection?.model ??
                  "Not created"}
              </dd>
            </>
          ) : null}
          <dt className="text-muted-foreground">Sources</dt>
          <dd>
            {conversation.sources.length === 0 ? (
              "None pinned"
            ) : (
              <ul>
                {conversation.sources.map((pin) => (
                  <PinRow key={pin.documentId} pin={pin} />
                ))}
              </ul>
            )}
          </dd>
        </dl>
      ) : null}
    </div>
  );
}

function PinRow({ pin }: { pin: QuestConversation["sources"][number] }) {
  const { environmentId, state, openDocument } = useQuest();
  const isFile = state.files.some((file) => file.id === pin.documentId);
  const canReadFiles = useEnvironmentScope(environmentId, AuthFilesystemReadScope);
  const current = useEnvironmentQuery(
    isFile && canReadFiles
      ? questEnvironment.document({ environmentId, input: { documentId: pin.documentId } })
      : null,
  ).data;
  const title =
    state.files.find((file) => file.id === pin.documentId)?.path ??
    state.documents.find((doc) => doc.id === pin.documentId)?.title ??
    pin.documentId;
  const changed = isFile && current?.sha256 && pin.sha256 && current.sha256 !== pin.sha256;
  return (
    <li>
      <button type="button" className="underline" onClick={() => openDocument(pin.documentId)}>
        {title}
      </button>{" "}
      {pin.sha256 ? (
        <span className="text-muted-foreground">
          <button
            type="button"
            className="underline"
            onClick={() => openDocument(pinnedTabId(pin.documentId, pin.sha256!))}
          >
            pinned {pin.sha256.slice(0, 10)}
          </button>
          {changed ? ` · file now ${current.sha256!.slice(0, 10)}` : ""}
        </span>
      ) : (
        <span className="text-warning-foreground">not retained: {pin.unavailable}</span>
      )}
    </li>
  );
}

export function QuestSelect({
  label,
  name,
  value,
  defaultValue,
  onChange,
  options,
}: {
  label: string;
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
}) {
  return (
    <Select
      name={name}
      value={value}
      defaultValue={defaultValue}
      items={options}
      onValueChange={(next) => {
        if (next !== null) onChange?.(next);
      }}
    >
      <SelectTrigger aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectPopup>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

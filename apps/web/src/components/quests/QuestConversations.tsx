import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type {
  ProjectId,
  QuestConversation,
  QuestState,
  ScopedProjectRef,
} from "@t3tools/contracts";
import { EllipsisIcon, PlusIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { useProjects, useQuietThreadShells } from "~/state/entities";
import type { ChatEmbedding } from "../ChatView.logic";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { toastManager } from "../ui/toast";
import { useQuest } from "./questContext";
import { rememberQuestConversation, useQuestDraftStore } from "./questDraftStore";
import { QUEST_TITLE, workStateLabels } from "./questModel";
import { QuestChat } from "./QuestChat";

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
  if (!thread) return "not sent yet";
  if (thread.archivedAt) return "archived";
  const status = thread.runtime?.status ?? "idle";
  if (status === "idle" || status === "completed") return "idle";
  if (["preparing", "queued", "starting", "running", "waiting"].includes(status))
    return "agent working";
  return status.replace("_", " ");
}

type About = { workId: string | null; questionId: string | null; title: string | null };

function parseAbout(state: QuestState, about: string | null): About {
  const [kind, id] = about?.split(":") ?? [];
  const work = kind === "work" ? state.work.find((item) => item.id === id) : undefined;
  if (work) return { workId: work.id, questionId: null, title: work.title };
  const question = kind === "question" ? state.questions.find((item) => item.id === id) : undefined;
  if (question) return { workId: null, questionId: question.id, title: question.title };
  return { workId: null, questionId: null, title: null };
}

function aboutValue(conversation: QuestConversation): string {
  if (conversation.workId) return `work:${conversation.workId}`;
  if (conversation.questionId) return `question:${conversation.questionId}`;
  return "";
}

/** Composer text for a new conversation; the user edits or discards it before anything is sent. */
function questConversationPrompt(state: QuestState, about: About): string {
  const work = state.work.find((item) => item.id === about.workId);
  const question = state.questions.find((item) => item.id === about.questionId);
  const lines = [`Quest: ${QUEST_TITLE} (historical example; do not resume the original work).`];
  if (work)
    lines.push(
      `About: ${work.title} (${workStateLabels[work.state].toLowerCase()})`,
      "",
      "Current understanding:",
      work.understanding,
    );
  if (question)
    lines.push(
      `Decision: ${question.title}`,
      "",
      question.context,
      "",
      "Alternatives:",
      ...question.alternatives.map((item) => `- ${item}`),
    );
  const sources = state.documents.filter((doc) =>
    (work ?? state.work.find((item) => item.id === question?.workId))?.documentIds.includes(doc.id),
  );
  if (sources.length > 0)
    lines.push("", `Sources in the Quest: ${sources.map((doc) => doc.title).join("; ")}`);
  return `${lines.join("\n")}\n\n`;
}

/**
 * The linked conversation to show: the route's, else the one last shown here, else the newest
 * about the requested item (none when nothing is about it yet), else the newest.
 */
function selectConversation(
  conversations: ReadonlyArray<QuestConversation>,
  thread: string | null,
  remembered: string | null,
  about: string | null,
): QuestConversation | null {
  const byId = (id: string | null) => conversations.find((item) => item.threadId === id) ?? null;
  if (thread) return byId(thread);
  if (about) return conversations.findLast((item) => aboutValue(item) === about) ?? null;
  return byId(remembered) ?? conversations.at(-1) ?? null;
}

export function QuestConversations({
  about: requestedAbout,
  thread,
}: {
  about: string | null;
  thread: string | null;
}) {
  const { environmentId, state, canWrite, pending, save, openPanel, showView } = useQuest();
  const handleNewThread = useNewThreadHandler();
  const projects = useProjects().filter((project) => project.environmentId === environmentId);
  const threads = useQuestConversationThreads();
  const remembered = useQuestDraftStore((store) => store.conversations[environmentId] ?? null);
  const [busy, setBusy] = useState(false);
  const selected = selectConversation(state.conversations, thread, remembered, requestedAbout);
  const [about, setAbout] = useState(requestedAbout ?? "");
  const [chosenProject, setProjectId] = useState("");
  const projectId = chosenProject || projects[0]?.id || "";
  const target = parseAbout(state, about);

  const selectedId = selected?.threadId ?? null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- records the shown conversation in the Quest store so a later visit without one in the route reopens it
  useEffect(() => {
    if (selectedId) rememberQuestConversation(environmentId, selectedId);
  }, [environmentId, selectedId]);

  function show(threadId: string) {
    showView("conversation", { thread: threadId });
  }

  /** Prepares a draft in the Quest's environment, links it and shows it; resolves whether it shows. */
  async function openConversation(
    projectRef: ScopedProjectRef,
    workspace?: Parameters<ChatEmbedding["openNewThread"]>[1],
  ): Promise<boolean> {
    if (projectRef.environmentId !== environmentId) return false;
    setBusy(true);
    const title = target.title ? `${QUEST_TITLE} · ${target.title}` : QUEST_TITLE;
    let result: Awaited<ReturnType<typeof handleNewThread>>;
    try {
      result = await handleNewThread(projectRef, {
        ...workspace,
        prompt: questConversationPrompt(state, target),
        navigate: false,
      });
    } catch (error) {
      setBusy(false);
      throw error;
    }
    // An unsent draft for this project is reused, and it may already be linked here.
    const linked =
      result !== null &&
      (state.conversations.some((item) => item.threadId === result.threadId) ||
        (await save({
          type: "link",
          threadId: result.threadId,
          projectId: projectRef.projectId,
          title,
          workId: target.workId,
          questionId: target.questionId,
        })));
    setBusy(false);
    if (result === null) return false;
    if (!linked) {
      toastManager.add({
        type: "error",
        title: "Could not link the conversation to the Quest",
        description: "Its draft is kept with the project's threads.",
      });
      return false;
    }
    show(result.threadId);
    return true;
  }

  function start() {
    if (busy || pending || !projectId) return;
    void openConversation(scopeProjectRef(environmentId, projectId as ProjectId));
  }

  const selectedWork = state.work.find((item) => item.id === selected?.workId);
  const selectedQuestion = state.questions.find((item) => item.id === selected?.questionId);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        role="toolbar"
        aria-label="Quest conversations"
        className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-1.5"
      >
        {state.conversations.length > 0 ? (
          <QuestSelect
            label="Conversation"
            value={selected?.threadId ?? ""}
            onChange={show}
            options={[
              ...(selected ? [] : [{ value: "", label: "Choose a conversation" }]),
              ...state.conversations.toReversed().map((item) => {
                const shell = threads.get(item.threadId) ?? null;
                return {
                  value: item.threadId,
                  label: `${shell?.title ?? item.title} · ${conversationStatusLabel(shell)}`,
                };
              }),
            ]}
          />
        ) : null}
        {selectedWork || selectedQuestion ? (
          <button
            type="button"
            className="truncate text-xs text-muted-foreground underline"
            onClick={() =>
              openPanel(
                selectedWork
                  ? { type: "work", id: selectedWork.id }
                  : { type: "question", id: selectedQuestion!.id },
              )
            }
          >
            About {selectedWork?.title ?? selectedQuestion?.title}
          </button>
        ) : null}
        <div className="ms-auto flex items-center gap-1">
          {canWrite ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy || pending || !projectId}
              onClick={start}
            >
              <PlusIcon aria-hidden />
              New conversation
            </Button>
          ) : null}
          {canWrite ? (
            <ConversationOptions
              about={about}
              onAbout={setAbout}
              projectId={projectId}
              onProject={setProjectId}
              projects={projects}
              selected={selected}
              onShow={show}
            />
          ) : null}
        </div>
      </div>
      {selected ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <QuestChat
            key={selected.threadId}
            environmentId={environmentId}
            threadId={selected.threadId}
            onNewConversation={openConversation}
          />
        </div>
      ) : thread ? (
        <div className="flex flex-col items-start gap-3 p-6 text-sm">
          <p role="alert">This conversation is no longer linked to the Quest.</p>
          <Button size="sm" variant="outline" onClick={() => showView("conversation")}>
            Show linked conversations
          </Button>
        </div>
      ) : (
        <div className="p-6 text-sm text-muted-foreground">
          <p>
            {target.title ? `No conversation about ${target.title} yet.` : "No conversations yet."}
          </p>
          {canWrite ? null : <p className="mt-1">Read only</p>}
        </div>
      )}
    </div>
  );
}

function ConversationOptions({
  about,
  onAbout,
  projectId,
  onProject,
  projects,
  selected,
  onShow,
}: {
  about: string;
  onAbout: (value: string) => void;
  projectId: string;
  onProject: (value: string) => void;
  projects: ReadonlyArray<{ id: string; title: string }>;
  selected: QuestConversation | null;
  onShow: (threadId: string) => void;
}) {
  const { environmentId, state, pending, save, showView } = useQuest();
  const shells = useQuietThreadShells();
  const [existing, setExisting] = useState("");
  const linked = new Set(state.conversations.map((item) => item.threadId));
  const linkable = shells
    .filter(
      (shell) =>
        shell.environmentId === environmentId && !linked.has(shell.id) && !shell.archivedAt,
    )
    .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 50);
  const target = parseAbout(state, about);

  async function link() {
    const shell = linkable.find((item) => item.id === existing);
    if (!shell) return;
    if (
      await save({
        type: "link",
        threadId: shell.id,
        projectId: shell.projectId,
        title: shell.title,
        workId: target.workId,
        questionId: target.questionId,
      })
    ) {
      setExisting("");
      onShow(shell.id);
    }
  }

  async function unlink() {
    if (!selected) return;
    if (await save({ type: "unlink", threadId: selected.threadId })) showView("conversation");
  }

  return (
    <Popover>
      <PopoverTrigger
        render={<Button size="icon-sm" variant="ghost" aria-label="Conversation options" />}
      >
        <EllipsisIcon aria-hidden />
      </PopoverTrigger>
      <PopoverPopup align="end" width="md">
        <div className="grid gap-3 text-sm">
          <label>
            <span className="mb-1 block text-xs text-muted-foreground">New conversation about</span>
            <QuestSelect
              label="New conversation about"
              value={about}
              onChange={onAbout}
              options={[
                { value: "", label: "The whole Quest" },
                ...state.questions.map((item) => ({
                  value: `question:${item.id}`,
                  label: `Decision · ${item.title}`,
                })),
                ...state.work.map((item) => ({ value: `work:${item.id}`, label: item.title })),
              ]}
            />
          </label>
          {projects.length > 1 ? (
            <label>
              <span className="mb-1 block text-xs text-muted-foreground">Project</span>
              <QuestSelect
                label="Project"
                value={projectId}
                onChange={onProject}
                options={projects.map((project) => ({ value: project.id, label: project.title }))}
              />
            </label>
          ) : null}
          <div className="flex items-end gap-2 border-t pt-3">
            <label className="min-w-0 flex-1">
              <span className="mb-1 block text-xs text-muted-foreground">Link a thread</span>
              <QuestSelect
                label="Existing thread"
                value={existing}
                onChange={setExisting}
                options={[
                  { value: "", label: linkable.length ? "Choose a thread" : "No other threads" },
                  ...linkable.map((shell) => ({ value: shell.id, label: shell.title })),
                ]}
              />
            </label>
            <Button variant="outline" disabled={!existing || pending} onClick={() => void link()}>
              Link
            </Button>
          </div>
          {selected ? (
            <Button variant="ghost" disabled={pending} onClick={() => void unlink()}>
              Remove “{selected.title}” from Quest
            </Button>
          ) : null}
        </div>
      </PopoverPopup>
    </Popover>
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

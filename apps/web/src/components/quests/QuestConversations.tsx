import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { ProjectId, QuestConversation, QuestState, ThreadId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { MessageSquareIcon } from "lucide-react";
import { useState } from "react";

import { useComposerDraftStore } from "~/composerDraftStore";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { useProjects, useQuietThreadShells } from "~/state/entities";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { toastManager } from "../ui/toast";
import { useQuest } from "./questContext";
import { QUEST_TITLE, workStateLabels } from "./questModel";

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

export function QuestConversations({ about: initialAbout }: { about: string | null }) {
  const { environmentId, state, canWrite, pending, save, openPanel } = useQuest();
  const navigate = useNavigate();
  const handleNewThread = useNewThreadHandler();
  const projects = useProjects().filter((project) => project.environmentId === environmentId);
  const shells = useQuietThreadShells();
  const threads = useQuestConversationThreads();
  const draftIdFor = useComposerDraftStore((store) => store.getDraftIdByRef);
  const [about, setAbout] = useState(initialAbout ?? "");
  const [chosenProject, setProjectId] = useState("");
  const projectId = chosenProject || projects[0]?.id || "";
  const [existing, setExisting] = useState("");
  const [busy, setBusy] = useState(false);
  const target = parseAbout(state, about);
  const linked = new Set(state.conversations.map((item) => item.threadId));
  const linkable = shells
    .filter(
      (shell) =>
        shell.environmentId === environmentId && !linked.has(shell.id) && !shell.archivedAt,
    )
    .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 50);
  const aboutOptions = [
    { value: "", label: "The whole Quest" },
    ...state.questions.map((item) => ({
      value: `question:${item.id}`,
      label: `Decision · ${item.title}`,
    })),
    ...state.work.map((item) => ({ value: `work:${item.id}`, label: item.title })),
  ];

  function open(conversation: QuestConversation) {
    const ref = scopeThreadRef(environmentId, conversation.threadId as ThreadId);
    if (threads.has(conversation.threadId)) {
      void navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId, threadId: ref.threadId },
      });
      return;
    }
    const draftId = draftIdFor(ref);
    if (draftId) void navigate({ to: "/draft/$draftId", params: { draftId } });
  }

  async function start() {
    if (busy || !projectId) return;
    setBusy(true);
    const title = target.title ? `${QUEST_TITLE} · ${target.title}` : QUEST_TITLE;
    const result = await handleNewThread(scopeProjectRef(environmentId, projectId as ProjectId), {
      prompt: questConversationPrompt(state, target),
    });
    setBusy(false);
    if (!result) return;
    const linkedOk = await save({
      type: "link",
      threadId: result.threadId,
      projectId,
      title,
      workId: target.workId,
      questionId: target.questionId,
    });
    if (!linkedOk)
      toastManager.add({
        type: "error",
        title: "The conversation opened but was not linked to the Quest",
        description: "Link it from the Quest’s Conversation view.",
      });
  }

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
    )
      setExisting("");
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-6">
      <section aria-label="Linked conversations">
        <h2 className="mb-2 text-sm font-semibold">Linked conversations</h2>
        {state.conversations.length === 0 ? (
          <p className="text-sm text-muted-foreground">No linked conversations.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {state.conversations.map((conversation) => {
              const thread = threads.get(conversation.threadId) ?? null;
              const draft =
                !thread &&
                draftIdFor(scopeThreadRef(environmentId, conversation.threadId as ThreadId));
              const aboutWork = state.work.find((item) => item.id === conversation.workId);
              const aboutQuestion = state.questions.find(
                (item) => item.id === conversation.questionId,
              );
              return (
                <li
                  key={conversation.threadId}
                  className="flex flex-wrap items-center gap-3 px-3 py-2.5"
                >
                  <MessageSquareIcon
                    aria-hidden
                    className="size-4 shrink-0 text-muted-foreground"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {thread?.title ?? conversation.title}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {thread || draft
                        ? conversationStatusLabel(thread)
                        : "not available on this client"}
                      {aboutWork || aboutQuestion ? " · about " : ""}
                      {aboutWork ? (
                        <button
                          type="button"
                          className="underline"
                          onClick={() => openPanel({ type: "work", id: aboutWork.id })}
                        >
                          {aboutWork.title}
                        </button>
                      ) : aboutQuestion ? (
                        <button
                          type="button"
                          className="underline"
                          onClick={() => openPanel({ type: "question", id: aboutQuestion.id })}
                        >
                          {aboutQuestion.title}
                        </button>
                      ) : null}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!thread && !draft}
                    onClick={() => open(conversation)}
                  >
                    Open
                  </Button>
                  {canWrite ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => void save({ type: "unlink", threadId: conversation.threadId })}
                    >
                      Remove from Quest
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {canWrite ? (
        <section aria-label="Start or link a conversation" className="mt-8 rounded-lg border p-4">
          <h2 className="text-sm font-semibold">Discuss</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block text-xs text-muted-foreground">About</span>
              <QuestSelect label="About" value={about} onChange={setAbout} options={aboutOptions} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-muted-foreground">
                Project for a new thread
              </span>
              <QuestSelect
                label="Project for a new thread"
                value={projectId}
                onChange={setProjectId}
                options={projects.map((project) => ({ value: project.id, label: project.title }))}
              />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button disabled={busy || pending || !projectId} onClick={() => void start()}>
              New conversation
            </Button>
          </div>
          <div className="mt-5 flex flex-wrap items-end gap-2 border-t pt-4">
            <label className="min-w-60 flex-1 text-sm">
              <span className="mb-1 block text-xs text-muted-foreground">
                Or link an existing thread
              </span>
              <QuestSelect
                label="Existing thread"
                value={existing}
                onChange={setExisting}
                options={[
                  {
                    value: "",
                    label: linkable.length ? "Choose a thread" : "No other threads here",
                  },
                  ...linkable.map((shell) => ({ value: shell.id, label: shell.title })),
                ]}
              />
            </label>
            <Button variant="outline" disabled={!existing || pending} onClick={() => void link()}>
              Link thread
            </Button>
          </div>
        </section>
      ) : (
        <p className="mt-6 text-sm text-muted-foreground">Read only</p>
      )}
    </div>
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

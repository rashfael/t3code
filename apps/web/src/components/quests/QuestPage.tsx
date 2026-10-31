import { useAtomValue } from "@effect/atom-react";
import { createQuestEnvironmentAtoms } from "@t3tools/client-runtime/state/quests";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, QuestState } from "@t3tools/contracts";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { CompassIcon, HistoryIcon, ListChecksIcon, RotateCcwIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { connectionAtomRuntime } from "~/connection/runtime";
import { useEnvironments, usePrimaryEnvironmentId } from "~/state/environments";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { cn } from "~/lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SidebarInset, SidebarTrigger } from "../ui/sidebar";
import {
  QuestWorkspace,
  type PanelEntry,
  type QuestChange,
  type QuestSearch,
  type QuestView,
} from "./questContext";
import { rememberQuestConversations } from "./questConversationIndex";
import { QUEST_TITLE, questionsByStatus } from "./questModel";
import { QuestConversations } from "./QuestConversations";
import { QuestOverview } from "./QuestOverview";
import { QuestPanel } from "./QuestPanel";
import { QuestWorkMap } from "./QuestWorkMap";

const questEnvironment = createQuestEnvironmentAtoms(connectionAtomRuntime);

const VIEWS: ReadonlyArray<{ value: QuestView; label: string }> = [
  { value: "overview", label: "Overview" },
  { value: "conversation", label: "Conversation" },
  { value: "map", label: "Work map" },
];

function readSearch(raw: Record<string, unknown>): QuestSearch {
  const text = (value: unknown) => (typeof value === "string" && value ? value : undefined);
  const view = VIEWS.find((candidate) => candidate.value === raw.view)?.value;
  const work = text(raw.work);
  const question = text(raw.question);
  const about = text(raw.about);
  return {
    ...(view ? { view } : {}),
    ...(work ? { work } : {}),
    ...(question ? { question } : {}),
    ...(about ? { about } : {}),
  };
}

export function QuestPage() {
  const primaryId = usePrimaryEnvironmentId();
  const { environments } = useEnvironments();
  const [selectedEnvironment, setSelectedEnvironment] = useState<EnvironmentId | null>(null);
  const environmentId = selectedEnvironment ?? primaryId;
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden" aria-label="Quest workspace">
      {environmentId ? (
        <QuestLoader
          key={environmentId}
          environmentId={environmentId}
          environmentPicker={
            environments.length > 1 ? (
              <Select
                value={environmentId}
                items={environments.map((environment) => ({
                  value: environment.environmentId,
                  label: environment.label,
                }))}
                onValueChange={(next) => {
                  if (next !== null) setSelectedEnvironment(next as EnvironmentId);
                }}
              >
                <SelectTrigger size="sm" aria-label="Environment">
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  {environments.map((environment) => (
                    <SelectItem key={environment.environmentId} value={environment.environmentId}>
                      {environment.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            ) : null
          }
        />
      ) : (
        <p className="p-6">Connect an environment to open its Quest example.</p>
      )}
    </SidebarInset>
  );
}

function QuestLoader({
  environmentId,
  environmentPicker,
}: {
  environmentId: EnvironmentId;
  environmentPicker: React.ReactNode;
}) {
  const query = useEnvironmentQuery(questEnvironment.get({ environmentId, input: {} }));
  if (!query.data)
    return (
      <div className="p-6">
        <p role={query.error ? "alert" : "status"}>{query.error ?? "Loading the Quest…"}</p>
        {query.error ? <Button onClick={query.refresh}>Try again</Button> : null}
      </div>
    );
  return (
    <QuestWorkspaceView
      environmentId={environmentId}
      initial={query.data}
      environmentPicker={environmentPicker}
    />
  );
}

function initialPanel(search: QuestSearch): ReadonlyArray<PanelEntry> {
  if (search.question) return [{ type: "question", id: search.question }];
  if (search.work) return [{ type: "work", id: search.work }];
  return [];
}

function QuestWorkspaceView({
  environmentId,
  initial,
  environmentPicker,
}: {
  environmentId: EnvironmentId;
  initial: QuestState;
  environmentPicker: React.ReactNode;
}) {
  const search = readSearch(useSearch({ strict: false }) as Record<string, unknown>);
  const navigate = useNavigate();
  const view = search.view ?? "overview";
  const [state, setState] = useState(initial);
  const [panel, setPanel] = useState<ReadonlyArray<PanelEntry>>(() => initialPanel(search));
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const [epoch, setEpoch] = useState(0);
  const pendingRef = useRef(false);
  const canWrite = useAtomValue(questEnvironment.update.permissionAtom(environmentId));
  const update = useAtomCommand(questEnvironment.update, { reportFailure: false });
  const read = useAtomCommand(questEnvironment.read, { reportFailure: false });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- copies the server's conversation links to localStorage for the thread route's Quest bar
  useEffect(() => {
    rememberQuestConversations(environmentId, state);
  }, [environmentId, state]);

  async function save(change: QuestChange) {
    if (pendingRef.current) return false;
    pendingRef.current = true;
    setPending(true);
    setNotice("");
    const result = await update({
      environmentId,
      input: { expectedRevision: state.revision, change },
    });
    pendingRef.current = false;
    setPending(false);
    if (result._tag !== "Success") {
      const error = squashAtomCommandFailure(result);
      setNotice(
        error instanceof Error
          ? error.message
          : "Save failed. The draft remains here; reload the saved version before retrying a conflict.",
      );
      return false;
    }
    setState(result.value);
    // A link saved while the thread route is opening must still reach the Quest bar.
    rememberQuestConversations(environmentId, result.value);
    setNotice(`Saved · revision ${result.value.revision}`);
    return true;
  }

  async function reload() {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    const result = await read({ environmentId, input: {} });
    pendingRef.current = false;
    setPending(false);
    if (result._tag === "Success") {
      setState(result.value);
      setEpoch((value) => value + 1);
      setNotice("Saved version loaded. Unsaved drafts were discarded.");
    } else setNotice("Could not reload. Your current draft has been kept.");
  }

  function showView(next: QuestView, extra: Omit<QuestSearch, "view"> = {}) {
    void navigate({ to: "/quests", search: { view: next, ...extra } });
  }

  function openPanel(entry: PanelEntry, mode: "push" | "replace" = "replace") {
    setPanel((stack) => (mode === "push" ? [...stack, entry] : [entry]));
  }

  const decisions = questionsByStatus(state.questions);
  const waitingDecisions = decisions.open.length + decisions.recorded.length;
  const current = panel.at(-1) ?? null;
  return (
    <QuestWorkspace value={{ environmentId, state, canWrite, pending, save, openPanel, showView }}>
      <header className="border-b px-4 pt-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="md:hidden">
            <SidebarTrigger />
          </div>
          <CompassIcon aria-hidden className="size-5 shrink-0" />
          <h1 className="text-base font-semibold">{QUEST_TITLE}</h1>
          <Badge variant="outline">Historical example</Badge>
          <div className="ms-auto flex flex-wrap items-center gap-1.5">
            <Button
              size="sm"
              variant={current?.type === "decisions" ? "secondary" : "ghost"}
              onClick={() => openPanel({ type: "decisions" })}
            >
              <ListChecksIcon aria-hidden />
              Decisions
              {waitingDecisions > 0 ? (
                <Badge variant="warning" size="sm">
                  {waitingDecisions}
                </Badge>
              ) : null}
            </Button>
            <Button
              size="sm"
              variant={current?.type === "history" ? "secondary" : "ghost"}
              onClick={() => openPanel({ type: "history" })}
            >
              <HistoryIcon aria-hidden />
              History
            </Button>
            {environmentPicker}
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => void reload()}
              title="Reload the saved version and discard unsaved drafts"
            >
              <RotateCcwIcon aria-hidden />
              Reload saved
            </Button>
          </div>
        </div>
        <nav className="mt-2 flex gap-1" aria-label="Quest views">
          {VIEWS.map((item) => (
            <button
              key={item.value}
              type="button"
              aria-current={view === item.value ? "page" : undefined}
              onClick={() => showView(item.value)}
              className={cn(
                "-mb-px border-b-2 px-3 pb-2 text-sm",
                view === item.value
                  ? "border-primary font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {item.label}
              {item.value === "conversation" && state.conversations.length > 0 ? (
                <span className="ms-1.5 text-xs tabular-nums text-muted-foreground">
                  {state.conversations.length}
                </span>
              ) : null}
            </button>
          ))}
        </nav>
      </header>
      <div className="relative flex min-h-0 flex-1">
        <div key={epoch} className="min-w-0 flex-1 overflow-y-auto">
          {view === "map" ? (
            <QuestWorkMap
              key={search.work ?? ""}
              selectedId={current?.type === "work" ? current.id : (search.work ?? null)}
              initialFocus={search.work ?? null}
            />
          ) : view === "conversation" ? (
            <QuestConversations about={search.about ?? null} />
          ) : (
            <QuestOverview />
          )}
        </div>
        {current ? (
          <aside
            aria-label="Quest details"
            className="absolute inset-0 z-20 flex min-h-0 flex-col bg-background lg:static lg:w-[30rem] lg:shrink-0 lg:border-l"
          >
            <QuestPanel
              key={`${JSON.stringify(current)}:${state.revision}:${epoch}`}
              entry={current}
              canGoBack={panel.length > 1}
              onBack={() => setPanel((stack) => stack.slice(0, -1))}
              onClose={() => setPanel([])}
            />
          </aside>
        ) : null}
      </div>
      <footer className="border-t px-4 py-2 text-xs text-muted-foreground">
        <p role="status" aria-live="polite">
          {pending
            ? "Saving / loading…"
            : notice ||
              `Saved revision ${state.revision} · no provider runs or changes to the original records`}
        </p>
        {canWrite ? null : (
          <p className="mt-1">
            This connection can read the Quest. Saving changes needs write access.
          </p>
        )}
      </footer>
    </QuestWorkspace>
  );
}

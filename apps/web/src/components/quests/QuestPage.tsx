import { useAtomValue } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, QuestState, QuestUpdateInput } from "@t3tools/contracts";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Columns2Icon, CompassIcon, RotateCcwIcon } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";

import { useEnvironments, usePrimaryEnvironmentId } from "~/state/environments";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { cn, randomUUID } from "~/lib/utils";
import { FileSurfaceAction, FileSurfaceLoading } from "../files/fileSurfaceChrome";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SidebarInset, SidebarTrigger } from "../ui/sidebar";
import {
  parseQuestSearch,
  QuestWorkspace,
  type PanelEntry,
  type QuestChange,
  type QuestSearch,
  type QuestView,
} from "./questContext";
import {
  clearQuestDrafts,
  openQuestDocumentTab,
  readQuestPanel,
  readQuestView,
  rememberQuestPanel,
  rememberQuestView,
  showQuestDocumentsBeside,
  useQuestDocumentTabs,
} from "./questDraftStore";
import { questEnvironment } from "./questEnvironment";
import { QUEST_TITLE, questionsByStatus } from "./questModel";
import { QuestConversations } from "./QuestConversations";
import { QuestOverview } from "./QuestOverview";
import { DecisionList, HistoryList, QuestPanel } from "./QuestPanel";
import { QuestWorkMap } from "./QuestWorkMap";

// The document workspace loads with the first Documents view or split.
const QuestDocumentsView = lazy(() =>
  import("./QuestDocumentWorkspace").then((module) => ({ default: module.QuestDocumentsView })),
);
const QuestDocumentsBeside = lazy(() =>
  import("./QuestDocumentWorkspace").then((module) => ({ default: module.QuestDocumentsBeside })),
);

const VIEWS: ReadonlyArray<{ value: QuestView; label: string }> = [
  { value: "overview", label: "Overview" },
  { value: "conversation", label: "Conversation" },
  { value: "map", label: "Work map" },
  { value: "decisions", label: "Decisions" },
  { value: "documents", label: "Documents" },
  { value: "history", label: "History" },
];

/** The view a route shows: its own, else the remembered one when it names nothing else. */
function resolveView(environmentId: EnvironmentId, search: QuestSearch): QuestView {
  if (search.view) return search.view;
  const { env: _env, ...rest } = search;
  if (Object.keys(rest).length > 0) return "overview";
  return readQuestView(environmentId) ?? "overview";
}

function useQuestSearch(): QuestSearch {
  return parseQuestSearch(useSearch({ strict: false }) as Record<string, unknown>);
}

export function QuestPage() {
  const primaryId = usePrimaryEnvironmentId();
  const { environments } = useEnvironments();
  const search = useQuestSearch();
  const navigate = useNavigate();
  // The route names its environment, so returning from a thread reopens the same one.
  const environmentId = (search.env as EnvironmentId | undefined) ?? primaryId;
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
                  if (next !== null)
                    void navigate({
                      to: "/quests",
                      search: { env: next, ...(search.view ? { view: search.view } : {}) },
                    });
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

function initialPanel(
  environmentId: EnvironmentId,
  search: QuestSearch,
): ReadonlyArray<PanelEntry> {
  if (search.question) return [{ type: "question", id: search.question }];
  if (search.work) return [{ type: "work", id: search.work }];
  return readQuestPanel(environmentId);
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
  const search = useQuestSearch();
  const navigate = useNavigate();
  const view = resolveView(environmentId, search);
  const documentTabs = useQuestDocumentTabs(environmentId);
  const [state, setState] = useState(initial);
  const [panel, setPanelState] = useState(() => initialPanel(environmentId, search));
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const [epoch, setEpoch] = useState(0);
  const pendingRef = useRef(false);
  const canWrite = useAtomValue(questEnvironment.update.permissionAtom(environmentId));
  const update = useAtomCommand(questEnvironment.update, { reportFailure: false });
  const read = useAtomCommand(questEnvironment.read, { reportFailure: false });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- records the shown view in the Quest store so returning to the bare Quest route reopens it
  useEffect(() => rememberQuestView(environmentId, view), [environmentId, view]);

  function setPanel(next: ReadonlyArray<PanelEntry>) {
    setPanelState(next);
    rememberQuestPanel(environmentId, next);
  }

  function adopt(next: QuestState) {
    setState((current) => (next.revision >= current.revision ? next : current));
  }

  async function save(change: QuestChange, source?: QuestUpdateInput["source"]) {
    if (pendingRef.current) return false;
    pendingRef.current = true;
    setPending(true);
    setNotice("");
    const result = await update({
      environmentId,
      input: {
        expectedRevision: state.revision,
        operationId: randomUUID(),
        change,
        ...(source ? { source } : {}),
      },
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
      clearQuestDrafts(environmentId);
      setState(result.value);
      setEpoch((value) => value + 1);
      setNotice("Reloaded. Unsaved drafts discarded.");
    } else setNotice("Could not reload. Your current draft has been kept.");
  }

  function showView(next: QuestView, extra: Omit<QuestSearch, "view" | "env"> = {}) {
    void navigate({ to: "/quests", search: { env: environmentId, view: next, ...extra } });
  }

  function openPanel(entry: PanelEntry, mode: "push" | "replace" = "replace") {
    setPanel(mode === "push" ? [...panel, entry] : [entry]);
  }

  function openDocument(tabId: string) {
    if (view === "conversation") return openQuestDocumentTab(environmentId, tabId, true);
    openQuestDocumentTab(environmentId, tabId, false);
    if (view !== "documents") showView("documents");
  }

  const decisions = questionsByStatus(state.questions);
  const waitingDecisions = decisions.open.length + decisions.recorded.length;
  const current = panel.at(-1) ?? null;
  return (
    <QuestWorkspace
      value={{
        environmentId,
        state,
        canWrite,
        pending,
        save,
        adopt,
        openPanel,
        showView,
        openDocument,
      }}
    >
      <header className="border-b px-4 pt-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="md:hidden">
            <SidebarTrigger />
          </div>
          <CompassIcon aria-hidden className="size-5 shrink-0" />
          <h1 className="text-base font-semibold">{QUEST_TITLE}</h1>
          <Badge variant="outline">Historical example</Badge>
          <div className="ms-auto flex flex-wrap items-center gap-1.5">
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
        <div className="mt-2 flex items-end gap-2">
          <nav className="flex min-w-0 flex-1 gap-1 overflow-x-auto" aria-label="Quest views">
            {VIEWS.map((item) => (
              <button
                key={item.value}
                type="button"
                aria-current={view === item.value ? "page" : undefined}
                onClick={() => showView(item.value)}
                className={cn(
                  "-mb-px shrink-0 cursor-pointer border-b-2 px-3 pb-2 text-sm",
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
                {item.value === "decisions" && waitingDecisions > 0 ? (
                  <Badge className="ms-1.5" variant="warning" size="sm">
                    {waitingDecisions}
                  </Badge>
                ) : null}
                {item.value === "documents" && state.pendingWrites.length > 0 ? (
                  <Badge className="ms-1.5" variant="warning" size="sm">
                    {state.pendingWrites.length}
                  </Badge>
                ) : null}
              </button>
            ))}
          </nav>
          {view === "conversation" ? (
            <span className="mb-1">
              <FileSurfaceAction
                label="Documents beside the conversation"
                pressed={documentTabs.beside}
                onPress={() => showQuestDocumentsBeside(environmentId, !documentTabs.beside)}
              >
                <Columns2Icon className="size-3.5" />
              </FileSurfaceAction>
            </span>
          ) : null}
        </div>
      </header>
      <div className="relative flex min-h-0 flex-1">
        <div
          key={epoch}
          className={cn(
            "min-w-0 flex-1",
            view === "overview"
              ? "overflow-y-auto"
              : view === "map"
                ? "overflow-hidden"
                : "flex flex-col overflow-hidden",
          )}
        >
          {view === "map" ? (
            <QuestWorkMap
              key={search.work ?? ""}
              selectedId={current?.type === "work" ? current.id : (search.work ?? null)}
              initialFocus={search.work ?? null}
            />
          ) : view === "conversation" ? (
            <QuestConversations
              about={search.about ?? null}
              thread={search.thread ?? null}
              beside={
                documentTabs.beside ? (
                  <Suspense fallback={null}>
                    <QuestDocumentsBeside />
                  </Suspense>
                ) : null
              }
            />
          ) : view === "documents" ? (
            <Suspense fallback={<FileSurfaceLoading />}>
              <QuestDocumentsView />
            </Suspense>
          ) : view === "decisions" ? (
            <div className="scrollbar-gutter-both overflow-y-auto">
              <div className="mx-auto max-w-3xl px-6 py-5">
                <DecisionList />
              </div>
            </div>
          ) : view === "history" ? (
            <div className="scrollbar-gutter-both overflow-y-auto">
              <div className="mx-auto max-w-3xl px-6 py-5">
                <HistoryList />
              </div>
            </div>
          ) : (
            <QuestOverview selectedWorkId={current?.type === "work" ? current.id : null} />
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
              onBack={() => setPanel(panel.slice(0, -1))}
              onClose={() => setPanel([])}
            />
          </aside>
        ) : null}
      </div>
      <footer className="border-t px-4 py-2 text-xs text-muted-foreground">
        <p role="status" aria-live="polite">
          {pending ? "Saving…" : notice || `Revision ${state.revision}`}
          {canWrite ? null : " · Read only"}
        </p>
      </footer>
    </QuestWorkspace>
  );
}

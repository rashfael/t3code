import { useAtomValue } from "@effect/atom-react";
import { parseDiffFromFile } from "@pierre/diffs";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  AuthFilesystemReadScope,
  type QuestDocument,
  type QuestFile,
  type QuestPendingWrite,
  type QuestState,
  type QuestWriteResult,
} from "@t3tools/contracts";
import { maskMarkdownFrontmatter } from "@t3tools/shared/markdownFrontmatter";
import { Code2, Eye } from "lucide";
import {
  ArrowLeftIcon,
  ChevronRightIcon,
  Columns2Icon,
  DiffIcon,
  FolderIcon,
  InfoIcon,
  Maximize2Icon,
  Minimize2Icon,
  PanelLeftIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  XIcon,
} from "lucide-react";
import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";

import { useMediaQuery } from "~/hooks/useMediaQuery";
import { useRenderedAppearance } from "~/hooks/useTheme";
import { resolveDiffThemeName } from "~/lib/diffRendering";
import { PREFERRED_HIGHLIGHTER } from "~/lib/syntaxHighlighting";
import { cn, randomUUID } from "~/lib/utils";
import { primaryServerKeybindingsAtom } from "~/state/server";
import { useEnvironmentQuery } from "~/state/query";
import { useEnvironmentScope } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";
import { PierreEntryIcon } from "../chat/PierreEntryIcon";
import { CommandPaletteContent } from "../CommandPaletteContent";
import type { CommandPaletteActionItem } from "../CommandPalette.logic";
import { CommandPaletteResults } from "../CommandPaletteResults";
import { StyledDiffCodeView } from "../diffs/StyledDiffCodeView";
import {
  FILE_SURFACE_SUBHEADER_CLASS,
  FileSurfaceAction,
  FileSurfaceLoading,
  FileSurfaceNotice,
} from "../files/fileSurfaceChrome";
import { MorphIcon } from "../MorphIcon";
import { PreviewPanelShell } from "../preview/PreviewPanelShell";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { CommandDialog, CommandDialogPopup, CommandFooterAction } from "../ui/command";
import { Input } from "../ui/input";
import { PanelTabCloseButton } from "../ui/panel-tab-close-button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useQuest } from "./questContext";
import {
  closeQuestDocumentTab,
  draftText,
  openQuestDocumentTab,
  readerPosition,
  selectQuestDocumentVersion,
  showQuestDocumentsBeside,
  showQuestDocumentsFull,
  useQuestComparison,
  useQuestDocumentTabs,
  useQuestDraft,
  useQuestDraftStore,
  useQuestReaderMode,
} from "./questDraftStore";
import { questEnvironment } from "./questEnvironment";
import { QuestMarkdown } from "./QuestMarkdown";

// T3's source view and editor load on demand, as they do in its file panel.
const ReadOnlySourcePreview = lazy(() => import("../files/ReadOnlySourcePreview"));
const QuestSourceEditor = lazy(() => import("./QuestSourceEditor"));

function failureText(result: { readonly _tag: string }) {
  const error = squashAtomCommandFailure(result as never);
  return error instanceof Error ? error.message : "The request failed.";
}

const outcomeText: Record<QuestWriteResult["outcome"], string> = {
  saved: "Saved to the file.",
  pending:
    "The save is unfinished: its intent is kept, but the file or the Quest record is not up to date. Recover it below.",
  conflict:
    "The file changed outside T3 Code. Nothing was overwritten; your draft is kept here and in the Quest.",
};

type QuestEntry =
  | { readonly kind: "file"; readonly id: string; readonly title: string; readonly file: QuestFile }
  | {
      readonly kind: "record";
      readonly id: string;
      readonly title: string;
      readonly document: QuestDocument;
    };

function findEntry(state: QuestState, id: string): QuestEntry | null {
  const file = state.files.find((item) => item.id === id);
  if (file) return { kind: "file", id, title: file.title, file };
  const document = state.documents.find((item) => item.id === id);
  return document ? { kind: "record", id, title: document.title, document } : null;
}

/** A file's path below the Quest folder; records and files elsewhere sit at the root. */
function relativePath(state: QuestState, entry: QuestEntry): string | null {
  if (entry.kind !== "file") return null;
  const root = state.workspace?.root.replace(/\/+$/, "");
  const path = entry.file.path;
  if (!path.startsWith("/")) return path;
  return root && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : null;
}

function entryIconPath(state: QuestState, entry: QuestEntry) {
  return entry.kind === "file" ? entry.file.path : `${entry.title}.md`;
}

interface Pin {
  readonly sha256: string;
  readonly label: string;
  readonly capturedAt: string;
}

/** Retained versions conversations pinned, newest first; one equal to a record's own text is no choice. */
function documentPins(state: QuestState, entry: QuestEntry): ReadonlyArray<Pin> {
  const pins = new Map<string, Pin>();
  for (const conversation of state.conversations.toReversed())
    for (const pin of conversation.sources) {
      if (pin.documentId !== entry.id || !pin.sha256 || pins.has(pin.sha256)) continue;
      if (entry.kind === "record" && entry.document.sha256 === pin.sha256) continue;
      const purpose =
        conversation.role === "core"
          ? "Coordinate the Quest"
          : conversation.purpose || conversation.title;
      pins.set(pin.sha256, {
        sha256: pin.sha256,
        label: `Pinned for ${purpose}`,
        capturedAt: pin.capturedAt,
      });
    }
  return [...pins.values()];
}

function useHasDraft(id: string) {
  const { environmentId } = useQuest();
  return useQuestDraftStore(
    (store) =>
      store.drafts[`${environmentId}|file:${id}`] !== undefined ||
      store.drafts[`${environmentId}|document:${id}`] !== undefined,
  );
}

/** The Documents view: the folder tree beside the open documents. */
export function QuestDocumentsView() {
  const { environmentId } = useQuest();
  const tabs = useQuestDocumentTabs(environmentId);
  const narrow = useMediaQuery("max-lg");
  const [treeOpen, setTreeOpen] = useState<boolean | null>(null);
  // Narrow layouts give the reader the width; the tree comes back on request.
  const showTree = treeOpen ?? (!narrow || tabs.open.length === 0);
  return (
    <div className="relative flex min-h-0 flex-1">
      {showTree ? (
        <nav
          aria-label="Quest documents"
          className={cn(
            "flex w-64 shrink-0 flex-col overflow-y-auto border-r",
            narrow && "absolute inset-y-0 start-0 z-10 w-full bg-background",
          )}
        >
          <DocumentTree
            onOpened={() => {
              if (narrow) setTreeOpen(false);
            }}
            onHide={tabs.open.length > 0 ? () => setTreeOpen(false) : null}
          />
        </nav>
      ) : null}
      <QuestDocumentTabs
        placement="documents"
        leading={
          showTree ? null : (
            <FileSurfaceAction label="Show documents" onPress={() => setTreeOpen(true)}>
              <PanelLeftIcon className="size-3.5" />
            </FileSurfaceAction>
          )
        }
      />
    </div>
  );
}

/** Open documents beside the conversation: a resizable pane, or the full width when narrow. */
export function QuestDocumentsBeside({ narrow }: { narrow: boolean }) {
  const { environmentId } = useQuest();
  const tabs = useQuestDocumentTabs(environmentId);
  if (narrow)
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <QuestDocumentTabs placement="beside" narrow />
      </div>
    );
  return (
    <PreviewPanelShell
      mode="inline"
      maximized={tabs.full}
      widthStorageKey={`t3code:quest-documents-width:${environmentId}`}
      defaultWidth={720}
      workspaceLabel="Quest documents"
    >
      <QuestDocumentTabs placement="beside" />
    </PreviewPanelShell>
  );
}

function DocumentTree({ onOpened, onHide }: { onOpened: () => void; onHide: (() => void) | null }) {
  const { environmentId, state } = useQuest();
  const tabs = useQuestDocumentTabs(environmentId);
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const [picking, setPicking] = useState(false);
  const entries = [
    ...state.files.map((file) => findEntry(state, file.id)!),
    ...state.documents.map((doc) => findEntry(state, doc.id)!),
  ];
  const tree = buildTree(state, entries);
  const renderFolder = (folder: TreeFolder, depth: number): ReactNode => (
    <>
      {folder.folders.map((child) => {
        const isOpen = !closed.has(child.path);
        return (
          <li key={child.path}>
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() =>
                setClosed((current) => {
                  const next = new Set(current);
                  if (isOpen) next.add(child.path);
                  else next.delete(child.path);
                  return next;
                })
              }
              className="flex w-full cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-left text-sm hover:bg-accent"
              style={{ paddingInlineStart: `${0.5 + depth * 0.875}rem` }}
            >
              <ChevronRightIcon
                aria-hidden
                className={cn("size-3 shrink-0 text-muted-foreground", isOpen && "rotate-90")}
              />
              <FolderIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{child.name}</span>
            </button>
            {isOpen ? <ul>{renderFolder(child, depth + 1)}</ul> : null}
          </li>
        );
      })}
      {folder.entries.map((entry) => (
        <TreeRow
          key={entry.id}
          entry={entry}
          depth={depth}
          isSelected={tabs.active === entry.id}
          onOpen={() => {
            openQuestDocumentTab(environmentId, entry.id, false);
            onOpened();
          }}
        />
      ))}
    </>
  );
  return (
    <>
      <div className="flex h-9 shrink-0 items-center gap-1 border-b ps-3 pe-1.5">
        <h2 className="flex-1 text-sm font-medium">Documents</h2>
        <FileSurfaceAction label="Open or add document" onPress={() => setPicking(true)}>
          <PlusIcon className="size-3.5" />
        </FileSurfaceAction>
        {onHide ? (
          <FileSurfaceAction label="Hide documents" onPress={onHide}>
            <PanelLeftIcon className="size-3.5" />
          </FileSurfaceAction>
        ) : null}
      </div>
      <ul className="p-1.5">{renderFolder(tree, 0)}</ul>
      <QuestDocumentPicker
        open={picking}
        onOpenChange={setPicking}
        onOpen={(id) => {
          openQuestDocumentTab(environmentId, id, false);
          onOpened();
        }}
      />
    </>
  );
}

interface TreeFolder {
  readonly name: string;
  readonly path: string;
  readonly folders: Array<TreeFolder>;
  readonly entries: Array<QuestEntry>;
}

/** Folders come only from actual file paths; everything else stays at the root. */
function buildTree(state: QuestState, entries: ReadonlyArray<QuestEntry>): TreeFolder {
  const root: TreeFolder = { name: "", path: "", folders: [], entries: [] };
  for (const entry of entries) {
    const segments = relativePath(state, entry)?.split("/").slice(0, -1) ?? [];
    let folder = root;
    for (const name of segments) {
      const path = folder.path ? `${folder.path}/${name}` : name;
      let next = folder.folders.find((item) => item.name === name);
      if (!next) {
        next = { name, path, folders: [], entries: [] };
        folder.folders.push(next);
      }
      folder = next;
    }
    folder.entries.push(entry);
  }
  const sort = (folder: TreeFolder) => {
    folder.folders.sort((a, b) => a.name.localeCompare(b.name));
    folder.entries.sort((a, b) => a.title.localeCompare(b.title));
    folder.folders.forEach(sort);
  };
  sort(root);
  return root;
}

function TreeRow({
  entry,
  depth,
  isSelected,
  onOpen,
}: {
  entry: QuestEntry;
  depth: number;
  isSelected: boolean;
  onOpen: () => void;
}) {
  const { state } = useQuest();
  const theme = useRenderedAppearance();
  const unsaved = useHasDraft(entry.id);
  const write = state.pendingWrites.find((item) => item.documentId === entry.id);
  return (
    <li>
      <button
        type="button"
        aria-current={isSelected ? "page" : undefined}
        onClick={onOpen}
        className={cn(
          "flex w-full cursor-pointer items-start gap-1.5 rounded px-2 py-1 text-left text-sm hover:bg-accent",
          isSelected && "bg-accent font-medium",
        )}
        style={{ paddingInlineStart: `${1.25 + depth * 0.875}rem` }}
      >
        <PierreEntryIcon
          pathValue={entryIconPath(state, entry)}
          kind="file"
          theme={theme}
          className="mt-0.5 size-3.5 shrink-0"
        />
        <span className="min-w-0 flex-1">{entry.title}</span>
        {entry.kind === "record" && entry.document.kind === "evidence" ? (
          <span className="mt-0.5 shrink-0 text-xs font-normal text-muted-foreground">
            read only
          </span>
        ) : null}
        {unsaved ? (
          <span className="mt-0.5 shrink-0 text-xs font-normal text-warning-foreground">
            unsaved
          </span>
        ) : write ? (
          <span className="mt-0.5 shrink-0 text-xs font-normal text-warning-foreground">
            {write.status}
          </span>
        ) : null}
      </button>
    </li>
  );
}

function matchesQuery(text: string, query: string) {
  const needle = query.trim().toLowerCase().replaceAll(/\s+/g, "");
  if (!needle) return true;
  const haystack = text.toLowerCase();
  let index = 0;
  for (const char of haystack) if (char === needle[index]) index += 1;
  return index >= needle.length;
}

function defaultTitle(path: string) {
  return path.split("/").at(-1)?.replace(/\.md$/i, "") ?? path;
}

/**
 * Open or add a document: Quest documents open; Markdown files in the Quest folder that are not
 * yet documents can be added. Files come from the Quest's environment, not from this browser.
 */
function QuestDocumentPicker({
  open,
  onOpenChange,
  onOpen,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpen: (id: string) => void;
}) {
  const { environmentId, state, pending, save } = useQuest();
  const theme = useRenderedAppearance();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  // Adding exposes files on this environment, so it needs the file read grant too.
  const canAdd = useAtomValue(
    questEnvironment.update.permissionAtom(environmentId, { change: { type: "file-register" } }),
  );
  const files = useEnvironmentQuery(
    open && state.workspace && canAdd
      ? questEnvironment.workspaceFiles({ environmentId, input: {} })
      : null,
  );
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [choosingFolder, setChoosingFolder] = useState(false);
  const [root, setRoot] = useState("");
  const registered = new Set(state.files.map((file) => file.path));
  const close = () => {
    onOpenChange(false);
    setQuery("");
    setChoosingFolder(false);
  };
  const existing: CommandPaletteActionItem[] = [
    ...state.files.map((file) => ({ id: file.id, title: file.title, path: file.path })),
    ...state.documents.map((doc) => ({ id: doc.id, title: doc.title, path: null })),
  ]
    .filter((item) => matchesQuery(`${item.title} ${item.path ?? ""}`, query))
    .map((item) => ({
      kind: "action",
      value: `document:${item.id}`,
      searchTerms: [item.title],
      title: item.title,
      ...(item.path ? { description: item.path } : {}),
      icon: (
        <PierreEntryIcon pathValue={item.path ?? `${item.title}.md`} kind="file" theme={theme} />
      ),
      run: async () => onOpen(item.id),
    }));
  const addable: CommandPaletteActionItem[] = (files.data?.paths ?? [])
    .filter((path) => !registered.has(path) && matchesQuery(path, query))
    .map((path) => ({
      kind: "action",
      value: `add:${path}`,
      searchTerms: [path],
      title: `Add and open ${defaultTitle(path)}`,
      description: path,
      icon: <PierreEntryIcon pathValue={path} kind="file" theme={theme} />,
      run: async () => {
        const saved = await save({ type: "file-register", path, title: defaultTitle(path) });
        const added = saved?.files.find((file) => file.path === path);
        if (added) onOpen(added.id);
      },
    }));
  return (
    <CommandDialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      {open ? (
        <CommandDialogPopup
          aria-label="Open or add document"
          className="overflow-hidden"
          onBackdropPointerDown={close}
        >
          {choosingFolder ? (
            <form
              className="grid gap-3 p-4"
              onSubmit={(event) => {
                event.preventDefault();
                void save({ type: "workspace-register", root }).then((saved) => {
                  if (saved) setChoosingFolder(false);
                });
              }}
            >
              <h2 className="text-sm font-medium">Quest folder</h2>
              <Input
                aria-label="Quest folder on this environment"
                placeholder="/home/user/quests/example"
                value={root}
                onChange={(event) => setRoot(event.target.value)}
                autoFocus
              />
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={pending || !root.trim()}>
                  Use this folder
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setChoosingFolder(false)}
                >
                  Back
                </Button>
              </div>
            </form>
          ) : (
            <CommandPaletteContent
              aria-label="Open or add document"
              autoHighlight="always"
              escapeLabel="Close"
              footerActionLabel={highlighted?.startsWith("add:") ? "Add and open" : "Open"}
              footerTrailing={
                !state.workspace && canAdd ? (
                  <CommandFooterAction onClick={() => setChoosingFolder(true)}>
                    Choose Quest folder…
                  </CommandFooterAction>
                ) : null
              }
              inputProps={{ placeholder: "Search documents…" }}
              mode="none"
              onItemHighlighted={(value) =>
                setHighlighted(typeof value === "string" ? value : null)
              }
              onValueChange={(value) => {
                setHighlighted(null);
                setQuery(value);
              }}
              panelSize="tall-list"
              testId="quest-document-picker"
              value={query}
            >
              <CommandPaletteResults
                groups={[
                  ...(existing.length > 0
                    ? [{ value: "documents", label: "Documents", items: existing }]
                    : []),
                  ...(addable.length > 0
                    ? [{ value: "add", label: "Add from the Quest folder", items: addable }]
                    : []),
                ]}
                highlightedItemValue={highlighted}
                isActionsOnly={false}
                keybindings={keybindings}
                onExecuteItem={(item) => {
                  if (item.kind !== "action") return;
                  close();
                  void item.run();
                }}
                emptyStateMessage={
                  files.isPending ? "Reading the Quest folder…" : "No matching documents."
                }
              />
            </CommandPaletteContent>
          )}
        </CommandDialogPopup>
      ) : null}
    </CommandDialog>
  );
}

/** Open documents as T3 file tabs over the active document. Shared by Documents and the split. */
function QuestDocumentTabs({
  placement,
  leading = null,
  narrow = false,
}: {
  placement: "documents" | "beside";
  leading?: ReactNode;
  narrow?: boolean;
}) {
  const { environmentId, state, showView } = useQuest();
  const tabs = useQuestDocumentTabs(environmentId);
  const drafts = useQuestDraftStore((store) => store.drafts);
  const theme = useRenderedAppearance();
  const [closing, setClosing] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const beside = placement === "beside";
  const closingEntry = closing ? findEntry(state, closing) : null;
  return (
    <section
      aria-label={beside ? "Documents beside the conversation" : "Open documents"}
      className="flex min-h-0 min-w-0 flex-1 flex-col"
    >
      <div className="flex h-9 shrink-0 items-center gap-1 border-b px-2">
        {narrow ? (
          <Button
            size="xs"
            variant="ghost"
            onClick={() => showQuestDocumentsBeside(environmentId, false)}
          >
            <ArrowLeftIcon aria-hidden />
            Conversation
          </Button>
        ) : null}
        {leading}
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {tabs.open.map((id) => {
            const entry = findEntry(state, id);
            const title = entry?.title ?? "Missing document";
            const isActive = tabs.active === id;
            const unsaved =
              drafts[`${environmentId}|file:${id}`] !== undefined ||
              drafts[`${environmentId}|document:${id}`] !== undefined;
            const pinned = tabs.versions[id] !== undefined;
            return (
              <div
                key={id}
                className={cn(
                  "group/tab flex h-6 max-w-52 shrink-0 items-center gap-0.5 rounded-md pr-2 pl-1.5 text-xs",
                  isActive
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                )}
              >
                <PanelTabCloseButton
                  label={`Close ${title}`}
                  onClick={() =>
                    unsaved ? setClosing(id) : closeQuestDocumentTab(environmentId, id)
                  }
                >
                  <PierreEntryIcon
                    pathValue={entry ? entryIconPath(state, entry) : `${title}.md`}
                    kind="file"
                    theme={theme}
                    className="size-3"
                  />
                  {unsaved ? (
                    <span
                      className="absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full bg-current"
                      aria-hidden
                    />
                  ) : null}
                </PanelTabCloseButton>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        aria-current={isActive ? "page" : undefined}
                        className="flex min-w-0 cursor-pointer items-center gap-1"
                        onClick={() => openQuestDocumentTab(environmentId, id, beside)}
                      >
                        <span className="truncate">{title}</span>
                        {pinned ? (
                          <span className="shrink-0 text-muted-foreground">pinned</span>
                        ) : null}
                      </button>
                    }
                  />
                  <TooltipPopup>{unsaved ? `${title} · unsaved` : title}</TooltipPopup>
                </Tooltip>
              </div>
            );
          })}
        </div>
        <FileSurfaceAction label="Open or add document" onPress={() => setPicking(true)}>
          <PlusIcon className="size-3.5" />
        </FileSurfaceAction>
        {!beside ? (
          <FileSurfaceAction
            label="Open beside the conversation"
            disabled={tabs.open.length === 0}
            onPress={() => {
              showQuestDocumentsBeside(environmentId, true);
              showView("conversation");
            }}
          >
            <Columns2Icon className="size-3.5" />
          </FileSurfaceAction>
        ) : narrow ? null : (
          <>
            <FileSurfaceAction
              label={tabs.full ? "Restore the split" : "Fill the work area"}
              pressed={tabs.full}
              onPress={() => showQuestDocumentsFull(environmentId, !tabs.full)}
            >
              {tabs.full ? (
                <Minimize2Icon className="size-3.5" />
              ) : (
                <Maximize2Icon className="size-3.5" />
              )}
            </FileSurfaceAction>
            <FileSurfaceAction
              label="Hide documents"
              onPress={() => showQuestDocumentsBeside(environmentId, false)}
            >
              <XIcon className="size-3.5" />
            </FileSurfaceAction>
          </>
        )}
      </div>
      {tabs.active ? (
        <QuestDocumentSurface key={tabs.active} id={tabs.active} />
      ) : (
        <div className="p-4 text-sm text-muted-foreground">
          <Button size="sm" variant="outline" onClick={() => setPicking(true)}>
            <PlusIcon aria-hidden />
            Open a document
          </Button>
        </div>
      )}
      <QuestDocumentPicker
        open={picking}
        onOpenChange={setPicking}
        onOpen={(id) => openQuestDocumentTab(environmentId, id, beside)}
      />
      <AlertDialog open={closing !== null} onOpenChange={(open) => !open && setClosing(null)}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes to {closingEntry?.title}?</AlertDialogTitle>
            <AlertDialogDescription>
              Closing the tab discards the draft. Keep it open to save it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Keep editing</AlertDialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                if (!closing) return;
                useQuestDraftStore.setState((store) => {
                  const drafts = { ...store.drafts };
                  delete drafts[`${environmentId}|file:${closing}`];
                  delete drafts[`${environmentId}|document:${closing}`];
                  return { drafts };
                });
                closeQuestDocumentTab(environmentId, closing);
                setClosing(null);
              }}
            >
              Discard and close
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </section>
  );
}

function QuestDocumentSurface({ id }: { id: string }) {
  const { environmentId, state } = useQuest();
  const tabs = useQuestDocumentTabs(environmentId);
  const entry = findEntry(state, id);
  const { comparison } = useQuestComparison(environmentId, id);
  if (!entry)
    return (
      <p className="p-4 text-sm text-muted-foreground">This document is no longer in the Quest.</p>
    );
  const pins = documentPins(state, entry);
  const version = tabs.versions[id] ?? null;
  if (comparison && version === null) return <ComparisonSurface entry={entry} pins={pins} />;
  if (version !== null) return <PinnedSurface entry={entry} sha256={version} pins={pins} />;
  if (entry.kind === "file") return <FileSurface entry={entry} file={entry.file} pins={pins} />;
  return <RecordSurface entry={entry} document={entry.document} pins={pins} />;
}

/** Current or a pinned version, chosen inside the document's own tab. */
function VersionChoice({
  entry,
  pins,
  version,
}: {
  entry: QuestEntry;
  pins: ReadonlyArray<Pin>;
  version: string | null;
}) {
  const { environmentId } = useQuest();
  if (pins.length === 0) return null;
  const options = [
    {
      value: "",
      label: entry.kind === "record" && entry.document.kind === "evidence" ? "Captured" : "Current",
    },
    ...pins.map((pin) => ({ value: pin.sha256, label: pin.label })),
  ];
  return (
    <Select
      value={version ?? ""}
      items={options}
      onValueChange={(next) => {
        if (next !== null) selectQuestDocumentVersion(environmentId, entry.id, next || null);
      }}
    >
      <SelectTrigger size="sm" aria-label="Version" className="max-w-64">
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

/** Rendered Markdown or its source, through T3's renderer and read-only source view. */
function DocumentBody({
  entry,
  version,
  name,
  text,
}: {
  entry: QuestEntry;
  version: string | null;
  name: string;
  text: string;
}) {
  const { environmentId } = useQuest();
  const { rendered } = useQuestReaderMode(environmentId, entry.id, version);
  if (!rendered)
    return (
      <Suspense fallback={<FileSurfaceLoading />}>
        <ReadOnlySourcePreview name={name} text={text} wordWrap />
      </Suspense>
    );
  const position = readerPosition(environmentId, entry.id, version, "rendered");
  return (
    <div
      className="scrollbar-gutter-both min-h-0 flex-1 overflow-y-auto"
      onScroll={(event) => position.write(event.currentTarget.scrollTop)}
      ref={(host) => {
        if (host) host.scrollTop = position.read();
      }}
    >
      <QuestMarkdown text={maskMarkdownFrontmatter(text)} className="mx-auto max-w-3xl px-6 py-5" />
    </div>
  );
}

function RenderedToggle({ entry, version }: { entry: QuestEntry; version: string | null }) {
  const { environmentId } = useQuest();
  const { rendered, setRendered } = useQuestReaderMode(environmentId, entry.id, version);
  return (
    <FileSurfaceAction
      label={rendered ? "Show markdown source" : "Show rendered markdown"}
      pressed={rendered}
      onPress={() => setRendered(!rendered)}
    >
      <MorphIcon className="size-3.5" icon={rendered ? Code2 : Eye} />
    </FileSurfaceAction>
  );
}

function ShowChanges({
  entry,
  pins,
  readCurrent,
}: {
  entry: QuestEntry;
  pins: ReadonlyArray<Pin>;
  /** A file comparison waits for a read newer than its request, so it asks for one. */
  readCurrent?: () => void;
}) {
  const { environmentId } = useQuest();
  const { set } = useQuestComparison(environmentId, entry.id);
  const latest = pins[0];
  if (!latest) return null;
  return (
    <FileSurfaceAction
      label="Show changes since a pinned version"
      onPress={() => {
        set({
          pinSha256: latest.sha256,
          label: latest.label,
          before: null,
          after: null,
          afterSha256: null,
          readAt: null,
          requestedAt: Date.now(),
        });
        readCurrent?.();
      }}
    >
      <DiffIcon className="size-3.5" />
    </FileSurfaceAction>
  );
}

function SurfaceHeader({
  leading,
  badges,
  actions,
  details,
}: {
  leading?: ReactNode;
  badges?: ReactNode;
  actions: ReactNode;
  details: ReactNode;
}) {
  return (
    <div className={FILE_SURFACE_SUBHEADER_CLASS}>
      {leading}
      {badges}
      <span className="ms-auto flex shrink-0 items-center gap-1">
        {actions}
        <Popover>
          <PopoverTrigger
            render={<Button size="icon-xs" variant="ghost" aria-label="Document details" />}
          >
            <InfoIcon aria-hidden className="size-3.5" />
          </PopoverTrigger>
          <PopoverPopup align="end" className="w-80">
            <div className="text-xs">{details}</div>
          </PopoverPopup>
        </Popover>
      </span>
    </div>
  );
}

function DetailsList({
  rows,
  children,
}: {
  rows: ReadonlyArray<readonly [string, ReactNode]>;
  children?: ReactNode;
}) {
  return (
    <>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="break-all">{value}</dd>
          </div>
        ))}
      </dl>
      {children}
    </>
  );
}

function UsedBy({ documentId }: { documentId: string }) {
  const { state, openPanel } = useQuest();
  const users = state.work.filter((item) => item.documentIds.includes(documentId));
  if (users.length === 0) return <>Not used by any work</>;
  return (
    <>
      {users.map((item, index) => (
        <span key={item.id}>
          {index > 0 ? ", " : null}
          <button
            type="button"
            className="cursor-pointer underline hover:text-foreground"
            onClick={() => openPanel({ type: "work", id: item.id })}
          >
            {item.title}
          </button>
        </span>
      ))}
    </>
  );
}

/** A registered Markdown file: the file owns its bytes, the Quest only its identity and history. */
function FileSurface({
  entry,
  file,
  pins,
}: {
  entry: QuestEntry;
  file: QuestFile;
  pins: ReadonlyArray<Pin>;
}) {
  const { environmentId, state, canWrite: canWriteQuest, adopt, save } = useQuest();
  // The file's bytes need this connection's file grants; the Quest record does not.
  const canReadFiles = useEnvironmentScope(environmentId, AuthFilesystemReadScope);
  const canWrite = useAtomValue(questEnvironment.writeDocument.permissionAtom(environmentId));
  const query = useEnvironmentQuery(
    canReadFiles
      ? questEnvironment.document({ environmentId, input: { documentId: file.id } })
      : null,
  );
  const editor = useQuestDraft(environmentId, `file:${file.id}`);
  const write = useAtomCommand(questEnvironment.writeDocument, { reportFailure: false });
  const recover = useAtomCommand(questEnvironment.recoverWrite, { reportFailure: false });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const pendingWrite = state.pendingWrites.find((item) => item.documentId === file.id) ?? null;
  const current = query.data;
  const base = draftText(editor.draft, "base", "");
  const content = draftText(editor.draft, "content", current?.content ?? "");
  const stale = Boolean(editor.draft && current?.sha256 && base && current.sha256 !== base);

  async function saveFile() {
    if (busy) return;
    const operationId = draftText(editor.draft, "op", "") || randomUUID();
    editor.update({ op: operationId });
    setBusy(true);
    const result = await write({
      environmentId,
      input: { operationId, documentId: file.id, expectedSha256: base, content },
    });
    setBusy(false);
    if (result._tag !== "Success") return setNotice(failureText(result));
    adopt(result.value.state);
    setNotice(outcomeText[result.value.outcome]);
    if (result.value.outcome === "saved") editor.clear();
    else editor.update({ op: "" });
    query.refresh();
  }

  async function recoverWrite() {
    if (!pendingWrite || busy) return;
    setBusy(true);
    const result = await recover({
      environmentId,
      input: { operationId: randomUUID(), writeId: pendingWrite.id },
    });
    setBusy(false);
    if (result._tag !== "Success") return setNotice(failureText(result));
    adopt(result.value.state);
    setNotice(outcomeText[result.value.outcome]);
    query.refresh();
  }

  return (
    <article aria-label={file.title} className="flex min-h-0 flex-1 flex-col">
      <SurfaceHeader
        leading={<VersionChoice entry={entry} pins={pins} version={null} />}
        badges={
          editor.draft ? (
            <Badge variant="warning" size="sm">
              Unsaved
            </Badge>
          ) : canWrite ? null : (
            <Badge variant="outline" size="sm">
              Read only
            </Badge>
          )
        }
        actions={
          editor.draft ? (
            <>
              <ShowChanges entry={entry} pins={pins} readCurrent={query.refresh} />
              <Button
                size="xs"
                disabled={busy || !canWrite || pendingWrite !== null}
                onClick={() => void saveFile()}
              >
                Save
              </Button>
              <Button size="xs" variant="ghost" disabled={busy} onClick={editor.clear}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              <ShowChanges entry={entry} pins={pins} readCurrent={query.refresh} />
              <RenderedToggle entry={entry} version={null} />
              {canWrite && current?.content != null && !pendingWrite ? (
                <FileSurfaceAction
                  label="Edit"
                  onPress={() =>
                    editor.update({ base: current.sha256 ?? "", content: current.content ?? "" })
                  }
                >
                  <PencilIcon className="size-3.5" />
                </FileSurfaceAction>
              ) : null}
            </>
          )
        }
        details={
          <DetailsList
            rows={[
              ["Location", state.workspace ? `${state.workspace.root}/${file.path}` : file.path],
              ["Content", current?.sha256 ? `SHA-256 ${current.sha256}` : "Not read"],
              ...(editor.draft && base ? ([["Editing from", `SHA-256 ${base}`]] as const) : []),
              ["Used by", <UsedBy key="used" documentId={file.id} />],
            ]}
          />
        }
      />
      {canReadFiles ? null : (
        <FileSurfaceNotice>
          Reading this file needs file access on this connection.
        </FileSurfaceNotice>
      )}
      {notice ? <FileSurfaceNotice>{notice}</FileSurfaceNotice> : null}
      {stale ? (
        <FileSurfaceNotice>
          The file changed since you started editing. Saving will be refused; copy what you need
          from the current file first.
        </FileSurfaceNotice>
      ) : null}
      {pendingWrite ? (
        <div className="max-h-[45%] shrink-0 overflow-y-auto border-b px-3 pb-3">
          <PendingWrite
            write={pendingWrite}
            busy={busy}
            canWrite={canWrite}
            canReadFiles={canReadFiles}
            canDiscard={canWriteQuest}
            onRecover={() => void recoverWrite()}
            onDiscard={() => void save({ type: "write-discard", writeId: pendingWrite.id })}
            onUseDraft={(text) =>
              editor.update({ base: current?.sha256 ?? "", content: text, op: "" })
            }
          />
        </div>
      ) : null}
      {editor.draft ? (
        <Suspense fallback={<FileSurfaceLoading />}>
          <QuestSourceEditor
            key={file.id}
            name={file.path}
            contents={content}
            onChange={(next) => editor.update({ content: next })}
            position={readerPosition(environmentId, file.id, null, "editor")}
          />
        </Suspense>
      ) : current?.content != null ? (
        <DocumentBody entry={entry} version={null} name={file.path} text={current.content} />
      ) : (
        <p role="alert" className="p-4 text-sm">
          {current?.unavailable ?? query.error ?? (canReadFiles ? "Loading…" : null)}
        </p>
      )}
    </article>
  );
}

/** A legacy Quest note (edited and saved as a Quest record) or captured evidence (read only). */
function RecordSurface({
  entry,
  document,
  pins,
}: {
  entry: QuestEntry;
  document: QuestDocument;
  pins: ReadonlyArray<Pin>;
}) {
  const { environmentId, canWrite, pending, save } = useQuest();
  const editor = useQuestDraft(environmentId, `document:${document.id}`);
  const [title, setTitle] = useState(document.title);
  const editable = document.kind === "living" && canWrite;
  const body = draftText(editor.draft, "body", document.body);
  async function saveRecord(fields: Partial<Pick<QuestDocument, "title" | "body">>) {
    const saved = await save({ type: "document", document: { ...document, ...fields } });
    if (saved && fields.body !== undefined) editor.clear();
  }
  return (
    <article aria-label={document.title} className="flex min-h-0 flex-1 flex-col">
      <SurfaceHeader
        leading={<VersionChoice entry={entry} pins={pins} version={null} />}
        badges={
          editor.draft ? (
            <Badge variant="warning" size="sm">
              Unsaved
            </Badge>
          ) : editable ? null : (
            <Badge variant="outline" size="sm">
              {document.kind === "evidence" ? "Evidence · read only" : "Read only"}
            </Badge>
          )
        }
        actions={
          editor.draft ? (
            <>
              <ShowChanges entry={entry} pins={pins} />
              <Button size="xs" disabled={pending} onClick={() => void saveRecord({ body })}>
                Save
              </Button>
              <Button size="xs" variant="ghost" disabled={pending} onClick={editor.clear}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              <ShowChanges entry={entry} pins={pins} />
              <RenderedToggle entry={entry} version={null} />
              {editable ? (
                <FileSurfaceAction
                  label="Edit"
                  disabled={pending}
                  onPress={() => editor.update({ body: document.body })}
                >
                  <PencilIcon className="size-3.5" />
                </FileSurfaceAction>
              ) : null}
            </>
          )
        }
        details={
          <DetailsList
            rows={[
              [
                "Stored",
                document.kind === "evidence"
                  ? "Captured evidence in the Quest record"
                  : "In the Quest record",
              ],
              ["Source", document.source],
              ...(document.sha256 ? ([["Content", `SHA-256 ${document.sha256}`]] as const) : []),
              ["Used by", <UsedBy key="used" documentId={document.id} />],
            ]}
          >
            {editable ? (
              <form
                className="mt-3 flex gap-1.5"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (title.trim()) void saveRecord({ title });
                }}
              >
                <Input
                  aria-label="Document title"
                  size="sm"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
                <Button
                  type="submit"
                  size="sm"
                  variant="outline"
                  disabled={pending || !title.trim() || title === document.title}
                >
                  Rename
                </Button>
              </form>
            ) : null}
          </DetailsList>
        }
      />
      {editor.draft ? (
        <Suspense fallback={<FileSurfaceLoading />}>
          <QuestSourceEditor
            key={document.id}
            name={`${document.title}.md`}
            contents={body}
            onChange={(next) => editor.update({ body: next })}
            position={readerPosition(environmentId, document.id, null, "editor")}
          />
        </Suspense>
      ) : (
        <DocumentBody
          entry={entry}
          version={null}
          name={`${document.title}.md`}
          text={document.body}
        />
      )}
    </article>
  );
}

/** The exact bytes a conversation pinned, retained by the Quest. Never editable. */
function usePinnedText(entry: QuestEntry, sha256: string | null) {
  const { environmentId } = useQuest();
  const canReadFiles = useEnvironmentScope(environmentId, AuthFilesystemReadScope);
  // A Quest record's own text is the pinned text when the hashes match.
  const own =
    entry.kind === "record" && entry.document.sha256 === sha256 ? entry.document.body : null;
  const retained = useEnvironmentQuery(
    sha256 !== null && own === null && canReadFiles
      ? questEnvironment.retained({ environmentId, input: { sha256 } })
      : null,
  );
  const text = own ?? retained.data?.content ?? null;
  const unavailable =
    text !== null
      ? null
      : !canReadFiles
        ? "Reading pinned versions needs file access on this connection."
        : (retained.error ?? (retained.data ? "This version is no longer retained." : null));
  return { text, unavailable };
}

function PinnedSurface({
  entry,
  sha256,
  pins,
}: {
  entry: QuestEntry;
  sha256: string;
  pins: ReadonlyArray<Pin>;
}) {
  const { text, unavailable } = usePinnedText(entry, sha256);
  const pin = pins.find((item) => item.sha256 === sha256);
  const name = entryIconPath(useQuest().state, entry);
  return (
    <article aria-label={`${entry.title} pinned version`} className="flex min-h-0 flex-1 flex-col">
      <SurfaceHeader
        leading={
          pins.length > 0 ? (
            <VersionChoice entry={entry} pins={pins} version={sha256} />
          ) : (
            <span className="text-xs text-muted-foreground">Pinned version</span>
          )
        }
        badges={
          <Badge variant="outline" size="sm">
            Read only
          </Badge>
        }
        actions={<RenderedToggle entry={entry} version={sha256} />}
        details={
          <DetailsList
            rows={[
              ["Version", pin?.label ?? "Pinned version"],
              ...(pin ? ([["Captured", new Date(pin.capturedAt).toLocaleString()]] as const) : []),
              ["Content", `SHA-256 ${sha256}`],
            ]}
          />
        }
      />
      {text !== null ? (
        <DocumentBody entry={entry} version={sha256} name={name} text={text} />
      ) : (
        <p role="alert" className="p-4 text-sm">
          {unavailable ?? "Loading…"}
        </p>
      )}
    </article>
  );
}

/**
 * A read-only comparison of a pinned version with the current text. The pair stays fixed until
 * Refresh reads the current text again; it never touches an open draft or its base.
 */
function ComparisonSurface({ entry, pins }: { entry: QuestEntry; pins: ReadonlyArray<Pin> }) {
  const { environmentId, state } = useQuest();
  const resolvedTheme = useRenderedAppearance();
  const wide = useMediaQuery("(min-width: 1600px)");
  const tabs = useQuestDocumentTabs(environmentId);
  const { comparison, set, clear } = useQuestComparison(environmentId, entry.id);
  const canReadFiles = useEnvironmentScope(environmentId, AuthFilesystemReadScope);
  const current = useEnvironmentQuery(
    entry.kind === "file" && canReadFiles
      ? questEnvironment.document({ environmentId, input: { documentId: entry.id } })
      : null,
  );
  const pinned = usePinnedText(entry, comparison?.pinSha256 ?? null);
  const hasDraft = useHasDraft(entry.id);
  const currentText =
    entry.kind === "record" ? entry.document.body : (current.data?.content ?? null);
  const currentSha =
    entry.kind === "record" ? entry.document.sha256 || null : (current.data?.sha256 ?? null);
  const currentFresh =
    entry.kind === "record" || current.dataUpdatedAt >= (comparison?.requestedAt ?? 0);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- captures each side of the comparison once its read arrives; later reads change nothing until Refresh
  useEffect(() => {
    if (!comparison) return;
    if (comparison.before === null && pinned.text !== null)
      set({ ...comparison, before: pinned.text });
    else if (comparison.after === null && currentText !== null && currentFresh)
      set({
        ...comparison,
        after: currentText,
        afterSha256: currentSha,
        readAt: new Date().toISOString(),
      });
  }, [comparison, pinned.text, currentText, currentSha, currentFresh, set]);
  if (!comparison) return null;
  const name = entryIconPath(state, entry);
  const target = entry.kind === "file" ? "Current file" : "Current note";
  const diff =
    comparison.before !== null && comparison.after !== null
      ? parseDiffFromFile(
          { name, contents: comparison.before },
          { name, contents: comparison.after },
        )
      : null;
  const unchanged = comparison.before !== null && comparison.before === comparison.after;
  return (
    <article aria-label={`${entry.title} changes`} className="flex min-h-0 flex-1 flex-col">
      <div className={FILE_SURFACE_SUBHEADER_CLASS}>
        <Button size="xs" variant="ghost" onClick={clear}>
          <ArrowLeftIcon aria-hidden />
          {hasDraft ? "Back to my draft" : "Back to document"}
        </Button>
        {pins.length > 1 ? (
          <Select
            value={comparison.pinSha256}
            items={pins.map((pin) => ({ value: pin.sha256, label: pin.label }))}
            onValueChange={(next) => {
              const pin = pins.find((item) => item.sha256 === next);
              if (pin)
                set({ ...comparison, pinSha256: pin.sha256, label: pin.label, before: null });
            }}
          >
            <SelectTrigger size="sm" aria-label="Compare from" className="max-w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              {pins.map((pin) => (
                <SelectItem key={pin.sha256} value={pin.sha256}>
                  {pin.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        ) : (
          <span className="min-w-0 truncate text-xs">{comparison.label}</span>
        )}
        <span className="shrink-0 text-xs text-muted-foreground">→ {target}</span>
        <span className="ms-auto flex shrink-0 items-center gap-1">
          {comparison.readAt ? (
            <span className="text-xs text-muted-foreground">
              read {new Date(comparison.readAt).toLocaleTimeString()}
            </span>
          ) : null}
          {entry.kind === "file" ? (
            <FileSurfaceAction
              label="Read the current file again"
              onPress={() => {
                set({
                  ...comparison,
                  after: null,
                  afterSha256: null,
                  readAt: null,
                  requestedAt: Date.now(),
                });
                current.refresh();
              }}
            >
              <RefreshCwIcon className="size-3.5" />
            </FileSurfaceAction>
          ) : null}
        </span>
      </div>
      {pinned.unavailable && comparison.before === null ? (
        <p role="alert" className="p-4 text-sm">
          No comparison version is available: {pinned.unavailable}
        </p>
      ) : !diff ? (
        <FileSurfaceLoading />
      ) : unchanged ? (
        <p className="p-4 text-sm text-muted-foreground">No changes since this pinned version.</p>
      ) : (
        <StyledDiffCodeView
          className="min-h-0 flex-1 overflow-auto"
          items={[{ id: `${entry.id}:${comparison.pinSha256}`, type: "diff", fileDiff: diff }]}
          options={{
            diffStyle: wide || tabs.full ? "split" : "unified",
            overflow: "wrap",
            theme: resolveDiffThemeName(resolvedTheme),
            themeType: resolvedTheme,
            preferredHighlighter: PREFERRED_HIGHLIGHTER,
          }}
        />
      )}
    </article>
  );
}

function PendingWrite({
  write,
  busy,
  canWrite,
  canReadFiles,
  canDiscard,
  onRecover,
  onDiscard,
  onUseDraft,
}: {
  write: QuestPendingWrite;
  busy: boolean;
  canWrite: boolean;
  canReadFiles: boolean;
  canDiscard: boolean;
  onRecover: () => void;
  onDiscard: () => void;
  onUseDraft: (text: string) => void;
}) {
  const { environmentId } = useQuest();
  const [shown, setShown] = useState(false);
  const draft = useEnvironmentQuery(
    shown
      ? questEnvironment.retained({ environmentId, input: { sha256: write.desiredSha256 } })
      : null,
  ).data;
  return (
    <div className="mt-3 rounded border border-warning/40 p-3 text-sm">
      <p className="font-medium">
        {write.status === "conflict"
          ? "Unsaved draft · the file changed elsewhere"
          : "Unfinished save"}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{write.detail}</p>
      <details className="mt-1 text-xs text-muted-foreground">
        <summary className="cursor-pointer">Versions</summary>
        <p className="mt-1 break-all">
          Expected {write.expectedSha256.slice(0, 12)} · draft {write.desiredSha256.slice(0, 12)}
          {write.actualSha256 ? ` · found ${write.actualSha256.slice(0, 12)}` : ""}
        </p>
      </details>
      <div className="mt-2 flex flex-wrap gap-2">
        {canWrite ? (
          <Button size="xs" variant="outline" disabled={busy} onClick={onRecover}>
            {write.status === "conflict" ? "Check the file again" : "Recover"}
          </Button>
        ) : null}
        {canReadFiles ? (
          <Button size="xs" variant="ghost" onClick={() => setShown((value) => !value)}>
            {shown ? "Hide my draft" : "Show my draft"}
          </Button>
        ) : null}
        {canWrite && draft?.content != null ? (
          <Button size="xs" variant="ghost" onClick={() => onUseDraft(draft.content ?? "")}>
            Edit my draft against the current file
          </Button>
        ) : null}
        {canDiscard ? (
          <Button size="xs" variant="ghost" disabled={busy} onClick={onDiscard}>
            Discard
          </Button>
        ) : null}
      </div>
      {shown ? (
        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded border p-2 text-xs">
          {draft?.content ?? "Loading…"}
        </pre>
      ) : null}
    </div>
  );
}

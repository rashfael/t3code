import { useAtomValue } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  AuthFilesystemReadScope,
  type QuestDocument,
  type QuestFile,
  type QuestPendingWrite,
  type QuestWriteResult,
} from "@t3tools/contracts";
import { maskMarkdownFrontmatter } from "@t3tools/shared/markdownFrontmatter";
import { Code2, Eye } from "lucide";
import { Columns2Icon, PencilIcon, PlusIcon, XIcon } from "lucide-react";
import { lazy, Suspense, useState, type ReactNode } from "react";

import { useMediaQuery } from "~/hooks/useMediaQuery";
import { useRenderedAppearance } from "~/hooks/useTheme";
import { cn, randomUUID } from "~/lib/utils";
import { useEnvironmentQuery } from "~/state/query";
import { useEnvironmentScope } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";
import { PierreEntryIcon } from "../chat/PierreEntryIcon";
import {
  FILE_SURFACE_SUBHEADER_CLASS,
  FileSurfaceAction,
  FileSurfaceLoading,
  FileSurfaceNotice,
} from "../files/fileSurfaceChrome";
import { MorphIcon } from "../MorphIcon";
import { PreviewPanelShell } from "../preview/PreviewPanelShell";
import { RightPanelSheet } from "../RightPanelSheet";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { PanelTabCloseButton } from "../ui/panel-tab-close-button";
import { ScrollArea } from "../ui/scroll-area";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useQuest } from "./questContext";
import { QuestSelect } from "./QuestConversations";
import {
  closeQuestDocumentTab,
  draftText,
  openQuestDocumentTab,
  showQuestDocumentsBeside,
  useQuestDocumentTabs,
  useQuestDraft,
  useQuestDraftStore,
} from "./questDraftStore";
import { DocumentEditor } from "./QuestEditors";
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

type DocumentTab =
  | { readonly kind: "file"; readonly file: QuestFile }
  | { readonly kind: "record"; readonly document: QuestDocument }
  | {
      readonly kind: "pinned";
      readonly id: string;
      readonly sha256: string;
      readonly path: string;
    };

function resolveTab(
  state: ReturnType<typeof useQuest>["state"],
  tabId: string,
): DocumentTab | null {
  const at = tabId.lastIndexOf("@");
  const id = at > 0 ? tabId.slice(0, at) : tabId;
  const file = state.files.find((item) => item.id === id);
  const document = state.documents.find((item) => item.id === id);
  if (at > 0)
    return file || document
      ? { kind: "pinned", id, sha256: tabId.slice(at + 1), path: file?.path ?? document!.source }
      : null;
  if (file) return { kind: "file", file };
  if (document) return { kind: "record", document };
  return null;
}

function tabTitle(state: ReturnType<typeof useQuest>["state"], tab: DocumentTab | null) {
  if (!tab) return "Missing document";
  if (tab.kind === "file") return tab.file.title;
  if (tab.kind === "record") return tab.document.title;
  const title =
    state.files.find((item) => item.id === tab.id)?.title ??
    state.documents.find((item) => item.id === tab.id)?.title;
  return `${title} @${tab.sha256.slice(0, 7)}`;
}

function tabPath(tab: DocumentTab | null, title: string) {
  if (tab?.kind === "file") return tab.file.path;
  if (tab?.kind === "pinned") return tab.path;
  return `${title}.md`;
}

/** Open documents as T3 file tabs over the active document. Shared by Documents and the split. */
function QuestDocumentTabs({ placement }: { placement: "documents" | "beside" }) {
  const { environmentId, state, showView } = useQuest();
  const tabs = useQuestDocumentTabs(environmentId);
  const drafts = useQuestDraftStore((store) => store.drafts);
  const theme = useRenderedAppearance();
  return (
    <section
      aria-label={placement === "beside" ? "Documents beside the conversation" : "Open documents"}
      className="flex min-h-0 min-w-0 flex-1 flex-col"
    >
      <div className="flex h-9 shrink-0 items-center gap-1 border-b px-2">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {tabs.open.map((tabId) => {
            const tab = resolveTab(state, tabId);
            const title = tabTitle(state, tab);
            const active = tabs.active === tabId;
            const unsaved =
              drafts[`${environmentId}|file:${tabId}`] !== undefined ||
              drafts[`${environmentId}|document:${tabId}`] !== undefined;
            return (
              <div
                key={tabId}
                className={cn(
                  "group/tab flex h-6 max-w-44 shrink-0 items-center gap-0.5 rounded-md pr-2 pl-1.5 text-xs",
                  active
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                )}
              >
                <PanelTabCloseButton
                  label={`Close ${title}`}
                  onClick={() => closeQuestDocumentTab(environmentId, tabId)}
                >
                  <PierreEntryIcon
                    pathValue={tabPath(tab, title)}
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
                        aria-current={active ? "page" : undefined}
                        className="flex min-w-0 cursor-pointer items-center"
                        onClick={() => openQuestDocumentTab(environmentId, tabId, false)}
                      >
                        <span className="truncate">{title}</span>
                      </button>
                    }
                  />
                  <TooltipPopup>{unsaved ? `${title} · unsaved` : title}</TooltipPopup>
                </Tooltip>
              </div>
            );
          })}
        </div>
        <OpenDocumentMenu beside={placement === "beside"} />
        {placement === "documents" ? (
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
        ) : (
          <FileSurfaceAction
            label="Close documents"
            onPress={() => showQuestDocumentsBeside(environmentId, false)}
          >
            <XIcon className="size-3.5" />
          </FileSurfaceAction>
        )}
      </div>
      {tabs.active ? (
        <QuestDocumentSurface key={tabs.active} tabId={tabs.active} />
      ) : (
        <div className="p-4 text-sm text-muted-foreground">
          <p className="mb-2">Open a document.</p>
          <DocumentChoices beside={placement === "beside"} />
        </div>
      )}
    </section>
  );
}

function DocumentChoices({ beside }: { beside: boolean }) {
  const { environmentId, state } = useQuest();
  return (
    <ul className="grid gap-0.5">
      {[
        ...state.files.map((file) => ({ id: file.id, title: file.title, detail: file.path })),
        ...state.documents.map((doc) => ({
          id: doc.id,
          title: doc.title,
          detail: doc.kind === "evidence" ? "Evidence · read only" : "Quest note",
        })),
      ].map((item) => (
        <li key={item.id}>
          <button
            type="button"
            className="w-full rounded px-2 py-1 text-left text-sm text-foreground hover:bg-accent"
            onClick={() => openQuestDocumentTab(environmentId, item.id, beside)}
          >
            {item.title}
            <span className="ms-2 text-xs text-muted-foreground">{item.detail}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function OpenDocumentMenu({ beside }: { beside: boolean }) {
  const { environmentId, state } = useQuest();
  const items = [
    ...state.files.map((file) => ({ id: file.id, title: file.title })),
    ...state.documents.map((doc) => ({ id: doc.id, title: doc.title })),
  ];
  return (
    <Menu>
      <MenuTrigger render={<Button aria-label="Open a document" size="icon-sm" variant="ghost" />}>
        <PlusIcon aria-hidden className="size-3.5" />
      </MenuTrigger>
      <MenuPopup align="end">
        {items.map((item) => (
          <MenuItem
            key={item.id}
            onClick={() => openQuestDocumentTab(environmentId, item.id, beside)}
          >
            {item.title}
          </MenuItem>
        ))}
      </MenuPopup>
    </Menu>
  );
}

/** The Documents view: a browser of the Quest's documents beside the open tabs. */
export function QuestDocumentsView() {
  const { environmentId } = useQuest();
  const tabs = useQuestDocumentTabs(environmentId);
  return (
    <div className="flex min-h-0 flex-1">
      <nav
        aria-label="Quest documents"
        className={cn(
          "shrink-0 overflow-y-auto border-r p-4 md:w-80",
          tabs.open.length > 0 ? "max-md:hidden" : "max-md:flex-1",
        )}
      >
        <DocumentsList />
      </nav>
      <QuestDocumentTabs placement="documents" />
    </div>
  );
}

/** Open documents beside the conversation: T3's resizable panel, a sheet on narrow layouts. */
export function QuestDocumentsBeside() {
  const { environmentId } = useQuest();
  const narrow = useMediaQuery("max-lg");
  if (narrow)
    return (
      <RightPanelSheet
        animationDurationMs={200}
        open
        onClose={() => showQuestDocumentsBeside(environmentId, false)}
      >
        <QuestDocumentTabs placement="beside" />
      </RightPanelSheet>
    );
  return (
    <PreviewPanelShell
      mode="inline"
      widthStorageKey="t3code:quest-documents-width"
      defaultWidth={560}
      workspaceLabel="Quest documents"
    >
      <QuestDocumentTabs placement="beside" />
    </PreviewPanelShell>
  );
}

function QuestDocumentSurface({ tabId }: { tabId: string }) {
  const { state } = useQuest();
  const tab = resolveTab(state, tabId);
  if (!tab)
    return (
      <p className="p-4 text-sm text-muted-foreground">This document is no longer in the Quest.</p>
    );
  if (tab.kind === "file") return <FileSurface file={tab.file} />;
  if (tab.kind === "record") return <RecordSurface document={tab.document} />;
  return <PinnedSurface tab={tab} />;
}

/** Rendered Markdown or its source, through T3's renderer and read-only source view. */
function DocumentBody({ name, text, rendered }: { name: string; text: string; rendered: boolean }) {
  if (!rendered)
    return (
      <Suspense fallback={<FileSurfaceLoading />}>
        <ReadOnlySourcePreview name={name} text={text} wordWrap />
      </Suspense>
    );
  return (
    <ScrollArea className="min-h-0 flex-1">
      <QuestMarkdown text={maskMarkdownFrontmatter(text)} className="mx-auto max-w-4xl px-6 py-5" />
    </ScrollArea>
  );
}

function RenderedToggle({
  rendered,
  onChange,
}: {
  rendered: boolean;
  onChange: (rendered: boolean) => void;
}) {
  return (
    <FileSurfaceAction
      label={rendered ? "Show markdown source" : "Show rendered markdown"}
      pressed={rendered}
      onPress={() => onChange(!rendered)}
    >
      <MorphIcon className="size-3.5" icon={rendered ? Code2 : Eye} />
    </FileSurfaceAction>
  );
}

function SurfaceHeader({
  path,
  badges,
  actions,
}: {
  path: string;
  badges?: ReactNode;
  actions: ReactNode;
}) {
  return (
    <div className={FILE_SURFACE_SUBHEADER_CLASS}>
      <Tooltip>
        <TooltipTrigger
          render={<span className="min-w-0 truncate text-xs text-muted-foreground">{path}</span>}
        />
        <TooltipPopup>{path}</TooltipPopup>
      </Tooltip>
      {badges}
      <span className="ms-auto flex shrink-0 items-center gap-1">{actions}</span>
    </div>
  );
}

function UsedBy({ documentId }: { documentId: string }) {
  const { state, openPanel } = useQuest();
  const users = state.work.filter((item) => item.documentIds.includes(documentId));
  if (users.length === 0) return null;
  return (
    <p className="shrink-0 truncate border-t px-3 py-1.5 text-xs text-muted-foreground">
      Used by{" "}
      {users.map((item, index) => (
        <span key={item.id}>
          {index > 0 ? ", " : null}
          <button
            type="button"
            className="underline hover:text-foreground"
            onClick={() => openPanel({ type: "work", id: item.id })}
          >
            {item.title}
          </button>
        </span>
      ))}
    </p>
  );
}

/** A registered Markdown file: the file owns its bytes, the Quest only its identity and history. */
function FileSurface({ file }: { file: QuestFile }) {
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
  const [rendered, setRendered] = useState(true);
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
        path={`${file.path}${current?.sha256 ? ` · ${current.sha256.slice(0, 10)}` : ""}`}
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
              <RenderedToggle rendered={rendered} onChange={setRendered} />
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
          />
        </Suspense>
      ) : current?.content != null ? (
        <DocumentBody name={file.path} text={current.content} rendered={rendered} />
      ) : (
        <p role="alert" className="p-4 text-sm">
          {current?.unavailable ?? query.error ?? (canReadFiles ? "Loading…" : null)}
        </p>
      )}
      <UsedBy documentId={file.id} />
    </article>
  );
}

/** A legacy Quest note (editable as a Quest record) or captured evidence (read only). */
function RecordSurface({ document }: { document: QuestDocument }) {
  const { environmentId, canWrite, pending } = useQuest();
  const editor = useQuestDraft(environmentId, `document:${document.id}`);
  const [rendered, setRendered] = useState(true);
  return (
    <article aria-label={document.title} className="flex min-h-0 flex-1 flex-col">
      <SurfaceHeader
        path={document.source}
        badges={
          document.kind === "evidence" ? (
            <Badge variant="outline" size="sm">
              Evidence · read only
            </Badge>
          ) : (
            <Badge variant="info" size="sm">
              Quest note
            </Badge>
          )
        }
        actions={
          editor.draft ? null : (
            <>
              <RenderedToggle rendered={rendered} onChange={setRendered} />
              {document.kind === "living" && canWrite ? (
                <FileSurfaceAction label="Edit" disabled={pending} onPress={() => editor.update()}>
                  <PencilIcon className="size-3.5" />
                </FileSurfaceAction>
              ) : null}
            </>
          )
        }
      />
      {editor.draft ? (
        <ScrollArea className="min-h-0 flex-1">
          <div className="p-4">
            <DocumentEditor document={document} />
          </div>
        </ScrollArea>
      ) : (
        <DocumentBody name={`${document.title}.md`} text={document.body} rendered={rendered} />
      )}
      <UsedBy documentId={document.id} />
    </article>
  );
}

/** The exact bytes a conversation pinned, retained by the Quest. Never editable. */
function PinnedSurface({ tab }: { tab: Extract<DocumentTab, { kind: "pinned" }> }) {
  const { environmentId, state } = useQuest();
  const canReadFiles = useEnvironmentScope(environmentId, AuthFilesystemReadScope);
  const record = state.documents.find((item) => item.id === tab.id);
  // A Quest record's own text is the pinned text when the hashes match.
  const own = record && record.sha256 === tab.sha256 ? record.body : null;
  const retained = useEnvironmentQuery(
    own === null && canReadFiles
      ? questEnvironment.retained({ environmentId, input: { sha256: tab.sha256 } })
      : null,
  );
  const [rendered, setRendered] = useState(true);
  const text = own ?? retained.data?.content ?? null;
  return (
    <article aria-label={`${tab.path} pinned version`} className="flex min-h-0 flex-1 flex-col">
      <SurfaceHeader
        path={`${tab.path} · pinned ${tab.sha256.slice(0, 10)}`}
        badges={
          <Badge variant="outline" size="sm">
            Pinned version · read only
          </Badge>
        }
        actions={
          <>
            <RenderedToggle rendered={rendered} onChange={setRendered} />
            <Button
              size="xs"
              variant="ghost"
              onClick={() => openQuestDocumentTab(environmentId, tab.id, false)}
            >
              Open current
            </Button>
          </>
        }
      />
      {text !== null ? (
        <DocumentBody name={tab.path} text={text} rendered={rendered} />
      ) : (
        <p role="alert" className="p-4 text-sm">
          {!canReadFiles
            ? "Reading pinned file versions needs file access on this connection."
            : (retained.error ??
              (retained.data ? "This version is no longer retained." : "Loading…"))}
        </p>
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
      <p className="mt-1 break-all text-xs text-muted-foreground">
        Expected {write.expectedSha256.slice(0, 12)} · draft {write.desiredSha256.slice(0, 12)}
        {write.actualSha256 ? ` · found ${write.actualSha256.slice(0, 12)}` : ""}
      </p>
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

function DocumentsList() {
  const { environmentId, state, pending, save, openDocument } = useQuest();
  // Registering exposes files on this environment, so it needs the file read grant too.
  const canWrite = useAtomValue(
    questEnvironment.update.permissionAtom(environmentId, {
      change: { type: "file-register" },
    }),
  );
  const files = useEnvironmentQuery(
    state.workspace && canWrite
      ? questEnvironment.workspaceFiles({ environmentId, input: {} })
      : null,
  ).data;
  const [root, setRoot] = useState("");
  const [path, setPath] = useState("");
  const [title, setTitle] = useState("");
  const registered = new Set(state.files.map((file) => file.path));
  const candidates = (files?.paths ?? []).filter((item) => !registered.has(item));
  return (
    <div>
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Quest workspace
        </h3>
        {state.workspace ? (
          <p className="break-all text-sm">{state.workspace.root}</p>
        ) : canWrite ? (
          <form
            className="grid gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void save({ type: "workspace-register", root }).then((ok) => ok && setRoot(""));
            }}
          >
            <p className="text-xs text-muted-foreground">
              A folder on this environment holding the Quest's Markdown, independent of code
              checkouts.
            </p>
            <Input
              aria-label="Workspace folder"
              placeholder="/home/user/quests/example"
              value={root}
              onChange={(event) => setRoot(event.target.value)}
            />
            <div>
              <Button type="submit" size="sm" disabled={pending || !root.trim()}>
                Register folder
              </Button>
            </div>
          </form>
        ) : (
          <p className="text-sm text-muted-foreground">No workspace registered · Read only</p>
        )}
      </section>
      <section className="mt-5">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Files · {state.files.length}
        </h3>
        <ul>
          {state.files.map((file) => {
            const write = state.pendingWrites.find((item) => item.documentId === file.id);
            return (
              <li key={file.id}>
                <button
                  type="button"
                  className="text-start text-sm underline"
                  onClick={() => openDocument(file.id)}
                >
                  {file.title}
                </button>
                <span className="ms-2 text-xs text-muted-foreground">{file.path}</span>
                {write ? (
                  <Badge className="ms-2" variant="warning" size="sm">
                    {write.status}
                  </Badge>
                ) : null}
              </li>
            );
          })}
        </ul>
        {state.workspace && canWrite ? (
          <form
            className="mt-3 grid gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void save({ type: "file-register", path, title }).then((ok) => {
                if (!ok) return;
                setPath("");
                setTitle("");
              });
            }}
          >
            <QuestSelect
              label="File to register"
              value={path}
              onChange={(value) => {
                setPath(value);
                if (!title) setTitle(value.split("/").at(-1)?.replace(/\.md$/i, "") ?? "");
              }}
              options={[
                {
                  value: "",
                  label: candidates.length
                    ? "Choose a Markdown file"
                    : "No unregistered Markdown files",
                },
                ...candidates.map((item) => ({ value: item, label: item })),
              ]}
            />
            <Input
              aria-label="Document title"
              placeholder="Title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
            <div>
              <Button type="submit" size="sm" disabled={pending || !path || !title.trim()}>
                Register file
              </Button>
            </div>
          </form>
        ) : null}
      </section>
      <section className="mt-5">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Kept in the Quest · {state.documents.length}
        </h3>
        <ul>
          {state.documents.map((doc) => (
            <li key={doc.id}>
              <button
                type="button"
                className="text-start text-sm underline"
                onClick={() => openDocument(doc.id)}
              >
                {doc.title}
              </button>
              <span className="ms-2 text-xs text-muted-foreground">
                {doc.kind === "evidence" ? "Evidence · read only" : "Quest note"}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

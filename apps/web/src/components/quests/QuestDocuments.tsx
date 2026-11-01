import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  questQuestionStatus,
  type QuestFile,
  type QuestPendingWrite,
  type QuestWriteResult,
} from "@t3tools/contracts";
import { useState } from "react";

import { randomUUID } from "~/lib/utils";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { useQuest } from "./questContext";
import { QuestSelect } from "./QuestConversations";
import { draftText, useQuestDraft } from "./questDraftStore";
import { questEnvironment } from "./questEnvironment";
import { QuestMarkdown } from "./QuestMarkdown";

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

/** A registered Markdown file: the file owns its bytes, the Quest only its identity and history. */
export function FileDocumentView({ file }: { file: QuestFile }) {
  const { environmentId, state, canWrite, adopt, save, openPanel } = useQuest();
  const query = useEnvironmentQuery(
    questEnvironment.document({ environmentId, input: { documentId: file.id } }),
  );
  const editor = useQuestDraft(environmentId, `file:${file.id}`);
  const write = useAtomCommand(questEnvironment.writeDocument, { reportFailure: false });
  const recover = useAtomCommand(questEnvironment.recoverWrite, { reportFailure: false });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const pendingWrite = state.pendingWrites.find((item) => item.documentId === file.id) ?? null;
  const current = query.data;
  const users = state.work.filter((item) => item.documentIds.includes(file.id));
  const base = draftText(editor.draft, "base", "");
  const content = draftText(editor.draft, "content", current?.content ?? "");

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
    <article aria-label={file.title}>
      <div className="flex items-center gap-2">
        <Badge variant="info">Markdown file</Badge>
        {canWrite && !editor.draft && current?.content != null && !pendingWrite ? (
          <span className="ms-auto">
            <Button
              size="xs"
              variant="outline"
              onClick={() =>
                editor.update({ base: current.sha256 ?? "", content: current.content ?? "" })
              }
            >
              Edit
            </Button>
          </span>
        ) : null}
      </div>
      <h2 className="mt-2 text-lg font-semibold">{file.title}</h2>
      <p className="mt-1 break-all text-xs text-muted-foreground">
        {file.path} in the Quest workspace
        {current?.sha256 ? (
          <>
            <br />
            Current content SHA-256: {current.sha256}
          </>
        ) : null}
      </p>
      {notice ? (
        <p role="status" className="mt-3 rounded border p-2 text-sm">
          {notice}
        </p>
      ) : null}
      {pendingWrite ? (
        <PendingWrite
          write={pendingWrite}
          busy={busy}
          canWrite={canWrite}
          onRecover={() => void recoverWrite()}
          onDiscard={() => void save({ type: "write-discard", writeId: pendingWrite.id })}
          onUseDraft={(text) =>
            editor.update({ base: current?.sha256 ?? "", content: text, op: "" })
          }
        />
      ) : null}
      {editor.draft ? (
        <form
          className="mt-4"
          onSubmit={(event) => {
            event.preventDefault();
            void saveFile();
          }}
        >
          <fieldset disabled={busy || !canWrite} className="grid gap-2">
            <Textarea
              aria-label="File content"
              value={content}
              onChange={(event) => editor.update({ content: event.target.value })}
              rows={18}
            />
            {current?.sha256 && base && current.sha256 !== base ? (
              <p className="text-xs text-warning-foreground">
                The file changed since you started editing. Saving will be refused; copy what you
                need from the current file first.
              </p>
            ) : null}
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={pendingWrite !== null}>
                Save to file
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={editor.clear}>
                Cancel
              </Button>
            </div>
          </fieldset>
        </form>
      ) : null}
      <div className="mt-4">
        {current?.content != null ? (
          <QuestMarkdown text={current.content} />
        ) : (
          <p role="alert" className="text-sm">
            {current?.unavailable ?? query.error ?? "Loading…"}
          </p>
        )}
      </div>
      {users.length > 0 ? (
        <section className="mt-6">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Used by
          </h3>
          <ul>
            {users.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="text-sm underline"
                  onClick={() => openPanel({ type: "work", id: item.id }, "push")}
                >
                  {item.title}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  );
}

function PendingWrite({
  write,
  busy,
  canWrite,
  onRecover,
  onDiscard,
  onUseDraft,
}: {
  write: QuestPendingWrite;
  busy: boolean;
  canWrite: boolean;
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
        <Button size="xs" variant="ghost" onClick={() => setShown((value) => !value)}>
          {shown ? "Hide my draft" : "Show my draft"}
        </Button>
        {canWrite && draft?.content != null ? (
          <Button size="xs" variant="ghost" onClick={() => onUseDraft(draft.content ?? "")}>
            Edit my draft against the current file
          </Button>
        ) : null}
        {canWrite ? (
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

export function DocumentsList() {
  const { environmentId, state, canWrite, pending, save, openPanel } = useQuest();
  const files = useEnvironmentQuery(
    state.workspace ? questEnvironment.workspaceFiles({ environmentId, input: {} }) : null,
  ).data;
  const [root, setRoot] = useState("");
  const [path, setPath] = useState("");
  const [title, setTitle] = useState("");
  const registered = new Set(state.files.map((file) => file.path));
  const candidates = (files?.paths ?? []).filter((item) => !registered.has(item));
  return (
    <div>
      <h2 className="text-lg font-semibold">Documents</h2>
      <section className="mt-5">
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
                  className="text-sm underline"
                  onClick={() => openPanel({ type: "document", id: file.id }, "push")}
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
                className="text-sm underline"
                onClick={() => openPanel({ type: "document", id: doc.id }, "push")}
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

/** Shows one saved revision rebuilt from the baseline and revision records. */
export function ReconstructRevision() {
  const { environmentId, state } = useQuest();
  const [value, setValue] = useState("");
  const [revision, setRevision] = useState<number | null>(null);
  const query = useEnvironmentQuery(
    revision === null ? null : questEnvironment.reconstruct({ environmentId, input: { revision } }),
  );
  const past = query.data;
  const title = (workId: string | null) =>
    past?.domain.work.find((item) => item.id === workId)?.title;
  return (
    <section className="mt-4 rounded border p-3 text-sm">
      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const parsed = Number.parseInt(value, 10);
          if (Number.isInteger(parsed)) setRevision(parsed);
        }}
      >
        <label className="grid gap-1 text-xs text-muted-foreground">
          Show the saved Quest at revision
          <Input
            aria-label="Revision"
            inputMode="numeric"
            placeholder={String(state.revision)}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </label>
        <Button type="submit" size="sm" variant="outline">
          Show
        </Button>
      </form>
      {revision !== null && query.error ? (
        <p role="alert" className="mt-2 text-xs">
          {query.error}
        </p>
      ) : null}
      {past ? (
        <div className="mt-3 grid gap-2">
          <p className="text-xs text-muted-foreground">{past.limit}</p>
          <p>
            Revision {past.revision} · current milestone{" "}
            {title(past.domain.currentWorkId) ?? "none"}
          </p>
          <div>
            <p className="text-xs font-medium">Conversations</p>
            <ul className="text-xs">
              {past.domain.conversations.length === 0 ? <li>None</li> : null}
              {past.domain.conversations.map((item) => (
                <li key={item.threadId}>
                  {item.purpose || item.title} · {item.role}
                  {item.workId ? ` · about ${title(item.workId) ?? item.workId}` : ""}
                  {item.questionId
                    ? ` · about ${past.domain.questions.find((q) => q.id === item.questionId)?.title ?? item.questionId}`
                    : ""}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-xs font-medium">Decisions</p>
            <ul className="text-xs">
              {past.domain.questions.map((item) => (
                <li key={item.id}>
                  {item.title} · {questQuestionStatus(item)}
                  {item.answer ? ` · “${item.answer}”` : ""}
                </li>
              ))}
            </ul>
          </div>
          {past.records.at(-1)?.revision === past.revision ? (
            <div>
              <p className="text-xs font-medium">Changed in this revision</p>
              <ul className="text-xs">
                {past.records.at(-1)!.changes.map((change) => (
                  <li key={`${change.collection}:${change.id}`}>
                    {change.collection} · {change.id} ·{" "}
                    {change.before === null
                      ? "created"
                      : change.after === null
                        ? "removed"
                        : "changed"}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

import type { QuestDocument, QuestQuestion, QuestWork } from "@t3tools/contracts";
import type { FormEvent, ReactNode } from "react";

import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { useQuest } from "./questContext";
import { draftText, useQuestDraft } from "./questDraftStore";
import { workStateLabels } from "./questModel";
import { QuestSelect } from "./QuestConversations";

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="mb-4 block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}

function formText(data: FormData, key: string) {
  return String(data.get(key) ?? "");
}

/** Records typed text into the editor's draft so it survives panel and route changes. */
function captureText(update: (fields: Record<string, string>) => void) {
  return (event: FormEvent<HTMLFormElement>) => {
    const target = event.target;
    if (
      (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) &&
      target.name
    )
      update({ [target.name]: target.value });
  };
}

/** The editor's draft; its presence is what keeps the editor open. */
export function useEditorDraft(editor: "work" | "handoff" | "documents" | "document", id: string) {
  const { environmentId } = useQuest();
  return useQuestDraft(environmentId, `${editor}:${id}`);
}

function EditorActions({ onCancel, submit }: { onCancel: () => void; submit: string }) {
  return (
    <div className="flex gap-2">
      <Button type="submit" size="sm">
        {submit}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}

export function WorkEditor({ work }: { work: QuestWork }) {
  const { state, save, pending, canWrite } = useQuest();
  const { draft, update, clear } = useEditorDraft("work", work.id);
  const text = (field: keyof QuestWork & string) =>
    draftText(draft, field, String(work[field] ?? ""));
  return (
    <form
      onInput={captureText(update)}
      onSubmit={async (event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const saved = await save({
          type: "work",
          work: {
            ...work,
            title: formText(data, "title"),
            state: formText(data, "state") as QuestWork["state"],
            owner: formText(data, "owner"),
            agent: formText(data, "agent"),
            understanding: formText(data, "understanding"),
            parentId: formText(data, "parentId") || null,
          },
        });
        if (saved) clear();
      }}
    >
      <fieldset disabled={pending || !canWrite} className="min-w-0">
        <Field label="Work title">
          <Input name="title" defaultValue={text("title")} required />
        </Field>
        <Field label="Current understanding">
          <Textarea name="understanding" defaultValue={text("understanding")} rows={7} />
        </Field>
        <div className="grid gap-x-4 sm:grid-cols-2">
          <Field label="Work state">
            <QuestSelect
              label="Work state"
              name="state"
              defaultValue={text("state")}
              onChange={(value) => update({ state: value })}
              options={Object.entries(workStateLabels).map(([value, label]) => ({ value, label }))}
            />
          </Field>
          <Field label="Part of">
            <QuestSelect
              label="Part of"
              name="parentId"
              defaultValue={text("parentId")}
              onChange={(value) => update({ parentId: value })}
              options={[
                { value: "", label: "Quest root" },
                ...state.work
                  .filter((item) => item.id !== work.id)
                  .map((item) => ({ value: item.id, label: item.title })),
              ]}
            />
          </Field>
          <Field label="Human owner">
            <Input name="owner" defaultValue={text("owner")} />
          </Field>
          <Field label="Agent">
            <Input name="agent" defaultValue={text("agent")} />
          </Field>
        </div>
        <EditorActions onCancel={clear} submit="Save work" />
      </fieldset>
    </form>
  );
}

export function HandoffEditor({ work }: { work: QuestWork }) {
  const { state, save, pending, canWrite } = useQuest();
  const { draft, update, clear } = useEditorDraft("handoff", work.id);
  return (
    <form
      onInput={captureText(update)}
      onSubmit={async (event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const saved = await save({
          type: "work",
          work: {
            ...work,
            priorAttempts: formText(data, "priorAttempts"),
            findings: formText(data, "findings"),
            handoff: formText(data, "handoff"),
          },
        });
        if (saved) clear();
      }}
    >
      <fieldset disabled={pending || !canWrite} className="min-w-0">
        <Field label="Previous attempts">
          <Textarea
            name="priorAttempts"
            defaultValue={draftText(draft, "priorAttempts", work.priorAttempts)}
            rows={4}
          />
        </Field>
        <Field label="Open findings">
          <Textarea
            name="findings"
            defaultValue={draftText(draft, "findings", work.findings)}
            rows={4}
          />
        </Field>
        <Field label="Handoff">
          <Textarea
            name="handoff"
            defaultValue={draftText(draft, "handoff", work.handoff)}
            rows={6}
          />
        </Field>
        <p className="mb-4 text-xs text-muted-foreground">
          Documents:{" "}
          {state.documents
            .filter((doc) => work.documentIds.includes(doc.id))
            .map((doc) => doc.title)
            .join("; ") || "None"}
        </p>
        <EditorActions onCancel={clear} submit="Save handoff" />
      </fieldset>
    </form>
  );
}

export function DocumentAssociations({ work }: { work: QuestWork }) {
  const { state, save, pending, canWrite } = useQuest();
  const { draft, update, clear } = useEditorDraft("documents", work.id);
  const drafted = draft?.documentIds;
  const selected = typeof drafted === "object" ? drafted : work.documentIds;
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        const saved = await save({ type: "work", work: { ...work, documentIds: [...selected] } });
        if (saved) clear();
      }}
    >
      <fieldset disabled={pending || !canWrite}>
        {[
          ...state.documents.map((item) => ({
            id: item.id,
            label: `${item.title} · ${item.kind === "evidence" ? "evidence" : "Quest note"}`,
          })),
          ...state.files.map((item) => ({ id: item.id, label: `${item.title} · ${item.path}` })),
        ].map((item) => (
          <label key={item.id} className="mb-2 flex items-start gap-2 text-sm">
            <Checkbox
              name="documentIds"
              value={item.id}
              checked={selected.includes(item.id)}
              onCheckedChange={(checked) =>
                update({
                  documentIds: checked
                    ? [...selected.filter((id) => id !== item.id), item.id]
                    : selected.filter((id) => id !== item.id),
                })
              }
            />
            <span>{item.label}</span>
          </label>
        ))}
        <EditorActions onCancel={clear} submit="Save associations" />
      </fieldset>
    </form>
  );
}

export function DocumentEditor({ document }: { document: QuestDocument }) {
  const { save, pending, canWrite } = useQuest();
  const { draft, update, clear } = useEditorDraft("document", document.id);
  return (
    <form
      onInput={captureText(update)}
      onSubmit={async (event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const saved = await save({
          type: "document",
          document: { ...document, title: formText(data, "title"), body: formText(data, "body") },
        });
        if (saved) clear();
      }}
    >
      <fieldset disabled={pending || !canWrite}>
        <Field label="Document title">
          <Input name="title" defaultValue={draftText(draft, "title", document.title)} required />
        </Field>
        <Field label="Document content">
          <Textarea name="body" defaultValue={draftText(draft, "body", document.body)} rows={14} />
        </Field>
        <EditorActions onCancel={clear} submit="Save document" />
      </fieldset>
    </form>
  );
}

/** Prepares a new question or edits one not yet applied; drafts survive panel changes. */
export function QuestionEditor({
  question,
  workId,
  onDone,
}: {
  question?: QuestQuestion;
  workId?: string;
  onDone: () => void;
}) {
  const { environmentId, state, save, pending, canWrite } = useQuest();
  const { draft, update, clear } = useQuestDraft(
    environmentId,
    `question-editor:${question?.id ?? "new"}`,
  );
  const chosenWork = draftText(
    draft,
    "workId",
    question?.workId ?? workId ?? state.currentWorkId ?? "",
  );
  return (
    <form
      onInput={captureText(update)}
      onSubmit={async (event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const prepared = {
          workId: chosenWork,
          title: formText(data, "title"),
          context: formText(data, "context"),
          alternatives: formText(data, "alternatives").split("\n"),
        };
        const saved = await save(
          question
            ? { type: "question-edit", questionId: question.id, question: prepared }
            : { type: "question-create", question: prepared },
        );
        if (!saved) return;
        clear();
        onDone();
      }}
    >
      <fieldset disabled={pending || !canWrite}>
        <Field label="Affects">
          <QuestSelect
            label="Affected work"
            value={chosenWork}
            onChange={(value) => update({ workId: value })}
            options={state.work.map((item) => ({ value: item.id, label: item.title }))}
          />
        </Field>
        <Field label="Question">
          <Input
            name="title"
            defaultValue={draftText(draft, "title", question?.title ?? "")}
            required
          />
        </Field>
        <Field label="Context">
          <Textarea
            name="context"
            defaultValue={draftText(draft, "context", question?.context ?? "")}
            rows={4}
          />
        </Field>
        <Field label="Alternatives, one per line">
          <Textarea
            name="alternatives"
            defaultValue={draftText(draft, "alternatives", question?.alternatives.join("\n") ?? "")}
            rows={3}
          />
        </Field>
        <EditorActions
          onCancel={() => {
            clear();
            onDone();
          }}
          submit={question ? "Save question" : "Prepare question"}
        />
      </fieldset>
    </form>
  );
}

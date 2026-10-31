import type { QuestDocument, QuestWork } from "@t3tools/contracts";
import type { ReactNode } from "react";

import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { useQuest } from "./questContext";
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

export function WorkEditor({ work, onCancel }: { work: QuestWork; onCancel: () => void }) {
  const { state, save, pending, canWrite } = useQuest();
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        void save({
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
      }}
    >
      <fieldset disabled={pending || !canWrite} className="min-w-0">
        <Field label="Work title">
          <Input name="title" defaultValue={work.title} required />
        </Field>
        <Field label="Current understanding">
          <Textarea name="understanding" defaultValue={work.understanding} rows={7} />
        </Field>
        <div className="grid gap-x-4 sm:grid-cols-2">
          <Field label="Work state">
            <QuestSelect
              label="Work state"
              name="state"
              defaultValue={work.state}
              options={Object.entries(workStateLabels).map(([value, label]) => ({ value, label }))}
            />
          </Field>
          <Field label="Part of">
            <QuestSelect
              label="Part of"
              name="parentId"
              defaultValue={work.parentId ?? ""}
              options={[
                { value: "", label: "Quest root" },
                ...state.work
                  .filter((item) => item.id !== work.id)
                  .map((item) => ({ value: item.id, label: item.title })),
              ]}
            />
          </Field>
          <Field label="Human owner">
            <Input name="owner" defaultValue={work.owner} />
          </Field>
          <Field label="Agent assignment (separate from ownership)">
            <Input name="agent" defaultValue={work.agent} />
          </Field>
        </div>
        <EditorActions onCancel={onCancel} submit="Save work" />
      </fieldset>
    </form>
  );
}

export function HandoffEditor({ work, onCancel }: { work: QuestWork; onCancel: () => void }) {
  const { state, save, pending, canWrite } = useQuest();
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        void save({
          type: "work",
          work: {
            ...work,
            priorAttempts: formText(data, "priorAttempts"),
            findings: formText(data, "findings"),
            handoff: formText(data, "handoff"),
          },
        });
      }}
    >
      <fieldset disabled={pending || !canWrite} className="min-w-0">
        <p className="mb-4 text-xs text-muted-foreground">
          Saving prepares a handoff for a future attempt. It does not assign an agent or start
          anything.
        </p>
        <Field label="Previous attempts and retained results">
          <Textarea name="priorAttempts" defaultValue={work.priorAttempts} rows={4} />
        </Field>
        <Field label="Unresolved findings and stop conditions">
          <Textarea name="findings" defaultValue={work.findings} rows={4} />
        </Field>
        <Field label="Prepared handoff · scope, evidence, allowed actions">
          <Textarea name="handoff" defaultValue={work.handoff} rows={6} />
        </Field>
        <p className="mb-4 text-xs text-muted-foreground">
          Evidence included:{" "}
          {state.documents
            .filter((doc) => work.documentIds.includes(doc.id))
            .map((doc) => doc.title)
            .join("; ") || "no documents associated yet"}
        </p>
        <EditorActions onCancel={onCancel} submit="Save prepared handoff" />
      </fieldset>
    </form>
  );
}

export function DocumentAssociations({
  work,
  onCancel,
}: {
  work: QuestWork;
  onCancel: () => void;
}) {
  const { state, save, pending, canWrite } = useQuest();
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        void save({
          type: "work",
          work: { ...work, documentIds: data.getAll("documentIds").map(String) },
        });
      }}
    >
      <fieldset disabled={pending || !canWrite}>
        {state.documents.map((item) => (
          <label key={item.id} className="mb-2 flex items-start gap-2 text-sm">
            <Checkbox
              name="documentIds"
              value={item.id}
              defaultChecked={work.documentIds.includes(item.id)}
            />
            <span>
              {item.title} · {item.kind === "evidence" ? "captured evidence" : "living document"}
            </span>
          </label>
        ))}
        <EditorActions onCancel={onCancel} submit="Save associations" />
      </fieldset>
    </form>
  );
}

export function DocumentEditor({
  document,
  onCancel,
}: {
  document: QuestDocument;
  onCancel: () => void;
}) {
  const { save, pending, canWrite } = useQuest();
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        void save({
          type: "document",
          document: { ...document, title: formText(data, "title"), body: formText(data, "body") },
        });
      }}
    >
      <fieldset disabled={pending || !canWrite}>
        <Field label="Document title">
          <Input name="title" defaultValue={document.title} required />
        </Field>
        <Field label="Document content">
          <Textarea name="body" defaultValue={document.body} rows={14} />
        </Field>
        <EditorActions onCancel={onCancel} submit="Save document" />
      </fieldset>
    </form>
  );
}

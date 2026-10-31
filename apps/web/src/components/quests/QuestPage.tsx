import { useAtomValue } from "@effect/atom-react";
import { createQuestEnvironmentAtoms } from "@t3tools/client-runtime/state/quests";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  QuestDocument,
  QuestQuestion,
  QuestState,
  QuestUpdateInput,
  QuestWork,
} from "@t3tools/contracts";
import { ChevronDownIcon, ChevronRightIcon, CompassIcon } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";

import { connectionAtomRuntime } from "~/connection/runtime";
import { useEnvironments, usePrimaryEnvironmentId } from "~/state/environments";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { AppRouteModal, AppRouteModalClose } from "../AppRouteModal";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Checkbox } from "../ui/checkbox";
import { Radio, RadioGroup } from "../ui/radio-group";
import { Select, SelectTrigger, SelectValue, SelectPopup, SelectItem } from "../ui/select";
import { Textarea } from "../ui/textarea";

const questEnvironment = createQuestEnvironmentAtoms(connectionAtomRuntime);
const stateLabels = {
  active: "Active",
  attention: "Human attention",
  review: "Awaiting review",
  deferred: "Deferred",
  done: "Recorded outcome",
} as const;
const stateVariants = {
  active: "info",
  attention: "warning",
  review: "secondary",
  deferred: "outline",
  done: "success",
} as const;
type Change = QuestUpdateInput["change"];
type Save = (change: Change) => Promise<boolean>;

export function QuestPage() {
  const primaryId = usePrimaryEnvironmentId();
  const { environments } = useEnvironments();
  const [selectedEnvironment, setSelectedEnvironment] = useState<EnvironmentId | null>(null);
  const environmentId = selectedEnvironment ?? primaryId;
  return (
    <AppRouteModal label="Quests prototype">
      <header className="flex items-center justify-between gap-4 border-b p-4">
        <div className="flex items-center gap-3">
          <CompassIcon className="size-5" />
          <h1 className="font-semibold">Quests</h1>
          <Badge variant="outline">Interaction prototype</Badge>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-sm">
            Environment{" "}
            <QuestSelect
              value={environmentId ?? ""}
              onChange={(value) => setSelectedEnvironment(value as EnvironmentId)}
              options={environments.map((environment) => ({
                value: environment.environmentId,
                label: environment.label,
              }))}
            />
          </label>
          <AppRouteModalClose />
        </div>
      </header>
      {environmentId ? (
        <QuestLoader key={environmentId} environmentId={environmentId} />
      ) : (
        <p className="p-6">Connect an environment to open its Quest example.</p>
      )}
    </AppRouteModal>
  );
}

function QuestLoader({ environmentId }: { environmentId: EnvironmentId }) {
  const query = useEnvironmentQuery(questEnvironment.get({ environmentId, input: {} }));
  if (!query.data)
    return (
      <div className="p-6">
        <p role={query.error ? "alert" : "status"}>{query.error ?? "Loading retained example…"}</p>
        {query.error ? <Button onClick={query.refresh}>Try again</Button> : null}
      </div>
    );
  return <QuestWorkspace environmentId={environmentId} initial={query.data} />;
}

function QuestWorkspace({
  environmentId,
  initial,
}: {
  environmentId: EnvironmentId;
  initial: QuestState;
}) {
  const [state, setState] = useState(initial);
  const [selectedId, setSelectedId] = useState(initial.work[0]?.id ?? "");
  const [tab, setTab] = useState<"work" | "question" | "documents" | "handoff">("work");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const [editorEpoch, setEditorEpoch] = useState(0);
  const pendingRef = useRef(false);
  const canWrite = useAtomValue(questEnvironment.update.permissionAtom(environmentId));
  const update = useAtomCommand(questEnvironment.update, { reportFailure: false });
  const read = useAtomCommand(questEnvironment.read, { reportFailure: false });
  const selected = state.work.find((work) => work.id === selectedId) ?? state.work[0];
  async function save(change: Change) {
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
    setNotice(`Saved in this environment · revision ${result.value.revision}`);
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
      setEditorEpoch((epoch) => epoch + 1);
      setNotice("Saved version loaded. Local drafts were discarded.");
    } else setNotice("Could not reload. Your current draft has been kept.");
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="border-b bg-muted/30 px-6 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Market tracking</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Historical snapshot · captured 31 October 2026 · editable isolated example
            </p>
          </div>
          <Button variant="outline" disabled={pending} onClick={() => void reload()}>
            Reload saved version (discard drafts)
          </Button>
        </div>
        <p className="mt-3 max-w-4xl text-sm">
          The newer work index records Milestone A as active. An older queue still says planning.
          Nine older deliveries await review; they are not nine active queues. Sources stay readable
          alongside the current understanding.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {Object.entries(stateLabels).map(([status, label]) => (
            <span key={status} className="rounded border bg-background px-3 py-2 text-xs">
              <strong>{state.work.filter((work) => work.state === status).length}</strong> {label}
            </span>
          ))}
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <aside
          className="shrink-0 border-b p-4 md:w-72 md:overflow-y-auto md:border-r md:border-b-0"
          aria-label="Quest work tree"
        >
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Work and responsibilities
          </p>
          <WorkTree
            work={state.work}
            parentId={null}
            selectedId={selectedId}
            onSelect={(id) => {
              setSelectedId(id);
              setTab("work");
            }}
          />
        </aside>
        <main className="min-w-0 flex-1 overflow-y-auto p-6">
          {selected ? (
            <>
              <div className="mb-4 flex items-center gap-2">
                <Badge variant={stateVariants[selected.state]}>{stateLabels[selected.state]}</Badge>
                <span className="text-xs text-muted-foreground">{selected.id}</span>
              </div>
              <h2 className="text-xl font-semibold">{selected.title}</h2>
              <div className="my-5 flex flex-wrap gap-2" aria-label="Work views">
                {(
                  [
                    ["work", "Understanding"],
                    ["question", "Prepared question"],
                    ["documents", "Documents & evidence"],
                    ["handoff", "Bounded handoff"],
                  ] as const
                ).map(([value, label]) => (
                  <Button
                    key={value}
                    variant={tab === value ? "secondary" : "ghost"}
                    onClick={() => setTab(value)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
              <div key={`${selected.id}:${state.revision}:${editorEpoch}:${tab}`}>
                {tab === "documents" ? (
                  <DocumentPanel
                    work={selected}
                    state={state}
                    save={save}
                    disabled={pending || !canWrite}
                  />
                ) : (
                  <fieldset disabled={pending || !canWrite} className="min-w-0">
                    {tab === "work" ? (
                      <WorkEditor work={selected} allWork={state.work} save={save} />
                    ) : tab === "question" ? (
                      <QuestionPanel work={selected} state={state} save={save} />
                    ) : (
                      <HandoffEditor work={selected} state={state} save={save} />
                    )}
                  </fieldset>
                )}
              </div>
              {!canWrite ? (
                <p className="mt-4 text-sm">
                  This connection can read the example. Write permission is required to save
                  changes.
                </p>
              ) : null}
            </>
          ) : null}
        </main>
      </div>
      <footer className="border-t px-6 py-3 text-xs text-muted-foreground">
        <p role="status" aria-live="polite">
          {pending
            ? "Saving / loading…"
            : notice ||
              `Saved revision ${state.revision} · no provider runs or original queue changes`}
        </p>
        <p className="mt-1">
          Prototype scope: web and desktop, one server writer. Mobile, agent tools and execution
          automation are deferred.
        </p>
      </footer>
    </div>
  );
}

function WorkTree({
  work,
  parentId,
  selectedId,
  onSelect,
}: {
  work: QuestState["work"];
  parentId: string | null;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  return (
    <ul className={parentId ? "ml-3 border-l pl-2" : ""}>
      {work
        .filter((item) => item.parentId === parentId)
        .map((item) => {
          const hasChildren = work.some((child) => child.parentId === item.id);
          const isCollapsed = collapsed.has(item.id);
          return (
            <li key={item.id} className="my-1">
              <div className="flex items-start gap-1">
                {hasChildren ? (
                  <button
                    type="button"
                    className="mt-2 rounded p-1 hover:bg-accent"
                    aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${item.title}`}
                    aria-expanded={!isCollapsed}
                    onClick={() =>
                      setCollapsed((previous) => {
                        const next = new Set(previous);
                        if (next.has(item.id)) next.delete(item.id);
                        else next.add(item.id);
                        return next;
                      })
                    }
                  >
                    {isCollapsed ? (
                      <ChevronRightIcon className="size-3" />
                    ) : (
                      <ChevronDownIcon className="size-3" />
                    )}
                  </button>
                ) : (
                  <span className="w-5 shrink-0" />
                )}
                <button
                  type="button"
                  className={`min-w-0 flex-1 rounded px-2 py-2 text-left text-sm hover:bg-accent ${selectedId === item.id ? "bg-accent" : ""}`}
                  aria-current={selectedId === item.id ? "true" : undefined}
                  onClick={() => onSelect(item.id)}
                >
                  {item.title}
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {stateLabels[item.state]}
                  </span>
                </button>
              </div>
              {hasChildren && !isCollapsed ? (
                <WorkTree
                  work={work}
                  parentId={item.id}
                  selectedId={selectedId}
                  onSelect={onSelect}
                />
              ) : null}
            </li>
          );
        })}
    </ul>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
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

function WorkEditor({
  work,
  allWork,
  save,
}: {
  work: QuestWork;
  allWork: QuestState["work"];
  save: Save;
}) {
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
      <Field label="Work title">
        <Input name="title" defaultValue={work.title} required />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Human owner">
          <Input name="owner" defaultValue={work.owner} />
        </Field>
        <Field label="Agent assignment (separate from ownership)">
          <Input name="agent" defaultValue={work.agent} />
        </Field>
        <Field label="Work state">
          <QuestSelect
            name="state"
            defaultValue={work.state}
            options={Object.entries(stateLabels).map(([value, label]) => ({ value, label }))}
          />
        </Field>
        <Field label="Parent work">
          <QuestSelect
            name="parentId"
            defaultValue={work.parentId ?? ""}
            options={[
              { value: "", label: "Quest root" },
              ...allWork
                .filter((item) => item.id !== work.id)
                .map((item) => ({ value: item.id, label: item.title })),
            ]}
          />
        </Field>
      </div>
      <Field label="Current understanding · editable synthesis">
        <Textarea name="understanding" defaultValue={work.understanding} rows={7} />
      </Field>
      <Button type="submit">Save work</Button>
    </form>
  );
}

function DocumentPanel({
  work,
  state,
  save,
  disabled,
}: {
  work: QuestWork;
  state: QuestState;
  save: Save;
  disabled: boolean;
}) {
  const [documentId, setDocumentId] = useState(work.documentIds[0] ?? state.documents[0]?.id ?? "");
  const document = state.documents.find((item) => item.id === documentId);
  return (
    <div>
      <form
        className="mb-6 rounded border p-4"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          void save({
            type: "work",
            work: { ...work, documentIds: data.getAll("documentIds").map(String) },
          });
        }}
      >
        <fieldset disabled={disabled}>
          <p className="mb-2 text-sm font-medium">Documents associated with this work</p>
          {state.documents.map((item) => (
            <label key={item.id} className="mb-2 flex items-start gap-2 text-sm">
              <Checkbox
                name="documentIds"
                value={item.id}
                defaultChecked={work.documentIds.includes(item.id)}
              />
              <span>
                {item.title} · {item.kind === "evidence" ? "retained evidence" : "living document"}
              </span>
            </label>
          ))}
          <Button type="submit" variant="outline">
            Save associations
          </Button>
        </fieldset>
      </form>
      <Field label="Read or edit a document">
        <QuestSelect
          value={documentId}
          onChange={setDocumentId}
          options={state.documents.map((item) => ({ value: item.id, label: item.title }))}
        />
      </Field>
      {document ? (
        <fieldset disabled={disabled}>
          <DocumentEditor key={document.id} document={document} save={save} />
        </fieldset>
      ) : null}
    </div>
  );
}

function DocumentEditor({ document, save }: { document: QuestDocument; save: Save }) {
  if (document.kind === "evidence")
    return (
      <article>
        <Badge variant="outline">Captured evidence · read only</Badge>
        <h3 className="mt-3 font-semibold">{document.title}</h3>
        <p className="my-3 break-all text-xs text-muted-foreground">
          {document.source}
          <br />
          Retained content SHA-256: {document.sha256}
        </p>
        <pre className="whitespace-pre-wrap break-words rounded border bg-muted/20 p-4 text-sm leading-relaxed">
          {document.body}
        </pre>
      </article>
    );
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
      <Badge variant="info">Living document · prototype synthesis</Badge>
      <div className="mt-4">
        <Field label="Document title">
          <Input name="title" defaultValue={document.title} required />
        </Field>
        <Field label="Document content">
          <Textarea name="body" defaultValue={document.body} rows={12} />
        </Field>
      </div>
      <Button type="submit">Save document</Button>
    </form>
  );
}

function QuestionPanel({ work, state, save }: { work: QuestWork; state: QuestState; save: Save }) {
  const question = state.questions.find((item) => item.workId === work.id);
  if (!question)
    return (
      <div>
        <p className="text-sm text-muted-foreground">
          No prepared question is associated with this work.
        </p>
        {state.questions.map((item) => (
          <p key={item.id} className="mt-4 text-sm">
            Prepared in “{state.work.find((entry) => entry.id === item.workId)?.title}”:{" "}
            {item.title}
          </p>
        ))}
      </div>
    );
  return <QuestionEditor question={question} work={work} state={state} save={save} />;
}

function QuestionEditor({
  question,
  work,
  state,
  save,
}: {
  question: QuestQuestion;
  work: QuestWork;
  state: QuestState;
  save: Save;
}) {
  const [answer, setAnswer] = useState(question.answer ?? "");
  return (
    <div>
      <Badge variant="warning">
        {question.proposal
          ? "Prototype proposal · not an actual pending request"
          : "Prepared question"}
      </Badge>
      <h3 className="mt-4 text-lg font-medium">{question.title}</h3>
      <p className="my-3 whitespace-pre-wrap text-sm leading-relaxed">{question.context}</p>
      <p className="mb-4 text-sm">
        Affected work: <strong>{work.title}</strong>. Applying appends the recorded answer to this
        work’s current understanding.
      </p>
      <details className="mb-5 rounded border p-3">
        <summary className="cursor-pointer text-sm font-medium">Relevant retained sources</summary>
        {state.documents
          .filter((doc) => work.documentIds.includes(doc.id))
          .map((doc) => (
            <div key={doc.id} className="mt-3">
              <h4 className="text-sm font-medium">{doc.title}</h4>
              <p className="my-2 break-all text-xs text-muted-foreground">{doc.source}</p>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-sm">{doc.body}</pre>
            </div>
          ))}
      </details>
      {question.applied ? (
        <div className="my-4">
          <p className="mb-3 text-sm">
            This answer has been applied. Reopening lets you record a revision; the earlier
            application remains in the work’s understanding until you edit it.
          </p>
          <Button
            variant="outline"
            onClick={() => void save({ type: "reopen", questionId: question.id })}
          >
            Reopen question for revision
          </Button>
        </div>
      ) : (
        <>
          <RadioGroup
            value={answer}
            onValueChange={(value) => setAnswer(String(value))}
            className="mb-4"
          >
            {question.alternatives.map((alternative) => (
              <label key={alternative} className="flex gap-2 rounded border p-3 text-sm">
                <Radio value={alternative} />
                {alternative}
              </label>
            ))}
          </RadioGroup>
          <Field label="Answer or discussion note">
            <Textarea value={answer} onChange={(event) => setAnswer(event.target.value)} rows={4} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={!answer.trim()}
              onClick={() =>
                void save({ type: "answer", questionId: question.id, answer, deferred: false })
              }
            >
              Record answer
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                void save({
                  type: "answer",
                  questionId: question.id,
                  answer: answer || null,
                  deferred: true,
                })
              }
            >
              Defer question
            </Button>
            {question.answer && !question.deferred && !question.applied ? (
              <Button
                variant="secondary"
                onClick={() => void save({ type: "apply", questionId: question.id })}
              >
                Apply recorded answer to work
              </Button>
            ) : null}
          </div>
        </>
      )}
      <div className="mt-4 rounded border bg-muted/30 p-3 text-sm">
        <strong>
          {question.applied
            ? "Applied to prototype work"
            : question.deferred
              ? "Deferred · work unchanged"
              : question.answer
                ? "Answer recorded · not yet applied"
                : "No answer recorded"}
        </strong>
        {question.answer ? (
          <p className="mt-2 whitespace-pre-wrap">Recorded answer: {question.answer}</p>
        ) : null}
      </div>
    </div>
  );
}

function HandoffEditor({ work, state, save }: { work: QuestWork; state: QuestState; save: Save }) {
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
      <p className="mb-4 text-sm text-muted-foreground">
        Prepare a bounded handoff for a future attempt. Saving does not assign an agent or start
        execution. The historical recovery case is under Deferred evaluation → Prior paid-response
        recovery.
      </p>
      <Field label="Previous attempts and retained results">
        <Textarea name="priorAttempts" defaultValue={work.priorAttempts} rows={5} />
      </Field>
      <Field label="Unresolved findings and stop conditions">
        <Textarea name="findings" defaultValue={work.findings} rows={5} />
      </Field>
      <Field label="Prepared handoff · scope, evidence, allowed actions">
        <Textarea name="handoff" defaultValue={work.handoff} rows={7} />
      </Field>
      <p className="mb-4 text-sm">
        Evidence included:{" "}
        {state.documents
          .filter((doc) => work.documentIds.includes(doc.id))
          .map((doc) => doc.title)
          .join("; ") || "No documents associated yet"}
        .
      </p>
      <Button type="submit">Save prepared handoff</Button>
    </form>
  );
}

function QuestSelect({
  name,
  value,
  defaultValue,
  onChange,
  options,
}: {
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
      <SelectTrigger>
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

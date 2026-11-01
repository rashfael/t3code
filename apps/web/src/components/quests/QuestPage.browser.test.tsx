import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { Atom } from "effect/reactivity";
import {
  questAppliedUnderstanding,
  type QuestState,
  type EnvironmentId,
  type QuestThreadLink,
} from "@t3tools/contracts";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { expect, it, vi } from "vite-plus/test";

import { render } from "../../../test/render";
import "../../index.css";
import { SidebarProvider } from "../ui/sidebar";
import { SidebarQuests } from "../sidebar/SidebarQuests";

type QueryTarget =
  | { readonly kind: "quest"; readonly environmentId: string }
  | { readonly kind: "link"; readonly environmentId: string; readonly threadId: string };

const harness = vi.hoisted(() => ({
  /** Saved Quest per environment, as the server would answer `quest.get`. */
  quests: {} as Record<string, QuestState>,
  /** Server answers to `quest.threadLink`, by `environmentId|threadId`. */
  links: {} as Record<string, QuestThreadLink>,
  environments: [] as Array<{ environmentId: string; label: string }>,
  run: vi.fn(),
  newThread: vi.fn(),
  canWrite: true,
  shells: [] as Array<Record<string, unknown>>,
  /** A thread's own detail, for conversations the trimmed shell list omits. */
  details: {} as Record<string, { status: string; thread: Record<string, unknown> | null }>,
  membership: { quests: [], members: new Map(), hiddenKeys: new Set() } as unknown,
}));

vi.mock(import("./questEnvironment"), () => ({
  questEnvironment: {
    get: ({ environmentId }: { environmentId: string }) => ({ kind: "quest", environmentId }),
    threadLink: ({
      environmentId,
      input,
    }: {
      environmentId: string;
      input: { threadId: string };
    }) => ({
      kind: "link",
      environmentId,
      threadId: input.threadId,
    }),
    read: {},
    update: { permissionAtom: () => Atom.make(harness.canWrite) },
    openConversation: {},
    writeDocument: {},
    recoverWrite: {},
    document: () => null,
    retained: () => null,
    workspaceFiles: () => null,
    reconstruct: () => null,
  } as never,
}));
vi.mock(import("./questMembership"), () => ({
  useQuestMembership: (() => harness.membership) as never,
  threadNavigationTarget: (() => ({ to: "/" })) as never,
}));
vi.mock(import("~/state/threads"), () => ({
  useEnvironmentThread: ((_environmentId: string | null, threadId: string | null) => {
    const detail = threadId === null ? undefined : harness.details[threadId];
    return {
      status: detail?.status ?? "loading",
      data: detail?.thread ? Option.some({ thread: detail.thread }) : Option.none(),
      error: Option.none(),
    };
  }) as never,
}));
vi.mock(import("~/state/shell"), () => ({
  useEnvironmentShellStatus: (() => "live") as never,
}));
vi.mock(import("~/providerInstances"), async (original) => ({
  ...(await original()),
  resolveProjectDefaultProviderModelSelection: (() => ({
    instanceId: "replay",
    model: "replay-model",
  })) as never,
}));

vi.mock(import("~/state/environments"), () => ({
  usePrimaryEnvironmentId: () => "example-environment" as never,
  useEnvironments: (() => ({ environments: harness.environments })) as never,
}));
vi.mock(import("~/state/query"), () => ({
  useEnvironmentQuery: ((target: QueryTarget | null) => ({
    data:
      target === null
        ? null
        : target.kind === "quest"
          ? (harness.quests[target.environmentId] ?? null)
          : (harness.links[`${target.environmentId}|${target.threadId}`] ?? null),
  })) as never,
}));
vi.mock(import("~/state/use-atom-command"), () => ({
  useAtomCommand: (() => harness.run) as never,
}));
vi.mock(import("~/state/entities"), () => ({
  useProjects: (() => [
    { id: "project-1", environmentId: "example-environment", title: "Example project" },
  ]) as never,
  useQuietThreadShells: (() => harness.shells) as never,
  useQuietThreadShell: (() => null) as never,
}));
// The normal ChatView needs a live environment; QuestChat's own test covers what it hosts.
// Its buttons stand in for the chat asking its host to show a fork or open a new thread.
vi.mock(
  import("./QuestChat"),
  () =>
    ({
      QuestChat: ({
        environmentId,
        threadId,
        embedding,
      }: {
        environmentId: string;
        threadId: string;
        embedding: {
          openNewThread: (projectRef: object, options?: object) => Promise<boolean>;
          openFork: (ref: object, origin: object) => Promise<void>;
        };
      }) => (
        <>
          <section aria-label="Embedded chat">
            {environmentId}/{threadId}
          </section>
          <button
            type="button"
            onClick={() =>
              void embedding.openFork(
                { environmentId, threadId: "fork-1" },
                { threadId, runId: "run-1" },
              )
            }
          >
            Fork this run
          </button>
          <button
            type="button"
            onClick={() => void embedding.openNewThread({ environmentId, projectId: "project-1" })}
          >
            New thread
          </button>
        </>
      ),
    }) as never,
);
vi.mock(import("~/hooks/useHandleNewThread"), () => ({
  useNewThreadHandler: (() => harness.newThread) as never,
}));
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { ThreadId } from "@t3tools/contracts";
import { useComposerDraftStore } from "~/composerDraftStore";
import { QuestPage } from "./QuestPage";
import { useQuestDraftStore } from "./questDraftStore";
import { QuestThreadBar } from "./QuestThreadBar";

const at = "2026-10-31T20:00:00.000Z";

function work(
  id: string,
  parentId: string | null,
  title: string,
  overrides: Partial<QuestState["work"][number]> = {},
): QuestState["work"][number] {
  return {
    id,
    parentId,
    kind: "work",
    title,
    state: "active",
    owner: "Human",
    agent: "Unassigned",
    understanding: `${title} understanding`,
    documentIds: [],
    priorAttempts: "",
    findings: "",
    handoff: "",
    ...overrides,
  };
}

function setup() {
  harness.run.mockReset();
  harness.newThread.mockReset();
  harness.canWrite = true;
  harness.shells = [];
  harness.details = {};
  harness.links = {};
  harness.environments = [{ environmentId: "example-environment", label: "Isolated example" }];
  useQuestDraftStore.setState({ drafts: {}, panels: {}, conversations: {} });
  const initial: QuestState = {
    schemaVersion: 3,
    revision: 0,
    currentWorkId: "milestone",
    work: [
      work("quest", null, "Example quest"),
      work("milestone", "quest", "Example milestone"),
      work("part-a", "milestone", "Part A", {
        state: "attention",
        documentIds: ["note", "evidence"],
      }),
      work("part-b", "milestone", "Part B", { state: "planned" }),
      work("old-try", "part-a", "Earlier try", { kind: "attempt", state: "done" }),
      work("later", "quest", "Later branch", { state: "deferred" }),
    ],
    relations: [
      {
        id: "follows:part-b:part-a",
        type: "follows",
        from: "part-b",
        to: "part-a",
        provenance: "capture",
        documentId: "evidence",
        excerpt: "Part A, followed by Part B",
      },
    ],
    documents: [
      {
        id: "note",
        title: "Working note",
        kind: "living",
        body: "Original note",
        source: "Prototype synthesis",
        sha256: "",
      },
      {
        id: "evidence",
        title: "Retained source",
        kind: "evidence",
        body: "A captured source account",
        source: "Historical capture",
        sha256: "source-hash",
      },
    ],
    questions: [
      {
        id: "question",
        workId: "part-a",
        title: "Which summary?",
        context: "Reconstructed source gap",
        alternatives: ["Use newer summary", "Keep unresolved"],
        answer: null,
        rationale: null,
        deferred: false,
        applied: false,
        proposal: true,
        answerSource: null,
        appliedRevision: null,
      },
    ],
    conversations: [],
    corePredecessors: [],
    workspace: null,
    files: [],
    pendingWrites: [],
    history: [
      {
        id: "baseline-0",
        revision: 0,
        at,
        kind: "baseline",
        targetId: null,
        summary: "Example created from captured sources.",
        changes: [],
      },
    ],
  };
  harness.quests = { "example-environment": initial };
  return initial;
}

/** The Quest page beside a thread route, so tests can leave the Quest and come back. */
async function renderRoutes(initialEntry: string) {
  const root = createRootRoute({
    component: () => (
      <SidebarProvider>
        <Outlet />
      </SidebarProvider>
    ),
  });
  const quest = createRoute({ getParentRoute: () => root, path: "/quests", component: QuestPage });
  const thread = createRoute({
    getParentRoute: () => root,
    path: "/$environmentId/$threadId",
    component: function ThreadRoute() {
      const { environmentId, threadId } = thread.useParams();
      return (
        <main aria-label="Thread">
          <QuestThreadBar environmentId={environmentId as EnvironmentId} threadId={threadId} />
        </main>
      );
    },
  });
  const router = createRouter({
    routeTree: root.addChildren([quest, thread]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });
  const screen = await render(<RouterProvider router={router} />, {
    router: false, // The scenario navigates between the Quest and a thread route it defines.
  });
  return { screen, router };
}

function renderQuest() {
  return render(
    <SidebarProvider>
      <QuestPage />
    </SidebarProvider>,
    { router: "/quests" },
  );
}

it("records, previews, applies and reopens a decision without losing its earlier answer", async () => {
  const initial = setup();
  const question = initial.questions[0]!;
  const answered: QuestState = {
    ...initial,
    revision: 1,
    questions: [{ ...question, answer: "Use newer summary", rationale: "Newer index" }],
    history: [
      ...initial.history,
      {
        id: "r1",
        revision: 1,
        at,
        kind: "answer",
        targetId: "question",
        summary: "Recorded an answer to “Which summary?” (not applied)",
        changes: [{ label: "Answer", before: null, after: "Use newer summary" }],
      },
    ],
  };
  const partA = initial.work.find((item) => item.id === "part-a")!;
  const after = questAppliedUnderstanding(partA, answered.questions[0]!);
  const applied: QuestState = {
    ...answered,
    revision: 2,
    questions: [{ ...answered.questions[0]!, applied: true }],
    work: answered.work.map((item) =>
      item.id === "part-a" ? { ...item, understanding: after } : item,
    ),
    history: [
      ...answered.history,
      {
        id: "r2",
        revision: 2,
        at,
        kind: "apply",
        targetId: "question",
        summary: "Applied the answer",
        changes: [{ label: "Part A · current understanding", before: partA.understanding, after }],
      },
    ],
  };
  const reopened: QuestState = {
    ...applied,
    revision: 3,
    questions: [{ ...applied.questions[0]!, applied: false }],
  };
  harness.run
    .mockResolvedValueOnce({ _tag: "Success", value: answered })
    .mockResolvedValueOnce({ _tag: "Success", value: applied })
    .mockResolvedValueOnce({ _tag: "Success", value: reopened });
  await using screen = await renderQuest();
  await screen.getByRole("button", { name: /^Decisions/ }).click();
  const details = screen.getByRole("complementary", { name: "Quest details" });
  await details.getByRole("button", { name: /Which summary\?/ }).click();
  await expect.element(details.getByText("Proposed", { exact: true })).toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: "Apply recorded answer to work" }))
    .not.toBeInTheDocument();
  await screen.getByText("Use newer summary", { exact: true }).click();
  await screen.getByRole("textbox", { name: "Rationale (optional)" }).fill("Newer index");
  await screen.getByRole("button", { name: "Record answer", exact: true }).click();
  expect(harness.run.mock.calls[0]?.[0].input.change).toEqual({
    type: "answer",
    questionId: "question",
    answer: "Use newer summary",
    rationale: "Newer index",
    deferred: false,
  });
  await expect.element(screen.getByText("Applying would change “Part A”")).toBeVisible();
  await expect
    .element(screen.getByText(/\+ Applied answer \(question\): Use newer summary/))
    .toBeVisible();
  await screen.getByRole("button", { name: "Apply recorded answer to work" }).click();
  await expect
    .element(screen.getByText("Resulting change to Part A · current understanding:"))
    .toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: "Record answer", exact: true }))
    .not.toBeInTheDocument();
  await screen.getByRole("button", { name: "Reopen for revision" }).click();
  await expect
    .element(screen.getByRole("button", { name: "Record answer", exact: true }))
    .toBeVisible();
  await expect.element(details.getByText(/Recorded an answer to/)).toBeVisible();
  expect(harness.run.mock.calls.map((call) => call[0].input.change.type)).toEqual([
    "answer",
    "apply",
    "reopen",
  ]);
});

it("keeps a rejected work draft and discards it only on an explicit reload", async () => {
  const initial = setup();
  await using screen = await renderQuest();
  await screen.getByRole("button", { name: "Details", exact: true }).click();
  await screen.getByRole("button", { name: "Edit", exact: true }).click();
  const title = screen.getByRole("textbox", { name: "Work title", exact: true });
  await title.fill("A rejected draft");
  harness.run.mockResolvedValueOnce({
    _tag: "Failure",
    cause: Cause.fail(new Error("Save failed")),
  });
  await screen.getByRole("button", { name: "Save work", exact: true }).click();
  await expect.element(title).toHaveValue("A rejected draft");
  await expect.element(screen.getByRole("status")).toHaveTextContent("Save failed");
  harness.run.mockResolvedValueOnce({ _tag: "Success", value: initial });
  await screen.getByRole("button", { name: "Reload saved", exact: true }).click();
  await expect.element(screen.getByText(/^Reloaded/)).toBeVisible();
  await screen.getByRole("button", { name: "Edit", exact: true }).click();
  await expect
    .element(screen.getByRole("textbox", { name: "Work title", exact: true }))
    .toHaveValue("Example milestone");
});

it("reads evidence beside the work that referenced it on a read-only connection", async () => {
  setup();
  harness.canWrite = false;
  await using screen = await renderQuest();
  await screen.getByRole("button", { name: /^Part A Needs human attention/ }).click();
  const details = screen.getByRole("complementary", { name: "Quest details" });
  await expect
    .element(details.getByRole("button", { name: "Edit", exact: true }))
    .not.toBeInTheDocument();
  await details.getByRole("button", { name: /^Retained source Evidence/ }).click();
  await expect
    .element(details.getByText("A captured source account", { exact: true }))
    .toBeVisible();
  await expect.element(details.getByText("Evidence · read only")).toBeVisible();
  await details.getByRole("button", { name: "Back" }).click();
  await expect.element(details.getByRole("heading", { name: "Part A" })).toBeVisible();
  await details.getByRole("button", { name: "Close details" }).click();
  await expect
    .element(screen.getByRole("complementary", { name: "Quest details" }))
    .not.toBeInTheDocument();
  expect(harness.run).not.toHaveBeenCalled();
});

it("draws the work map as a graph with typed edges, expansion, focus and selection", async () => {
  setup();
  await using screen = await renderQuest();
  await screen.getByRole("button", { name: "Work map", exact: true }).click();
  const map = screen.getByRole("group", { name: "Work map" });
  const edges = (kind: string) => document.querySelectorAll(`[data-edge="${kind}"]`).length;
  await expect.element(map.getByRole("button", { name: /^Part B ·/ })).toBeVisible();
  expect(edges("follows")).toBe(1);
  expect(edges("part")).toBeGreaterThan(0);
  await expect.element(map.getByRole("button", { name: /^Earlier try/ })).not.toBeInTheDocument();
  await map.getByRole("button", { name: "Expand Part A" }).click();
  await expect
    .element(map.getByRole("button", { name: "Earlier try · Attempt · Recorded outcome" }))
    .toBeVisible();
  await map.getByRole("button", { name: "Focus on Example milestone" }).click();
  await expect.element(map.getByRole("button", { name: /^Later branch/ })).not.toBeInTheDocument();
  await map.getByRole("button", { name: /^Part B ·/ }).click();
  const details = screen.getByRole("complementary", { name: "Quest details" });
  await expect.element(details.getByText("Part A, followed by Part B")).toBeVisible();
  await expect.element(details.getByRole("button", { name: "Retained source" })).toBeVisible();
  // The test viewport is narrow, where details cover the map until closed.
  await details.getByRole("button", { name: "Close details" }).click();
  await screen.getByRole("button", { name: "Whole Quest" }).click();
  await expect.element(map.getByRole("button", { name: /^Later branch/ })).toBeVisible();
  await map.getByRole("button", { name: "Collapse Example milestone" }).click();
  await expect.element(map.getByRole("button", { name: /^Part B ·/ })).not.toBeInTheDocument();
  await vi.waitFor(() => expect(edges("follows")).toBe(0));
});

function conversation(
  threadId: string,
  title: string,
  overrides: Partial<QuestState["conversations"][number]> = {},
): QuestState["conversations"][number] {
  return {
    threadId,
    projectId: "project-1",
    title,
    workId: null,
    questionId: null,
    linkedAt: at,
    role: "focused",
    purposeKind: "discuss-work",
    purpose: title,
    sourceRevision: 0,
    sources: [],
    context: "packet",
    prepared: null,
    origin: null,
    creation: null,
    ...overrides,
  };
}

function shell(threadId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: threadId,
    environmentId: "example-environment",
    title: threadId,
    deletedAt: null,
    archivedAt: null,
    settledOverride: null,
    runtime: null,
    modelSelection: { instanceId: "replay", model: "replay-model" },
    ...overrides,
  };
}

it("starts a purpose-bound discussion without sending, then resumes it instead of retargeting a draft", async () => {
  const initial = setup();
  const created = conversation("thread-1", "Example · Unblock Part A", {
    workId: "part-a",
    purposeKind: "intervene",
    purpose: "Unblock Part A",
    prepared: "Quest: prepared context",
  });
  const opened = { ...initial, revision: 2, conversations: [created] };
  harness.run.mockResolvedValueOnce({
    _tag: "Success",
    value: { state: opened, threadId: "thread-1", created: true },
  });
  const { screen, router } = await renderRoutes("/quests?view=conversation&about=work:part-a");
  await using _screen = screen;
  const start = screen.getByRole("region", { name: "Start a discussion" });
  await expect
    .element(start.getByRole("textbox", { name: "Purpose" }))
    .toHaveValue("Unblock Part A");
  await start.getByRole("button", { name: "Start discussion" }).click();
  await expect
    .element(screen.getByRole("region", { name: "Embedded chat" }))
    .toHaveTextContent("example-environment/thread-1");
  expect(harness.run.mock.calls[0]?.[0]).toMatchObject({
    environmentId: "example-environment",
    input: {
      role: "focused",
      purposeKind: "intervene",
      purpose: "Unblock Part A",
      workId: "part-a",
      questionId: null,
      resume: false,
      projectId: "project-1",
      modelSelection: { instanceId: "replay", model: "replay-model" },
    },
  });
  // The prepared context waits in the composer; no draft is reused and nothing is sent.
  const ref = scopeThreadRef("example-environment" as EnvironmentId, "thread-1" as ThreadId);
  expect(useComposerDraftStore.getState().getComposerDraft(ref)?.prompt).toBe(
    "Quest: prepared context",
  );
  useComposerDraftStore.getState().setPrompt(ref, "");
  expect(harness.newThread).not.toHaveBeenCalled();
  expect(router.state.location.search).toMatchObject({ view: "conversation", thread: "thread-1" });
  await expect.element(screen.getByRole("button", { name: "About Part A" })).toBeVisible();

  await router.navigate({ to: "/quests", search: { view: "conversation", about: "work:part-a" } });
  await screen.getByRole("button", { name: "Resume “Unblock Part A”" }).click();
  expect(router.state.location.search).toMatchObject({ thread: "thread-1" });
  expect(harness.run).toHaveBeenCalledTimes(1);
});

it("finishes exactly the selected reservation and restores its context without overwriting the composer", async () => {
  const initial = setup();
  const reserved = conversation("thread-a", "Example · Unblock Part A", {
    workId: "part-a",
    purposeKind: "intervene",
    purpose: "Unblock Part A",
    prepared: "Prepared A",
    creation: {
      commandId: "quest:op-a",
      status: "reserved",
      requested: {
        modelSelection: { instanceId: "replay", model: "replay-model" },
        runtimeMode: "full-access",
        interactionMode: "default",
        provenance: "client-default",
      },
      effectiveModelSelection: null,
      reservedAt: at,
      readyAt: null,
    } as never,
  });
  // A newer discussion on the same subject with another purpose must not be the one resumed.
  const newer = conversation("thread-b", "Example · Another angle", {
    workId: "part-a",
    purposeKind: "intervene",
    purpose: "Another angle",
  });
  harness.quests = {
    "example-environment": { ...initial, conversations: [reserved, newer] },
  };
  const ready = { ...reserved, creation: null };
  harness.run.mockResolvedValueOnce({
    _tag: "Success",
    value: {
      state: { ...initial, revision: 3, conversations: [ready, newer] },
      threadId: "thread-a",
      created: false,
    },
  });
  const { screen, router } = await renderRoutes("/quests?view=conversation&thread=thread-a");
  await using _screen = screen;
  await screen.getByRole("button", { name: "Create it now" }).click();
  await expect
    .element(screen.getByRole("region", { name: "Embedded chat" }))
    .toHaveTextContent("example-environment/thread-a");
  expect(harness.run.mock.calls[0]?.[0].input).toMatchObject({
    threadId: "thread-a",
    resume: true,
    purpose: "Unblock Part A",
  });
  const ref = scopeThreadRef("example-environment" as EnvironmentId, "thread-a" as ThreadId);
  // This request only finished the reservation, yet the context still reaches the composer.
  expect(useComposerDraftStore.getState().getComposerDraft(ref)?.prompt).toBe("Prepared A");

  // On another client the unsent thread offers its context; an edited draft is never replaced.
  harness.quests = {
    "example-environment": { ...initial, revision: 3, conversations: [ready, newer] },
  };
  harness.shells = [shell("thread-a", { latestRun: null, latestUserMessageAt: null })];
  useComposerDraftStore.getState().setPrompt(ref, "My own opening");
  await router.navigate({ to: "/quests", search: { view: "conversation" } });
  await expect
    .element(screen.getByRole("region", { name: "Embedded chat" }))
    .toHaveTextContent("example-environment/thread-a");
  const insert = screen.getByRole("button", { name: "Insert prepared context" });
  await expect.element(insert).not.toBeInTheDocument();
  useComposerDraftStore.getState().setPrompt(ref, "");
  await expect.element(insert).toBeVisible();
  expect(useComposerDraftStore.getState().getComposerDraft(ref)?.prompt ?? "").toBe("");
  await insert.click();
  expect(useComposerDraftStore.getState().getComposerDraft(ref)?.prompt).toBe("Prepared A");
  expect(harness.run).toHaveBeenCalledTimes(1);
  useComposerDraftStore.getState().setPrompt(ref, "");
});

it.each([
  { name: "an answer and a newer discussion", answer: "Use newer summary", newer: true },
  { name: "an answer and no discussion left", answer: "Use newer summary", newer: false },
  { name: "a deferral and a newer discussion", answer: null, newer: true },
  { name: "a deferral and no discussion left", answer: null, newer: false },
  { name: "a deferral moved to the newer discussion", answer: null, newer: true, pick: true },
])(
  "keeps a detached decision source when only the rationale changes, with $name",
  async ({ answer, newer, pick }) => {
    const initial = setup();
    const source = { threadId: "detached-thread", runId: "run-7" };
    harness.quests = {
      "example-environment": {
        ...initial,
        questions: [
          {
            ...initial.questions[0]!,
            answer,
            deferred: answer === null,
            rationale: "First reason",
            answerSource: source,
          },
        ],
        conversations: newer
          ? [conversation("newer-thread", "Newer discussion", { questionId: "question" })]
          : [],
      },
    };
    harness.run.mockResolvedValueOnce({
      _tag: "Success",
      value: harness.quests["example-environment"],
    });
    await using screen = await renderQuest();
    await screen.getByRole("button", { name: /^Decisions/ }).click();
    const details = screen.getByRole("complementary", { name: "Quest details" });
    await details.getByRole("button", { name: /Which summary\?/ }).click();
    await screen.getByRole("textbox", { name: "Rationale (optional)" }).fill("Second reason");
    if (pick) {
      await screen.getByRole("combobox", { name: "Answer from conversation" }).click();
      await screen.getByRole("option", { name: "Newer discussion" }).click();
    }
    await screen
      .getByRole("button", { name: answer === null ? "Defer" : "Record answer", exact: true })
      .click();
    expect(harness.run.mock.calls[0]?.[0].input).toMatchObject({
      change: { type: "answer", rationale: "Second reason", answer, deferred: answer === null },
      source: pick ? { threadId: "newer-thread", runId: null } : source,
    });
  },
);

it("keeps a fork made in the Quest chat in the Quest with its origin, and starts the next conversation in the Quest", async () => {
  const initial = setup();
  const core = conversation("core-1", "Example · Core", {
    role: "core",
    purposeKind: "coordinate",
    purpose: "",
  });
  harness.quests = { "example-environment": { ...initial, conversations: [core] } };
  harness.shells = [shell("core-1")];
  // A fork whose Quest link fails (another client saved first) opens where it actually is.
  harness.run
    .mockResolvedValueOnce({ _tag: "Failure", cause: Cause.fail(new Error("Stale revision")) })
    .mockResolvedValueOnce({
      _tag: "Success",
      value: {
        ...initial,
        revision: 1,
        conversations: [core, conversation("fork-1", "Example · Core · fork", { context: "fork" })],
      },
    });
  const { screen, router } = await renderRoutes("/quests?view=conversation&thread=core-1");
  await using _screen = screen;
  await screen.getByRole("button", { name: "Fork this run" }).click();
  await vi.waitFor(() =>
    expect(router.state.location.pathname).toBe("/example-environment/fork-1"),
  );
  await router.navigate({ to: "/quests", search: { view: "conversation", thread: "core-1" } });
  await screen.getByRole("button", { name: "Fork this run" }).click();
  await vi.waitFor(() => expect(router.state.location.search).toMatchObject({ thread: "fork-1" }));
  expect(harness.run.mock.calls[1]?.[0].input.change).toMatchObject({
    type: "link",
    threadId: "fork-1",
    purposeKind: "digress",
    context: "fork",
    origin: { threadId: "core-1", runId: "run-1" },
  });
  await expect.element(screen.getByText("Provider fork")).toBeVisible();

  // A background send or the header's new-thread action asks for the next conversation: the
  // Quest offers a purpose-bound one instead of leaving for an ordinary draft.
  await screen.getByRole("button", { name: "New thread" }).click();
  await expect
    .element(
      screen.getByRole("region", { name: "Start a discussion" }).getByRole("textbox", {
        name: "Purpose",
      }),
    )
    .toHaveValue("Explore a side question");
  expect(router.state.location.pathname).toBe("/quests");
  expect(router.state.location.search).toMatchObject({ about: "digression" });
  expect(harness.newThread).not.toHaveBeenCalled();
});

it("starts the core once, and keeps a deleted core visible until it is explicitly replaced", async () => {
  const initial = setup();
  const core = conversation("core-1", "Example · Core", {
    role: "core",
    purposeKind: "coordinate",
    purpose: "",
  });
  harness.run.mockResolvedValueOnce({
    _tag: "Success",
    value: {
      state: { ...initial, revision: 2, conversations: [core] },
      threadId: "core-1",
      created: true,
    },
  });
  const { screen, router } = await renderRoutes("/quests?view=conversation");
  await using _screen = screen;
  await screen.getByRole("button", { name: "Start the core conversation" }).click();
  await vi.waitFor(() => expect(router.state.location.search).toMatchObject({ thread: "core-1" }));
  expect(harness.run.mock.calls[0]?.[0].input).toMatchObject({ role: "core", resume: true });

  // A core the trimmed shell list omits is not deleted; its own detail decides.
  const rail = screen.getByRole("navigation", { name: "Quest conversations" });
  const coreEntry = rail.getByRole("button", { name: /Coordinate the Quest/ });
  await expect.element(coreEntry.getByText("loading…", { exact: true })).toBeVisible();
  await expect.element(rail.getByText(/The core conversation was deleted/)).not.toBeInTheDocument();
  // The mocks are not reactive: a new shell list stands in for the detail stream updating.
  harness.shells = [];
  harness.details = {
    "core-1": {
      status: "live",
      thread: { deletedAt: null, archivedAt: null, settledOverride: "settled" },
    },
  };
  await router.navigate({ to: "/quests", search: { view: "conversation" } });
  await expect.element(coreEntry.getByText("settled", { exact: true })).toBeVisible();
  harness.shells = [];
  harness.details = { "core-1": { status: "deleted", thread: null } };
  await router.navigate({ to: "/quests", search: { view: "conversation", thread: "core-1" } });
  await expect.element(rail.getByText(/The core conversation was deleted/)).toBeVisible();

  // The core's thread was deleted elsewhere: no silent recreation or detachment.
  harness.run.mockResolvedValueOnce({ _tag: "Success", value: { ...initial, revision: 3 } });
  harness.shells = [shell("core-1", { deletedAt: at })];
  await router.navigate({ to: "/quests", search: { view: "conversation" } });
  await expect.element(rail.getByText(/The core conversation was deleted/)).toBeVisible();
  await rail.getByRole("textbox", { name: "Why replace the core" }).fill("Deleted by accident");
  await rail.getByRole("button", { name: "Retire and replace the core" }).click();
  expect(harness.run.mock.calls[1]?.[0].input.change).toEqual({
    type: "core-replace",
    reason: "Deleted by accident",
  });
});

it("switches, reopens and deep-links linked conversations on their own environment", async () => {
  const initial = setup();
  harness.environments.push({ environmentId: "second-environment", label: "Second" });
  harness.quests["second-environment"] = {
    ...initial,
    conversations: [
      conversation("thread-a", "Conversation A"),
      conversation("thread-b", "Conversation B"),
    ],
  };
  harness.links["second-environment|thread-a"] = {
    threadId: "thread-a",
    workId: null,
    questionId: null,
    about: null,
    role: "focused",
    purpose: "",
  };
  const { screen, router } = await renderRoutes(
    "/quests?env=second-environment&view=conversation&thread=thread-a",
  );
  await using _screen = screen;
  const chat = screen.getByRole("region", { name: "Embedded chat" });
  await expect.element(chat).toHaveTextContent("second-environment/thread-a");
  await screen
    .getByRole("navigation", { name: "Quest conversations" })
    .getByRole("button", { name: /^Conversation B/ })
    .click();
  await expect.element(chat).toHaveTextContent("second-environment/thread-b");
  expect(router.state.location.search).toMatchObject({ thread: "thread-b" });

  await router.navigate({
    to: "/$environmentId/$threadId",
    params: { environmentId: "second-environment", threadId: "thread-a" },
  });
  await router.navigate({
    to: "/quests",
    search: { env: "second-environment", view: "conversation" },
  });
  await expect.element(chat).toHaveTextContent("second-environment/thread-b");

  await router.navigate({
    to: "/$environmentId/$threadId",
    params: { environmentId: "second-environment", threadId: "thread-a" },
  });
  await screen
    .getByRole("navigation", { name: "Quest conversation" })
    .getByRole("link", { name: "Open in Quest" })
    .click();
  await expect.element(chat).toHaveTextContent("second-environment/thread-a");

  await router.navigate({
    to: "/quests",
    search: { env: "second-environment", view: "conversation", thread: "unlinked" },
  });
  await expect
    .element(screen.getByRole("alert"))
    .toHaveTextContent("This conversation is no longer part of the Quest.");
  await screen.getByRole("button", { name: "Show the Quest's conversations" }).click();
  await expect.element(chat).toHaveTextContent("second-environment/thread-a");
});

it("shows a linked thread's Quest from the server on a fresh client, without the Quest page", async () => {
  setup();
  harness.links["example-environment|thread-1"] = {
    threadId: "thread-1",
    workId: "part-a",
    questionId: null,
    about: "Part A",
    role: "focused",
    purpose: "",
  };
  const { screen } = await renderRoutes("/example-environment/thread-1");
  await using _screen = screen;
  const bar = screen.getByRole("navigation", { name: "Quest conversation" });
  await expect.element(bar.getByText("About: Part A")).toBeVisible();
  await bar.getByRole("link", { name: "Work map" }).click();
  await expect.element(screen.getByRole("group", { name: "Work map" })).toBeVisible();
});

it("returns from a thread to the Quest of that thread's environment", async () => {
  const initial = setup();
  harness.environments.push({ environmentId: "second-environment", label: "Second" });
  harness.quests["second-environment"] = {
    ...initial,
    work: initial.work.map((item) =>
      item.id === "milestone" ? { ...item, title: "Second milestone" } : item,
    ),
  };
  harness.links["second-environment|thread-2"] = {
    threadId: "thread-2",
    workId: null,
    questionId: null,
    about: null,
    role: "focused",
    purpose: "",
  };
  const { screen, router } = await renderRoutes("/quests");
  await using _screen = screen;
  await expect.element(screen.getByRole("heading", { name: "Example milestone" })).toBeVisible();
  await screen.getByRole("combobox", { name: "Environment" }).click();
  await screen.getByRole("option", { name: "Second" }).click();
  await expect.element(screen.getByRole("heading", { name: "Second milestone" })).toBeVisible();
  await router.navigate({
    to: "/$environmentId/$threadId",
    params: { environmentId: "second-environment", threadId: "thread-2" },
  });
  await screen
    .getByRole("navigation", { name: "Quest conversation" })
    .getByRole("link", { name: "Overview" })
    .click();
  await expect.element(screen.getByRole("heading", { name: "Second milestone" })).toBeVisible();
  expect(router.state.location.search).toMatchObject({ env: "second-environment" });
});

it("keeps unsaved answers and edits while evidence, other panels or a thread are opened", async () => {
  setup();
  const { screen, router } = await renderRoutes("/quests");
  await using _screen = screen;
  await screen.getByRole("button", { name: /^Decisions/ }).click();
  const details = screen.getByRole("complementary", { name: "Quest details" });
  await details.getByRole("button", { name: /Which summary\?/ }).click();
  await details.getByRole("textbox", { name: "Answer" }).fill("A drafted answer");
  await details.getByRole("textbox", { name: "Rationale (optional)" }).fill("Drafted reason");
  await details.getByRole("button", { name: /^Retained source/ }).click();
  await expect
    .element(details.getByText("A captured source account", { exact: true }))
    .toBeVisible();
  await details.getByRole("button", { name: "Back" }).click();
  await expect
    .element(details.getByRole("textbox", { name: "Answer" }))
    .toHaveValue("A drafted answer");
  await expect
    .element(details.getByRole("textbox", { name: "Rationale (optional)" }))
    .toHaveValue("Drafted reason");

  await details.getByRole("button", { name: "Part A", exact: true }).click();
  await details.getByRole("button", { name: "Edit", exact: true }).click();
  await details.getByRole("textbox", { name: "Work title" }).fill("A drafted title");
  await screen.getByRole("button", { name: "History", exact: true }).click();
  await router.navigate({
    to: "/$environmentId/$threadId",
    params: { environmentId: "example-environment", threadId: "thread-1" },
  });
  await router.navigate({ to: "/quests" });
  await expect.element(screen.getByRole("heading", { name: "History", exact: true })).toBeVisible();
  await router.navigate({
    to: "/$environmentId/$threadId",
    params: { environmentId: "example-environment", threadId: "thread-1" },
  });
  await router.navigate({ to: "/quests", search: { work: "part-a" } });
  await expect
    .element(screen.getByRole("textbox", { name: "Work title" }))
    .toHaveValue("A drafted title");
  await screen.getByRole("button", { name: "Cancel", exact: true }).click();
  await screen.getByRole("button", { name: "Edit", exact: true }).click();
  await expect.element(screen.getByRole("textbox", { name: "Work title" })).toHaveValue("Part A");
  expect(harness.run).not.toHaveBeenCalled();
});

it("lists each environment's Quest with full rows, keeps settled discussions in the Quest and shows attention when collapsed", async () => {
  const initial = setup();
  harness.environments.push({ environmentId: "second-environment", label: "Second" });
  harness.quests["example-environment"] = {
    ...initial,
    conversations: [
      conversation("focused-a", "Conversation A"),
      conversation("core-1", "Core", { role: "core", purposeKind: "coordinate" }),
      conversation("settled-b", "Conversation B"),
    ],
  };
  const member = (environmentId: string, threadId: string, role: string) => [
    `${environmentId}:${threadId}`,
    { threadId, role, title: threadId, environmentId },
  ];
  const quest = (members: ReadonlyArray<readonly [string, string]>) => ({
    questId: "market-tracking",
    title: "Market tracking",
    revision: 1,
    members: members.map(([threadId, role]) => ({ threadId, role, title: threadId })),
  });
  harness.membership = {
    quests: [
      {
        environmentId: "example-environment",
        quest: quest([
          ["core-1", "core"],
          ["focused-a", "focused"],
          ["settled-b", "focused"],
        ]),
      },
      // The same thread id on another environment belongs to that environment's Quest.
      // Its core is settled beyond the trimmed shell list, so it has no shell here.
      {
        environmentId: "second-environment",
        quest: quest([
          ["core-2", "core"],
          ["focused-a", "focused"],
        ]),
      },
    ],
    members: new Map([
      member("example-environment", "core-1", "core"),
      member("example-environment", "focused-a", "focused"),
      member("example-environment", "settled-b", "focused"),
      member("second-environment", "core-2", "core"),
      member("second-environment", "focused-a", "focused"),
    ] as never),
    hiddenKeys: new Set(),
  };
  const threads = [
    // A settled core stays listed; a settled discussion moves to the Quest view.
    shell("core-1", { settledOverride: "settled" }),
    shell("focused-a", { hasPendingApprovals: true }),
    shell("settled-b", { settledOverride: "settled" }),
    shell("focused-a", { environmentId: "second-environment", runtime: { status: "running" } }),
  ];
  const storageKey = "t3code:quests-shelf-expanded";
  const previous = localStorage.getItem(storageKey);
  using _storage = {
    [Symbol.dispose]() {
      if (previous === null) localStorage.removeItem(storageKey);
      else localStorage.setItem(storageKey, previous);
    },
  };
  localStorage.removeItem(storageKey);
  const root = createRootRoute({
    component: () => (
      <SidebarProvider>
        <aside>
          <SidebarQuests
            threads={threads as never}
            environmentLabelById={new Map([["second-environment" as EnvironmentId, "Second"]])}
            renderThreadRow={(thread, row) => (
              <li key={`${thread.environmentId}:${thread.id}`} data-parent={row.parent}>
                <a href="#row" aria-current={row.isActive ? "page" : undefined}>
                  {`Row ${thread.environmentId}/${thread.id}`}
                </a>
              </li>
            )}
          />
        </aside>
        <Outlet />
      </SidebarProvider>
    ),
  });
  const index = createRoute({
    getParentRoute: () => root,
    path: "/",
    component: () => <p>Conversation area</p>,
  });
  const questRoute = createRoute({
    getParentRoute: () => root,
    path: "/quests",
    component: QuestPage,
  });
  const router = createRouter({
    routeTree: root.addChildren([index, questRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await using screen = await render(<RouterProvider router={router} />, {
    router: false, // This scenario supplies the routes whose navigation it exercises.
  });
  const first = screen.getByRole("list", { name: "Market tracking conversations" }).first();
  await expect
    .element(first.getByRole("link").first())
    .toHaveTextContent("Row example-environment/core-1");
  await expect.element(first.getByText("Row example-environment/focused-a")).toBeVisible();
  await expect
    .element(first.getByText("Row example-environment/settled-b"))
    .not.toBeInTheDocument();
  await expect.element(first.getByRole("link", { name: "1 settled in the Quest" })).toBeVisible();
  await expect.element(screen.getByText("Row second-environment/focused-a")).toBeVisible();
  const unlistedCore = screen.getByRole("link", { name: "core-2", exact: true });
  await expect.element(unlistedCore).toBeVisible();
  await expect
    .element(unlistedCore)
    .toHaveAttribute("href", expect.stringContaining("thread=core-2"));

  const toggle = screen.getByRole("button", { name: /^Quests/ });
  await toggle.click();
  await expect.element(toggle.getByText("1 waiting · 1 working")).toBeVisible();
  await toggle.click();
  await screen.getByRole("link", { name: "Market tracking" }).first().click();
  await expect.element(screen.getByRole("main", { name: "Quest workspace" })).toBeVisible();
  expect(router.state.location.pathname).toBe("/quests");
  await router.navigate({
    to: "/quests",
    search: { env: "example-environment", view: "conversation", thread: "focused-a" },
  });
  await expect
    .element(screen.getByRole("link", { name: "Row example-environment/focused-a" }))
    .toHaveAttribute("aria-current", "page");
  await expect
    .element(screen.getByRole("link", { name: "Row second-environment/focused-a" }))
    .not.toHaveAttribute("aria-current");
});

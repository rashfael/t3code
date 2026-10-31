import * as Cause from "effect/Cause";
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
  } as never,
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
  useQuietThreadShells: (() => []) as never,
  useQuietThreadShell: (() => null) as never,
}));
// The normal ChatView needs a live environment; QuestChat's own test covers what it hosts.
// "Send in background" stands in for the chat asking its host for the next conversation.
vi.mock(import("./QuestChat"), async () => {
  const { useState } = await import("react");
  return {
    QuestChat: ({
      environmentId,
      threadId,
      onNewConversation,
    }: {
      environmentId: string;
      threadId: string;
      onNewConversation: (
        projectRef: { environmentId: string; projectId: string },
        options: object,
      ) => Promise<boolean>;
    }) => {
      const [opened, setOpened] = useState<boolean | null>(null);
      return (
        <>
          <section aria-label="Embedded chat">
            {environmentId}/{threadId}
          </section>
          <button
            type="button"
            onClick={() =>
              void onNewConversation(
                { environmentId, projectId: "project-1" },
                { envMode: "local", branch: "main", worktreePath: null, startFromOrigin: false },
              ).then(setOpened)
            }
          >
            Send in background
          </button>
          {opened === null ? null : <output>{opened ? "opened" : "not opened"}</output>}
        </>
      );
    },
  } as never;
});
vi.mock(import("~/hooks/useHandleNewThread"), () => ({
  useNewThreadHandler: (() => harness.newThread) as never,
}));
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
  harness.links = {};
  harness.environments = [{ environmentId: "example-environment", label: "Isolated example" }];
  useQuestDraftStore.setState({ drafts: {}, panels: {}, conversations: {} });
  const initial: QuestState = {
    schemaVersion: 2,
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
      },
    ],
    conversations: [],
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

function conversation(threadId: string, title: string): QuestState["conversations"][number] {
  return { threadId, projectId: "project-1", title, workId: null, questionId: null, linkedAt: at };
}

it("creates a normal draft inside the Quest and keeps the Quest route", async () => {
  const initial = setup();
  harness.newThread.mockResolvedValueOnce({ draftId: "draft-1", threadId: "thread-1" });
  harness.run.mockResolvedValueOnce({
    _tag: "Success",
    value: {
      ...initial,
      revision: 1,
      conversations: [{ ...conversation("thread-1", "Example · Part A"), workId: "part-a" }],
    },
  });
  const { screen, router } = await renderRoutes("/quests?view=conversation&about=work:part-a");
  await using _screen = screen;
  await expect.element(screen.getByText("No conversation about Part A yet.")).toBeVisible();
  await screen.getByRole("button", { name: "New conversation" }).click();
  await expect
    .element(screen.getByRole("region", { name: "Embedded chat" }))
    .toHaveTextContent("example-environment/thread-1");
  const [projectRef, options] = harness.newThread.mock.calls[0]!;
  expect(projectRef).toEqual({ environmentId: "example-environment", projectId: "project-1" });
  expect(options).toMatchObject({ navigate: false });
  expect(options.prompt).toContain("About: Part A");
  expect(options.prompt).toContain("Part A understanding");
  expect(harness.run.mock.calls[0]?.[0].input.change).toMatchObject({
    type: "link",
    threadId: "thread-1",
    workId: "part-a",
    questionId: null,
  });
  expect(router.state.location.pathname).toBe("/quests");
  expect(router.state.location.search).toMatchObject({
    env: "example-environment",
    view: "conversation",
    thread: "thread-1",
  });
  await expect.element(screen.getByRole("button", { name: "About Part A" })).toBeVisible();
});

it("opens the chat's next conversation in the Quest and keeps the chat when linking fails", async () => {
  const initial = setup();
  const linked = { ...initial, conversations: [conversation("thread-1", "Example")] };
  harness.quests = { "example-environment": linked };
  harness.newThread
    .mockResolvedValueOnce({ draftId: "draft-2", threadId: "thread-2" })
    .mockResolvedValueOnce({ draftId: "draft-3", threadId: "thread-3" });
  harness.run
    .mockResolvedValueOnce({
      _tag: "Success",
      value: {
        ...linked,
        revision: 1,
        conversations: [...linked.conversations, conversation("thread-2", "Example")],
      },
    })
    .mockResolvedValueOnce({ _tag: "Failure", cause: Cause.fail(new Error("Save failed")) });
  const { screen, router } = await renderRoutes("/quests?view=conversation&thread=thread-1");
  await using _screen = screen;
  const chat = screen.getByRole("region", { name: "Embedded chat" });
  await screen.getByRole("button", { name: "Send in background" }).click();
  await expect.element(chat).toHaveTextContent("example-environment/thread-2");
  expect(harness.newThread.mock.calls[0]).toEqual([
    { environmentId: "example-environment", projectId: "project-1" },
    expect.objectContaining({ navigate: false, envMode: "local", branch: "main" }),
  ]);
  expect(harness.run.mock.calls[0]?.[0].input.change).toMatchObject({
    type: "link",
    threadId: "thread-2",
  });
  expect(router.state.location.pathname).toBe("/quests");
  expect(router.state.location.search).toMatchObject({ thread: "thread-2" });

  await screen.getByRole("button", { name: "Send in background" }).click();
  await expect.element(screen.getByText("not opened", { exact: true })).toBeVisible();
  await expect.element(chat).toHaveTextContent("example-environment/thread-2");
  expect(router.state.location.search).toMatchObject({ thread: "thread-2" });
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
  };
  const { screen, router } = await renderRoutes(
    "/quests?env=second-environment&view=conversation&thread=thread-a",
  );
  await using _screen = screen;
  const chat = screen.getByRole("region", { name: "Embedded chat" });
  await expect.element(chat).toHaveTextContent("second-environment/thread-a");
  await screen.getByRole("combobox", { name: "Conversation" }).click();
  await screen.getByRole("option", { name: /^Conversation B/ }).click();
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
    .toHaveTextContent("This conversation is no longer linked to the Quest.");
  await screen.getByRole("button", { name: "Show linked conversations" }).click();
  await expect.element(chat).toHaveTextContent("second-environment/thread-a");
});

it("shows a linked thread's Quest from the server on a fresh client, without the Quest page", async () => {
  setup();
  harness.links["example-environment|thread-1"] = {
    threadId: "thread-1",
    workId: "part-a",
    questionId: null,
    about: "Part A",
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

it("opens a quest and its conversations in the main area from the sidebar list", async () => {
  const initial = setup();
  harness.quests["example-environment"] = {
    ...initial,
    conversations: [
      conversation("thread-a", "Conversation A"),
      conversation("thread-b", "Conversation B"),
    ],
  };
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
          <SidebarQuests />
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
  const quest = createRoute({ getParentRoute: () => root, path: "/quests", component: QuestPage });
  const router = createRouter({
    routeTree: root.addChildren([index, quest]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await using screen = await render(<RouterProvider router={router} />, {
    router: false, // This scenario supplies the routes whose navigation it exercises.
  });
  const toggle = screen.getByRole("button", { name: "Quests 1", exact: true });
  await toggle.click();
  await expect
    .element(screen.getByRole("link", { name: "Market tracking" }))
    .not.toBeInTheDocument();
  await expect.element(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await screen.getByRole("link", { name: "Market tracking" }).click();
  await expect.element(screen.getByRole("main", { name: "Quest workspace" })).toBeVisible();
  await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();
  await expect.element(toggle).toBeEnabled();
  expect(router.state.location.pathname).toBe("/quests");

  const nested = screen.getByRole("list", { name: "Market tracking conversations" });
  await nested.getByRole("link", { name: "Conversation B" }).click();
  await expect
    .element(screen.getByRole("region", { name: "Embedded chat" }))
    .toHaveTextContent("example-environment/thread-b");
  await expect
    .element(nested.getByRole("link", { name: "Conversation B" }))
    .toHaveAttribute("aria-current", "page");
  await expect
    .element(nested.getByRole("link", { name: "Conversation A" }))
    .not.toHaveAttribute("aria-current");
});

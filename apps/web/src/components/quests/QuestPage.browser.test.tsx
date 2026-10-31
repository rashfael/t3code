import * as Cause from "effect/Cause";
import { Atom } from "effect/reactivity";
import { questAppliedUnderstanding, type QuestState } from "@t3tools/contracts";
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

const harness = vi.hoisted(() => ({
  initial: null as QuestState | null,
  run: vi.fn(),
  newThread: vi.fn(),
  canWrite: true,
}));

vi.mock(import("@t3tools/client-runtime/state/quests"), () => ({
  createQuestEnvironmentAtoms: (() => ({
    get: () => null,
    read: {},
    update: { permissionAtom: () => Atom.make(harness.canWrite) },
  })) as never,
}));
vi.mock(import("~/connection/runtime"), () => ({ connectionAtomRuntime: null as never }));
vi.mock(import("~/state/environments"), () => ({
  usePrimaryEnvironmentId: () => "example-environment" as never,
  useEnvironments: (() => ({
    environments: [{ environmentId: "example-environment", label: "Isolated example" }],
  })) as never,
}));
vi.mock(import("~/state/query"), () => ({
  useEnvironmentQuery: (() => ({ data: harness.initial })) as never,
}));
vi.mock(import("~/state/use-atom-command"), () => ({
  useAtomCommand: (() => harness.run) as never,
}));
vi.mock(import("~/state/entities"), () => ({
  useProjects: (() => [
    { id: "project-1", environmentId: "example-environment", title: "Example project" },
  ]) as never,
  useQuietThreadShells: (() => []) as never,
}));
vi.mock(import("~/hooks/useHandleNewThread"), () => ({
  useNewThreadHandler: (() => harness.newThread) as never,
}));
import { QuestPage } from "./QuestPage";
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
  localStorage.removeItem("t3code:quest-conversations");
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
  harness.initial = initial;
  return initial;
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
  await expect
    .element(details.getByText("Prototype proposal · not an actual pending request"))
    .toBeVisible();
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
  await expect.element(screen.getByText(/^Saved version loaded/)).toBeVisible();
  await screen.getByRole("button", { name: "Edit", exact: true }).click();
  await expect
    .element(screen.getByRole("textbox", { name: "Work title", exact: true }))
    .toHaveValue("Example milestone");
});

it("reads evidence beside the work that referenced it on a read-only connection", async () => {
  setup();
  harness.canWrite = false;
  await using screen = await renderQuest();
  await screen
    .getByRole("button", { name: /Part A/ })
    .first()
    .click();
  const details = screen.getByRole("complementary", { name: "Quest details" });
  await expect
    .element(details.getByRole("button", { name: "Edit", exact: true }))
    .not.toBeInTheDocument();
  await details.getByRole("button", { name: /^Retained source Captured evidence/ }).click();
  await expect
    .element(details.getByText("A captured source account", { exact: true }))
    .toBeVisible();
  await expect.element(details.getByText("Captured evidence · read only")).toBeVisible();
  await details.getByRole("button", { name: "Back" }).click();
  await expect.element(details.getByRole("heading", { name: "Part A" })).toBeVisible();
  await details.getByRole("button", { name: "Close details" }).click();
  await expect
    .element(screen.getByRole("complementary", { name: "Quest details" }))
    .not.toBeInTheDocument();
  expect(harness.run).not.toHaveBeenCalled();
});

it("navigates the work map by branch and shows recorded relationships with their source", async () => {
  setup();
  await using screen = await renderQuest();
  await screen.getByRole("button", { name: "Work map", exact: true }).click();
  const map = screen.getByRole("tree", { name: "Work map" });
  await expect.element(map.getByText("After: Part A")).toBeVisible();
  await expect.element(map.getByText("Earlier try")).not.toBeInTheDocument();
  await map.getByRole("button", { name: "Expand Part A" }).click();
  await expect.element(map.getByText("Attempt · Recorded outcome")).toBeVisible();
  await map.getByRole("button", { name: "Focus on Example milestone" }).click();
  await expect.element(map.getByText("Later branch")).not.toBeInTheDocument();
  await map
    .getByRole("button", { name: /Part B/ })
    .first()
    .click();
  const details = screen.getByRole("complementary", { name: "Quest details" });
  await expect.element(details.getByText(/Recorded in a captured source/)).toBeVisible();
  await expect.element(details.getByText("Part A, followed by Part B")).toBeVisible();
  // The test viewport is narrow, where details cover the map until closed.
  await details.getByRole("button", { name: "Close details" }).click();
  await screen.getByRole("button", { name: "Whole Quest" }).click();
  await expect.element(map.getByText("Later branch")).toBeVisible();
  await map.getByRole("button", { name: "Collapse Example milestone" }).click();
  await expect.element(map.getByText("Part B")).not.toBeInTheDocument();
});

it("opens a normal draft with Quest context, links it, and marks the thread as a Quest conversation", async () => {
  const initial = setup();
  harness.newThread.mockResolvedValueOnce({ draftId: "draft-1", threadId: "thread-1" });
  const linked: QuestState = {
    ...initial,
    revision: 1,
    conversations: [
      {
        threadId: "thread-1",
        projectId: "project-1",
        title: "Market tracking · Part A",
        workId: "part-a",
        questionId: null,
        linkedAt: at,
      },
    ],
  };
  harness.run.mockResolvedValueOnce({ _tag: "Success", value: linked });
  await using screen = await render(
    <SidebarProvider>
      <QuestThreadBar environmentId="example-environment" threadId="thread-1" />
      <QuestPage />
    </SidebarProvider>,
    { router: "/quests?view=conversation&about=work:part-a" },
  );
  await expect
    .element(screen.getByRole("navigation", { name: "Quest conversation" }))
    .not.toBeInTheDocument();
  await screen.getByRole("button", { name: "Open a new conversation" }).click();
  expect(harness.newThread).toHaveBeenCalledTimes(1);
  const [projectRef, options] = harness.newThread.mock.calls[0]!;
  expect(projectRef).toEqual({ environmentId: "example-environment", projectId: "project-1" });
  expect(options.prompt).toContain("About: Part A");
  expect(options.prompt).toContain("Part A understanding");
  await vi.waitFor(() =>
    expect(harness.run.mock.calls[0]?.[0].input.change).toMatchObject({
      type: "link",
      threadId: "thread-1",
      workId: "part-a",
      questionId: null,
    }),
  );
  await expect
    .element(screen.getByRole("navigation", { name: "Quest conversation" }))
    .toBeVisible();
  await expect.element(screen.getByText("About: Part A")).toBeVisible();
});

it("opens a quest in the main area from the collapsible sidebar list", async () => {
  setup();
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
});

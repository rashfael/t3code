import * as Cause from "effect/Cause";
import { Atom } from "effect/reactivity";
import type { QuestState } from "@t3tools/contracts";
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
import { QuestPage } from "./QuestPage";

function setup() {
  harness.run.mockReset();
  harness.canWrite = true;
  const initial: QuestState = {
    revision: 0,
    work: [
      {
        id: "work",
        parentId: null,
        title: "Example work",
        state: "attention",
        owner: "Human",
        agent: "Unassigned",
        understanding: "Original understanding",
        documentIds: ["note"],
        priorAttempts: "",
        findings: "",
        handoff: "",
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
    ],
    questions: [
      {
        id: "question",
        workId: "work",
        title: "Which summary?",
        context: "Reconstructed source gap",
        alternatives: ["Use newer summary", "Keep unresolved"],
        answer: null,
        deferred: false,
        applied: false,
        proposal: true,
      },
    ],
  };
  harness.initial = initial;
  return initial;
}

it("keeps recording distinct from applying and offers revision only after application", async () => {
  const initial = setup();
  const answered: QuestState = {
    ...initial,
    revision: 1,
    questions: initial.questions.map((question) => ({ ...question, answer: "Use newer summary" })),
  };
  const applied: QuestState = {
    ...answered,
    revision: 2,
    questions: answered.questions.map((question) => ({ ...question, applied: true })),
  };
  const reopened: QuestState = {
    ...applied,
    revision: 3,
    questions: applied.questions.map((question) => ({ ...question, applied: false })),
  };
  harness.run
    .mockResolvedValueOnce({ _tag: "Success", value: answered })
    .mockResolvedValueOnce({ _tag: "Success", value: applied })
    .mockResolvedValueOnce({ _tag: "Success", value: reopened });
  await using screen = await render(
    <SidebarProvider>
      <QuestPage />
    </SidebarProvider>,
  );
  await screen.getByRole("button", { name: "Prepared question", exact: true }).click();
  await expect
    .element(screen.getByRole("button", { name: "Apply recorded answer to work" }))
    .not.toBeInTheDocument();
  await screen.getByText("Use newer summary", { exact: true }).click();
  await screen.getByRole("button", { name: "Record answer", exact: true }).click();
  await expect
    .element(screen.getByText("Answer recorded · not yet applied", { exact: true }))
    .toBeVisible();
  expect(harness.run.mock.calls[0]?.[0].input.change.type).toBe("answer");
  await screen.getByRole("button", { name: "Apply recorded answer to work" }).click();
  await expect
    .element(screen.getByRole("button", { name: "Record answer", exact: true }))
    .not.toBeInTheDocument();
  await expect
    .element(screen.getByRole("button", { name: "Defer question", exact: true }))
    .not.toBeInTheDocument();
  await screen.getByRole("button", { name: "Reopen question for revision" }).click();
  await expect
    .element(screen.getByRole("button", { name: "Record answer", exact: true }))
    .toBeVisible();
  expect(harness.run.mock.calls.map((call) => call[0].input.change.type)).toEqual([
    "answer",
    "apply",
    "reopen",
  ]);
});

it("keeps a rejected work draft and explicitly reloads even when the saved revision has not changed", async () => {
  const initial = setup();
  harness.run.mockResolvedValueOnce({ _tag: "Success", value: initial });
  await using screen = await render(
    <SidebarProvider>
      <QuestPage />
    </SidebarProvider>,
  );
  const title = screen.getByRole("textbox", { name: "Work title", exact: true });
  await title.fill("Unsaved draft");
  await screen
    .getByRole("button", { name: "Reload saved version (discard drafts)", exact: true })
    .click();
  await expect.element(title).toHaveValue("Example work");
  await title.fill("A rejected draft");
  harness.run.mockResolvedValueOnce({
    _tag: "Failure",
    cause: Cause.fail(new Error("Save failed")),
  });
  await screen.getByRole("button", { name: "Save work", exact: true }).click();
  await expect.element(title).toHaveValue("A rejected draft");
  await expect.element(screen.getByRole("status")).toHaveTextContent("Save failed");
});

it("lets a read-only connection inspect retained documents while preventing edits", async () => {
  const initial = setup();
  harness.canWrite = false;
  harness.initial = {
    ...initial,
    documents: [
      ...initial.documents,
      {
        id: "evidence",
        title: "Retained source",
        kind: "evidence",
        body: "A captured source account",
        source: "Historical capture",
        sha256: "source-hash",
      },
    ],
  };
  await using screen = await render(
    <SidebarProvider>
      <QuestPage />
    </SidebarProvider>,
  );
  await screen.getByRole("button", { name: "Documents & evidence", exact: true }).click();
  const picker = screen.getByRole("combobox", { name: "Read or edit a document" });
  await expect.element(picker).toBeEnabled();
  await expect.element(screen.getByRole("button", { name: "Save associations" })).toBeDisabled();
  await expect.element(screen.getByRole("button", { name: "Save document" })).toBeDisabled();
  await picker.click();
  await screen.getByRole("option", { name: "Retained source" }).click();
  await expect
    .element(screen.getByText("A captured source account", { exact: true }))
    .toBeVisible();
  expect(harness.run).not.toHaveBeenCalled();
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

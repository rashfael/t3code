import { useState } from "react";
import { expect, it, vi } from "vite-plus/test";
import { create } from "zustand";

import { render } from "../../../test/render";

type Ref = { readonly environmentId: string; readonly threadId: string };

const harness = vi.hoisted(() => ({
  instances: 0,
  store: null as unknown as {
    setState: (state: Partial<HarnessState>) => void;
  },
}));

interface HarnessState {
  /** Draft sessions by draft id. */
  readonly drafts: Readonly<Record<string, Ref>>;
  /** Server thread shells by `environmentId|threadId`. */
  readonly shells: Readonly<Record<string, true>>;
}

vi.mock(import("~/composerDraftStore"), () => {
  const store = create<HarnessState>()(() => ({ drafts: {}, shells: {} }));
  harness.store = store;
  const api = (state: HarnessState) => ({
    getDraftIdByRef: (ref: Ref) =>
      Object.entries(state.drafts).find(
        ([, draft]) => draft.environmentId === ref.environmentId && draft.threadId === ref.threadId,
      )?.[0] ?? null,
    getDraftSession: (draftId: string) => state.drafts[draftId] ?? null,
    draftThreadsByThreadKey: state.drafts,
  });
  return {
    useComposerDraftStore: ((selector: (value: ReturnType<typeof api>) => unknown) =>
      store((state) => selector(api(state)))) as never,
  };
});
vi.mock(import("~/state/entities"), async () => {
  const { useStore } = await import("zustand");
  const shell = { deletedAt: null };
  return {
    useQuietThreadShell: ((ref: Ref) =>
      useStore(harness.store as never, (state: HarnessState) =>
        state.shells[`${ref.environmentId}|${ref.threadId}`] ? shell : null,
      )) as never,
    useQuietThreadShells: (() =>
      Object.keys(useStore(harness.store as never, (state: HarnessState) => state.shells)).map(
        (key) => {
          const [environmentId, id] = key.split("|");
          return { environmentId, id, deletedAt: null };
        },
      )) as never,
  };
});
vi.mock(import("~/state/shell"), () => ({ useEnvironmentShellStatus: () => "live" }));
vi.mock(import("~/state/threads"), async () => {
  const Option = await import("effect/Option");
  return {
    useEnvironmentThread: (() => ({ status: "deleted", data: Option.none() })) as never,
  };
});
vi.mock(import("../ChatView"), () => ({
  default: (props: { routeKind: string; environmentId: string; threadId: string }) => {
    const [instance] = useState(() => ++harness.instances);
    return (
      <section aria-label="Chat">
        {props.routeKind} {props.environmentId}/{props.threadId} #{instance}
      </section>
    );
  },
}));

import { QuestChat } from "./QuestChat";

const noop = async () => false;

function setup(state: Partial<HarnessState>) {
  harness.instances = 0;
  harness.store.setState({ drafts: {}, shells: {}, ...state });
}

it("keeps the draft's chat and the Quest route through its first send", async () => {
  setup({ drafts: { "draft-1": { environmentId: "env-a", threadId: "thread-1" } } });
  await using screen = await render(
    <QuestChat environmentId={"env-a" as never} threadId="thread-1" onNewConversation={noop} />,
    {
      router: "/quests",
    },
  );
  const chat = screen.getByRole("region", { name: "Chat" });
  await expect.element(chat).toHaveTextContent("draft env-a/thread-1 #1");

  // Promotion finalizes: the draft goes away once the server lists the thread.
  harness.store.setState({
    drafts: {},
    shells: { "env-a|thread-1": true },
  });
  await expect.element(chat).toHaveTextContent("server env-a/thread-1 #1");
  expect(screen.router?.state.location.pathname).toBe("/quests");
});

it.each([
  { name: "thread", state: { shells: { "env-b|thread-1": true as const } } },
  {
    name: "draft",
    state: { drafts: { "draft-1": { environmentId: "env-b", threadId: "thread-1" } } },
  },
])("says when a legacy link's $name is on another environment", async ({ state }) => {
  setup(state);
  await using screen = await render(
    <QuestChat environmentId={"env-a" as never} threadId="thread-1" onNewConversation={noop} />,
    { router: "/quests" },
  );
  await expect
    .element(screen.getByRole("alert"))
    .toHaveTextContent("This conversation is on another environment than the Quest.");
  await expect
    .element(screen.getByRole("link", { name: "Open it outside the Quest" }))
    .toBeVisible();
  expect(harness.instances).toBe(0);
});

it("reports a conversation whose draft was discarded instead of waiting forever", async () => {
  setup({});
  await using screen = await render(
    <QuestChat environmentId={"env-a" as never} threadId="gone" onNewConversation={noop} />,
    {
      router: "/quests",
    },
  );
  await expect
    .element(screen.getByRole("alert"))
    .toHaveTextContent("This conversation is not available on this client.");
});

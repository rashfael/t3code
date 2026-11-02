import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, RunId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";

import { render } from "../../test/render";

const environmentId = EnvironmentId.make("env-quest");
const conversation = scopeThreadRef(environmentId, ThreadId.make("thread-conversation"));
const draft = scopeThreadRef(environmentId, ThreadId.make("thread-draft"));

vi.mock("../state/entities", async (original) => ({
  ...(await original<typeof import("../state/entities")>()),
  useQuietThreadShell: (ref: ScopedThreadRef | null) =>
    ref?.threadId === conversation.threadId
      ? { environmentId, projectId: "project", worktreePath: "/repo" }
      : null,
  useProject: () => null,
}));

import { AppAtomRegistryProvider } from "../rpc/atomRegistry";
import { useDiffPanelStore } from "../diffPanelStore";
import DiffPanel from "./DiffPanel";

function panel(threadRef: ScopedThreadRef) {
  return (
    <AppAtomRegistryProvider>
      <DiffPanel
        threadRef={threadRef}
        composerDraftTarget={threadRef}
        workspaceMutationId={null}
        visible
      />
    </AppAtomRegistryProvider>
  );
}

it("inspects the conversation its host names, off a thread route", async () => {
  useDiffPanelStore.setState({ byThreadKey: {}, branchBaseRefByThreadKey: {} });
  useDiffPanelStore.getState().selectTurn(conversation, RunId.make("run-gone"));
  // The Quest route carries the conversation in its search, not in route params.
  await using screen = await render(panel(conversation), {
    router: `/quests?quest=q&view=conversation&thread=${conversation.threadId}`,
  });
  await expect.element(screen.getByText("No completed turns yet.")).toBeVisible();

  await screen.rerender(panel(draft));
  await expect
    .element(screen.getByText("Diffs appear once this conversation has its first turn."))
    .toBeVisible();
});

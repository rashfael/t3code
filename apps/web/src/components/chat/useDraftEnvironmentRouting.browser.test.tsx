import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ProjectId, ProviderDriverKind, ThreadId } from "@t3tools/contracts";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { DraftId, useComposerDraftStore } from "~/composerDraftStore";
import { useLogicalProjectEnvironments } from "~/hooks/useLogicalProjectEnvironments";
import { useDraftEnvironmentRouting } from "./useDraftEnvironmentRouting";
import { render } from "../../../test/render";

const ENV_A = EnvironmentId.make("environment-a");
const ENV_B = EnvironmentId.make("environment-b");
const repositoryIdentity = {
  canonicalKey: "github.com/example/shared-repo",
  locator: {
    source: "git-remote" as const,
    remoteName: "origin",
    remoteUrl: "https://github.com/example/shared-repo.git",
  },
};
const project = (environmentId: EnvironmentId, id: string) => ({
  environmentId,
  id: ProjectId.make(id),
  title: "Shared repo",
  workspaceRoot: "/repo",
  repositoryIdentity,
  defaultModelSelection: null,
  scripts: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});
const PROJECT_A = project(ENV_A, "project-a");
const PROJECT_B = project(ENV_B, "project-b");

vi.mock(import("~/state/entities"), async (original) => ({
  ...(await original()),
  useProjects: (() => [PROJECT_A, PROJECT_B]) as never,
}));
vi.mock(import("~/state/environments"), async (original) => ({
  ...(await original()),
  useEnvironments: (() => ({
    environments: [ENV_A, ENV_B].map((environmentId) => ({
      environmentId,
      label: environmentId,
      connection: { phase: "connected" },
      serverConfig: null,
    })),
  })) as never,
  usePrimaryEnvironmentId: (() => ENV_A) as never,
}));
vi.mock(import("~/hooks/useSettings"), async (original) => ({
  ...(await original()),
  useClientSettings: ((select: (settings: typeof DEFAULT_CLIENT_SETTINGS) => unknown) =>
    select(DEFAULT_CLIENT_SETTINGS)) as never,
}));
// The balancer has settled on the other machine.
vi.mock(import("~/hooks/useLoadBalancedEnvironment"), () => ({
  useLoadBalancedEnvironment: (() => ({
    pending: false,
    failed: false,
    environmentId: ENV_B,
    refresh: () => {},
  })) as never,
}));
vi.mock(import("~/hooks/useScratchProject"), () => ({
  useScratchProject: (() => ({ openScratchProject: async () => null })) as never,
}));

const sendInFlightRef = { current: false };

/** ChatView's composition: the routable environments feed both the gate and the router. */
function Draft({
  draftId,
  pinned,
  automatic,
}: {
  draftId: DraftId;
  pinned: boolean;
  automatic: boolean;
}) {
  const draftThread = useComposerDraftStore((store) => store.getDraftSession(draftId));
  const environments = useLogicalProjectEnvironments(PROJECT_A, false, pinned ? ENV_A : null);
  const routing = useDraftEnvironmentRouting({
    draftId,
    draftThread,
    envLocked: false,
    automaticEnvironment: automatic && environments.length > 1,
    logicalProjectEnvironments: environments,
    environmentById: new Map(),
    providersByEnvironment: new Map(),
    loadBalancingSettings: { loadBalancingWeights: {} },
    referencedThreadContexts: [],
    activeProviderInstanceId: null,
    selectedProvider: ProviderDriverKind.make("codex"),
    composerHasAttachments: false,
    activeProjectKey: null,
    activeProjectIsScratch: false,
    projectGroupingSettings: {
      sidebarProjectGroupingMode: DEFAULT_CLIENT_SETTINGS.sidebarProjectGroupingMode,
      sidebarProjectGroupingOverrides: DEFAULT_CLIENT_SETTINGS.sidebarProjectGroupingOverrides,
    },
    sendInFlightRef,
  });
  return (
    <button type="button" onClick={() => routing.onEnvironmentChangeStable(ENV_B)}>
      Switch to B
    </button>
  );
}

let drafts = 0;
/** A fresh draft of the shared project on environment A. */
function setup() {
  const draftId = DraftId.make(`draft-routing-${++drafts}`);
  useComposerDraftStore
    .getState()
    .setProjectDraftThreadId(scopeProjectRef(ENV_A, PROJECT_A.id), draftId, {
      threadId: ThreadId.make(`thread-routing-${drafts}`),
    });
  return draftId;
}

const draftEnvironment = (draftId: DraftId) =>
  useComposerDraftStore.getState().getDraftSession(draftId)?.environmentId;

it.each([
  { pinned: false, automatic: false, expected: ENV_B },
  { pinned: true, automatic: false, expected: ENV_A },
])("a manual switch moves the draft unless its host pins it (pinned: $pinned)", async (row) => {
  const draftId = setup();
  await using screen = await render(
    <Draft draftId={draftId} pinned={row.pinned} automatic={row.automatic} />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Switch to B" }));
  expect(draftEnvironment(draftId)).toBe(row.expected);
});

it.each([
  { pinned: false, expected: ENV_B },
  { pinned: true, expected: ENV_A },
])("load balancing moves the draft unless its host pins it (pinned: $pinned)", async (row) => {
  const draftId = setup();
  // The balancer's write is an effect, so it has run once the render commits.
  await using _screen = await render(<Draft draftId={draftId} pinned={row.pinned} automatic />);
  expect(draftEnvironment(draftId)).toBe(row.expected);
});

import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { useComposerDraftStore } from "~/composerDraftStore";
import { useQuietThreadShell, useQuietThreadShells } from "~/state/entities";
import { useEnvironmentShellStatus } from "~/state/shell";
import { useEnvironmentThread } from "~/state/threads";
import { isThreadRouteSnapshotAuthoritative, resolveThreadRouteRenderState } from "~/threadRoutes";
import ChatView from "../ChatView";
import type { ChatEmbedding } from "../ChatView.logic";

/**
 * A linked conversation's normal chat, hosted in the Quest instead of on its thread route. The
 * draft and the server thread it promotes into share one key, so the first send keeps this
 * ChatView and the Quest route. The embedded chat cannot leave the Quest's environment.
 */
export function QuestChat({
  environmentId,
  threadId,
  onNewConversation,
}: {
  environmentId: EnvironmentId;
  threadId: string;
  onNewConversation: ChatEmbedding["openNewThread"];
}) {
  const ref = scopeThreadRef(environmentId, threadId as ThreadId);
  const draftId = useComposerDraftStore((store) => store.getDraftIdByRef(ref));
  const draftSession = useComposerDraftStore((store) =>
    draftId ? store.getDraftSession(draftId) : null,
  );
  const shell = useQuietThreadShell(ref);
  const bootstrapComplete = isThreadRouteSnapshotAuthoritative(
    useEnvironmentShellStatus(ref.environmentId),
  );
  const unlisted = shell === null && draftSession === null;
  const detail = useEnvironmentThread(
    unlisted ? ref.environmentId : null,
    unlisted ? ref.threadId : null,
  );
  // Clients before the environment pin could move a linked draft, or send it, to another
  // environment. The link names only the Quest's environment, so say where it went instead.
  const movedDraftId = useComposerDraftStore((store) =>
    unlisted
      ? (Object.entries(store.draftThreadsByThreadKey).find(
          ([, draft]) => draft.threadId === threadId && draft.environmentId !== environmentId,
        )?.[0] ?? null)
      : null,
  );
  const shells = useQuietThreadShells();
  const movedThread = unlisted
    ? shells.find(
        (candidate) => candidate.id === threadId && candidate.environmentId !== environmentId,
      )
    : undefined;
  const renderState = resolveThreadRouteRenderState({
    bootstrapComplete,
    serverThreadExists: shell !== null,
    serverThreadDeleted: shell?.deletedAt != null,
    unlistedThreadDetail: detail,
    draftThreadExists: draftSession !== null,
  });
  const key = scopedThreadKey(ref);
  const embedding = { openNewThread: onNewConversation };
  if (draftId && draftSession)
    return (
      <ChatView
        key={key}
        draftId={draftId}
        environmentId={draftSession.environmentId}
        threadId={draftSession.threadId}
        routeKind="draft"
        embedding={embedding}
      />
    );
  if (renderState === "ready")
    return (
      <ChatView
        key={key}
        environmentId={ref.environmentId}
        threadId={ref.threadId}
        routeKind="server"
        embedding={embedding}
      />
    );
  if (renderState === "missing" && movedThread)
    return (
      <MovedConversation>
        <Link
          className="underline"
          to="/$environmentId/$threadId"
          params={{ environmentId: movedThread.environmentId, threadId: movedThread.id }}
        >
          Open it outside the Quest
        </Link>
      </MovedConversation>
    );
  if (renderState === "missing" && movedDraftId)
    return (
      <MovedConversation>
        <Link className="underline" to="/draft/$draftId" params={{ draftId: movedDraftId }}>
          Open it outside the Quest
        </Link>
      </MovedConversation>
    );
  return (
    <p role={renderState === "missing" ? "alert" : "status"} className="p-6 text-sm">
      {renderState === "missing"
        ? "This conversation is not available on this client."
        : "Loading the conversation…"}
    </p>
  );
}

function MovedConversation({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 p-6 text-sm">
      <p role="alert">This conversation is on another environment than the Quest.</p>
      {children}
    </div>
  );
}

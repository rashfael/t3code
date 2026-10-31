import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useState } from "react";

import { useComposerDraftStore } from "~/composerDraftStore";
import { useQuietThreadShell } from "~/state/entities";
import { useEnvironmentShellStatus } from "~/state/shell";
import { useEnvironmentThread } from "~/state/threads";
import { isThreadRouteSnapshotAuthoritative, resolveThreadRouteRenderState } from "~/threadRoutes";
import ChatView from "../ChatView";

/**
 * A linked conversation's normal chat, hosted in the Quest instead of on its thread route. The
 * draft and the server thread it promotes into share one key, so the first send keeps this
 * ChatView and the Quest route instead of redirecting to the thread route.
 */
export function QuestChat({
  environmentId,
  threadId,
}: {
  environmentId: EnvironmentId;
  threadId: string;
}) {
  const linkedRef = scopeThreadRef(environmentId, threadId as ThreadId);
  const draftId = useComposerDraftStore((store) => store.getDraftIdByRef(linkedRef));
  const draftSession = useComposerDraftStore((store) =>
    draftId ? store.getDraftSession(draftId) : null,
  );
  // A sent draft can land on another environment; follow where it went, as its route would.
  const [sentDraftId, setSentDraftId] = useState(draftId);
  if (draftId && draftId !== sentDraftId) setSentDraftId(draftId);
  const promotedRef = useComposerDraftStore((store) =>
    !draftSession && sentDraftId ? store.getPromotedDraftRedirect(sentDraftId) : null,
  );
  const ref = promotedRef ?? linkedRef;
  const shell = useQuietThreadShell(ref);
  const bootstrapComplete = isThreadRouteSnapshotAuthoritative(
    useEnvironmentShellStatus(ref.environmentId),
  );
  const unlisted = shell === null && draftSession === null;
  const detail = useEnvironmentThread(
    unlisted ? ref.environmentId : null,
    unlisted ? ref.threadId : null,
  );
  const renderState = resolveThreadRouteRenderState({
    bootstrapComplete,
    serverThreadExists: shell !== null,
    serverThreadDeleted: shell?.deletedAt != null,
    unlistedThreadDetail: detail,
    draftThreadExists: draftSession !== null,
  });
  const key = scopedThreadKey(linkedRef);
  if (draftId && draftSession)
    return (
      <ChatView
        key={key}
        draftId={draftId}
        environmentId={draftSession.environmentId}
        threadId={draftSession.threadId}
        routeKind="draft"
        reserveTitleBarControlInset={false}
      />
    );
  if (renderState === "ready")
    return (
      <ChatView
        key={key}
        environmentId={ref.environmentId}
        threadId={ref.threadId}
        routeKind="server"
        reserveTitleBarControlInset={false}
      />
    );
  return (
    <p role={renderState === "missing" ? "alert" : "status"} className="p-6 text-sm">
      {renderState === "missing"
        ? "This conversation is not available on this client."
        : "Loading the conversation…"}
    </p>
  );
}

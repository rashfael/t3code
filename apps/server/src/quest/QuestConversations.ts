import {
  CommandId,
  ProjectId,
  QuestError,
  ThreadId,
  type QuestActor,
  type QuestOpenConversationInput,
  type QuestOpenConversationResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as QuestStore from "./QuestStore.ts";

export class QuestConversations extends Context.Service<
  QuestConversations,
  {
    /**
     * Creates or resumes a core or focused conversation as an ordinary thread without a turn.
     * The identity is saved first, so a retry or a second client resolves the same thread.
     */
    readonly open: (
      input: QuestOpenConversationInput,
      actor: QuestActor,
    ) => Effect.Effect<QuestOpenConversationResult, QuestError>;
  }
>()("t3/quest/QuestConversations") {}

const unavailable = (detail: string) => new QuestError({ reason: "unavailable", detail });

const make = Effect.gen(function* () {
  const store = yield* QuestStore.QuestStore;
  const launcher = yield* ThreadLaunchService.ThreadLaunchService;
  const threads = yield* ThreadManagementService.ThreadManagementService;

  const open = Effect.fn("QuestConversations.open")(function* (
    input: QuestOpenConversationInput,
    actor: QuestActor,
  ) {
    const reserved = yield* store.reserveConversation(input, actor);
    const { conversation } = reserved;
    const threadId = ThreadId.make(conversation.threadId);
    const shell = yield* threads
      .getThreadShell(threadId)
      .pipe(Effect.mapError(() => unavailable("The conversation could not be checked.")));
    const deleted = shell !== null && shell.deletedAt != null;
    if (conversation.creation === null || conversation.creation.status === "ready") {
      if (shell === null || deleted)
        return yield* unavailable(
          conversation.role === "core"
            ? "The core conversation was deleted. Replace it to continue; its identity stays in the Quest."
            : "This conversation is no longer available.",
        );
      return { state: reserved.state, threadId: conversation.threadId, created: false };
    }
    // Tombstones keep their id; never recreate a deleted reservation.
    if (deleted)
      return yield* unavailable("The reserved conversation was deleted. Replace it to continue.");
    const { requested, commandId } = conversation.creation;
    const launched = yield* launcher
      .launch({
        commandId: CommandId.make(commandId),
        threadId,
        projectId: ProjectId.make(conversation.projectId ?? input.projectId),
        title: conversation.title,
        modelSelection: requested.modelSelection,
        runtimeMode: requested.runtimeMode,
        interactionMode: requested.interactionMode,
        workspaceStrategy: { type: "root" },
        createdBy: "user",
        creationSource: "web",
      })
      .pipe(
        Effect.mapError((cause) =>
          unavailable(
            cause._tag === "ThreadManagementProviderInstanceDisabledError"
              ? "That provider is disabled for this project. The conversation stays reserved; try again after enabling it."
              : "The conversation could not be created yet. It stays reserved; try again.",
          ),
        ),
      );
    const state = yield* store.finalizeConversation(
      conversation.threadId,
      launched.projection.thread.modelSelection,
      actor,
    );
    return { state, threadId: conversation.threadId, created: reserved.created };
  });

  return QuestConversations.of({ open });
});

export const layer = Layer.effect(QuestConversations, make);

import type { EnvironmentId, QuestState } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { useLocalStorage, writeLocalStorageValue } from "~/hooks/useLocalStorage";

const STORAGE_KEY = "t3code:quest-conversations";

const QuestConversationIndex = Schema.Array(
  Schema.Struct({
    environmentId: Schema.String,
    threadId: Schema.String,
    workId: Schema.NullOr(Schema.String),
    about: Schema.NullOr(Schema.String),
  }),
);
type QuestConversationIndex = typeof QuestConversationIndex.Type;
const EMPTY: QuestConversationIndex = [];

/**
 * The Quest service owns links; this client-side copy only lets a thread route show its Quest
 * without loading the Quest. It refreshes whenever this client reads or saves the Quest.
 */
export function rememberQuestConversations(environmentId: EnvironmentId, state: QuestState) {
  writeLocalStorageValue(
    STORAGE_KEY,
    (previous) => [
      ...previous.filter((entry) => entry.environmentId !== environmentId),
      ...state.conversations.map((conversation) => ({
        environmentId,
        threadId: conversation.threadId,
        workId: conversation.workId,
        about:
          state.work.find((item) => item.id === conversation.workId)?.title ??
          state.questions.find((item) => item.id === conversation.questionId)?.title ??
          null,
      })),
    ],
    EMPTY,
    QuestConversationIndex,
  );
}

export function useQuestConversation(environmentId: string | null, threadId: string | null) {
  const [index] = useLocalStorage(STORAGE_KEY, EMPTY, QuestConversationIndex);
  return (
    index.find((entry) => entry.environmentId === environmentId && entry.threadId === threadId) ??
    null
  );
}

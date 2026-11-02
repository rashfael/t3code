import type { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ThreadTurnContext from "../orchestration-v2/ThreadTurnContext.ts";
import { questTurnOrientation } from "./questContext.ts";
import * as QuestStore from "./QuestStore.ts";

/** Orients each turn of a Quest member from its membership at dispatch, never a client's view. */
export const layer = Layer.effect(
  ThreadTurnContext.ThreadTurnContext,
  Effect.gen(function* () {
    const store = yield* QuestStore.QuestStore;
    return Effect.fn("QuestTurnContext.forThread")(
      function* (threadId: ThreadId) {
        const quest = yield* store.memberQuest(threadId);
        if (quest === null) return undefined;
        return questTurnOrientation(yield* quest.get, threadId, quest.identity);
      },
      // A turn must start even when the Quest cannot be read; it then carries no orientation.
      Effect.catch((error) =>
        Effect.logWarning("Quest orientation unavailable for this turn.", { error }).pipe(
          Effect.as(undefined),
        ),
      ),
    );
  }),
);

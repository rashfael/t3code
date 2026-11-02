import type { ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

/**
 * Trusted context about a thread that its provider receives with each turn, resolved when the
 * turn starts. The server supplies Quest membership; without it, turns carry none.
 */
export class ThreadTurnContext extends Context.Reference<
  (threadId: ThreadId) => Effect.Effect<string | undefined>
>("t3/orchestration-v2/ThreadTurnContext", {
  defaultValue: () => () => Effect.undefined,
}) {}

import { createQuestEnvironmentAtoms } from "@t3tools/client-runtime/state/quests";

import { connectionAtomRuntime } from "~/connection/runtime";

/** One instance for the Quest page and thread routes, so a save refreshes both. */
export const questEnvironment = createQuestEnvironmentAtoms(connectionAtomRuntime);

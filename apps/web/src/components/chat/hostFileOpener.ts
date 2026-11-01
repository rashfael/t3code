import { createContext } from "react";

/**
 * A host embedding chat, such as a Quest, can show some files itself. It receives the host path and
 * returns true when it opened it; other files keep opening in the thread's own panel.
 */
export const HostFileOpenerContext = createContext<((hostPath: string) => boolean) | null>(null);

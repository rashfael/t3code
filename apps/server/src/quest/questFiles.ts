// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";

import { QuestError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import type * as Path from "effect/Path";

export function sha256(bytes: Uint8Array): string {
  return NodeCrypto.createHash("sha256").update(bytes).digest("hex");
}

const unavailable = (detail: string) => new QuestError({ reason: "unavailable", detail });
const invalid = (detail: string) => new QuestError({ reason: "invalid", detail });

/** A workspace-relative Markdown path in normal form, or why it is not one. */
export function normalizeQuestFilePath(path: Path.Path, relative: string): string | null {
  const trimmed = relative.trim().replaceAll("\\", "/");
  if (trimmed.length === 0 || trimmed.startsWith("/") || path.isAbsolute(trimmed)) return null;
  const segments = trimmed.split("/").filter((segment) => segment !== "" && segment !== ".");
  if (segments.some((segment) => segment === "..")) return null;
  const normalized = segments.join("/");
  if (!normalized.toLowerCase().endsWith(".md")) return null;
  return normalized;
}

/**
 * Fails unless the registered root, stored canonical at registration, still resolves to itself. A
 * root replaced by a symlink to another folder is unavailable rather than adopted.
 */
export const requireQuestRoot = Effect.fn("QuestFiles.requireRoot")(function* (
  fs: FileSystem.FileSystem,
  root: string,
) {
  const real = yield* fs
    .realPath(root)
    .pipe(Effect.mapError(() => unavailable("The Quest workspace is not available.")));
  if (real !== root)
    return yield* unavailable(
      "The Quest workspace folder no longer resolves to where it was registered.",
    );
});

/**
 * Resolves a registered relative path inside the workspace on the owning environment. Rejects
 * traversal and symlinks whose real target leaves the workspace; clients never resolve paths.
 */
export const resolveQuestFile = Effect.fn("QuestFiles.resolve")(function* (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  root: string,
  relative: string,
) {
  const normalized = normalizeQuestFilePath(path, relative);
  if (normalized === null)
    return yield* invalid("Use a Markdown path inside the Quest workspace, such as notes/plan.md.");
  yield* requireQuestRoot(fs, root);
  const candidate = path.join(root, normalized);
  const real = yield* fs
    .realPath(candidate)
    .pipe(Effect.mapError(() => unavailable(`${normalized} is not available.`)));
  if (real !== root && !real.startsWith(`${root}${path.sep}`))
    return yield* invalid(`${normalized} leads outside the Quest workspace.`);
  const info = yield* fs
    .stat(real)
    .pipe(Effect.mapError(() => unavailable(`${normalized} is not available.`)));
  if (info.type !== "File") return yield* invalid(`${normalized} is not a file.`);
  return { normalized, real };
});

export const validateQuestWorkspace = Effect.fn("QuestFiles.validateWorkspace")(function* (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  root: string,
) {
  if (!path.isAbsolute(root))
    return yield* invalid("Give the workspace as an absolute folder path.");
  const real = yield* fs
    .realPath(root)
    .pipe(Effect.mapError(() => unavailable("That folder does not exist on this environment.")));
  const info = yield* fs
    .stat(real)
    .pipe(Effect.mapError(() => unavailable("That folder does not exist on this environment.")));
  if (info.type !== "Directory") return yield* invalid("The workspace must be a folder.");
  return real;
});

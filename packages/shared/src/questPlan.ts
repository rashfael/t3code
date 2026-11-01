import type { QuestDomain, QuestPlanEdit, QuestPlanWorkPatch, QuestWork } from "@t3tools/contracts";

const PLAN_WORK_KEYS = ["title", "state", "parentId", "understanding", "focus"] as const;
type PlanWorkKey = (typeof PLAN_WORK_KEYS)[number];
const PLAN_WORK_LABELS: Record<PlanWorkKey, string> = {
  title: "title",
  state: "state",
  parentId: "parent",
  understanding: "understanding",
  focus: "planned focus",
};

function planWorkValue(work: QuestWork, key: PlanWorkKey): string | number | null {
  return key === "focus" ? (work.focus ?? null) : work[key];
}

function patchKeys(patch: QuestPlanWorkPatch): ReadonlyArray<PlanWorkKey> {
  return PLAN_WORK_KEYS.filter((key) => key in patch);
}

/** Captures the current values a patch replaces. */
export function questPlanWorkBase(work: QuestWork, after: QuestPlanWorkPatch): QuestPlanWorkPatch {
  return Object.fromEntries(
    patchKeys(after).map((key) => [key, planWorkValue(work, key)]),
  ) as QuestPlanWorkPatch;
}

export function questFollowsId(from: string, to: string): string {
  return `follows:${from}:${to}`;
}

export interface QuestPlanEditCheck {
  /** `already`: the plan holds the proposed value. `stale`: the value it replaces changed since. */
  readonly status: "ready" | "already" | "stale" | "invalid";
  readonly detail: string;
}

type QuestPlanBase = Pick<QuestDomain, "work" | "relations" | "conversations" | "currentWorkId">;

/**
 * Whether each edit can apply to the current plan when exactly `selected` edits are applied. The
 * server refuses application unless every selected edit is `ready` or `already`; the preview shows
 * the same result.
 */
export function questPlanEditChecks(
  state: QuestPlanBase,
  edits: ReadonlyArray<QuestPlanEdit>,
  selected: ReadonlySet<string>,
): ReadonlyMap<string, QuestPlanEditCheck> {
  const added = new Set(
    edits.flatMap((edit) =>
      edit.type === "add-work" && selected.has(edit.id) ? [edit.work.id] : [],
    ),
  );
  const exists = (id: string) => added.has(id) || state.work.some((item) => item.id === id);
  const title = (id: string | null) =>
    id === null ? "none" : (state.work.find((item) => item.id === id)?.title ?? id);
  const ok = { status: "ready", detail: "" } as const;
  const already = { status: "already", detail: "The plan already holds this." } as const;
  const invalid = (detail: string) => ({ status: "invalid", detail }) as const;
  const stale = (detail: string) => ({ status: "stale", detail }) as const;
  const checks = new Map<string, QuestPlanEditCheck>();
  for (const edit of edits) {
    checks.set(
      edit.id,
      (() => {
        switch (edit.type) {
          case "add-work": {
            if (state.work.some((item) => item.id === edit.work.id))
              return invalid(`Work “${edit.work.id}” already exists.`);
            if (edit.work.parentId !== null && !exists(edit.work.parentId))
              return invalid(`Its parent “${edit.work.parentId}” is not in the plan.`);
            return ok;
          }
          case "change-work": {
            const work = state.work.find((item) => item.id === edit.workId);
            if (!work) return invalid("This work is no longer in the Quest.");
            const keys = patchKeys(edit.after);
            if (keys.every((key) => planWorkValue(work, key) === (edit.after[key] ?? null)))
              return already;
            const moved = keys.filter((key) => {
              const current = planWorkValue(work, key);
              return (
                current !== (edit.before[key] ?? null) && current !== (edit.after[key] ?? null)
              );
            });
            if (moved.length > 0)
              return stale(
                `Changed since proposed: ${moved.map((key) => PLAN_WORK_LABELS[key]).join(", ")}.`,
              );
            const parentId = edit.after.parentId;
            if (parentId !== undefined && parentId !== null && !exists(parentId))
              return invalid(`The new parent “${parentId}” is not in the plan.`);
            return ok;
          }
          case "add-follows": {
            if (state.relations.some((item) => item.id === questFollowsId(edit.from, edit.to)))
              return already;
            if (!exists(edit.from) || !exists(edit.to))
              return invalid(`Both “${title(edit.from)}” and “${title(edit.to)}” must exist.`);
            return ok;
          }
          case "remove-relation": {
            const relation = state.relations.find((item) => item.id === edit.relationId);
            if (!relation) return already;
            return JSON.stringify(relation) === JSON.stringify(edit.before)
              ? ok
              : stale("The relation changed since proposed.");
          }
          case "set-current": {
            if (state.currentWorkId === edit.workId) return already;
            if (!exists(edit.workId)) return invalid("That work is not in the plan.");
            return state.currentWorkId === edit.before
              ? ok
              : stale(`The current milestone is now “${title(state.currentWorkId)}”.`);
          }
          case "associate-conversation": {
            const conversation = state.conversations.find(
              (item) => item.threadId === edit.threadId,
            );
            if (!conversation) return invalid("This discussion is no longer in the Quest.");
            if (conversation.workId === edit.workId) return already;
            if (edit.workId !== null && !exists(edit.workId))
              return invalid("That work is not in the plan.");
            return conversation.workId === edit.before
              ? ok
              : stale(`The discussion is now about “${title(conversation.workId)}”.`);
          }
        }
      })(),
    );
  }
  return checks;
}

/** One line per edit for previews and history: what changes, from what, to what. */
export function questPlanEditSummary(
  state: Pick<QuestDomain, "work" | "conversations">,
  edit: QuestPlanEdit,
): { readonly label: string; readonly before: string | null; readonly after: string | null } {
  const title = (id: string | null) =>
    id === null ? null : (state.work.find((item) => item.id === id)?.title ?? id);
  switch (edit.type) {
    case "add-work":
      return {
        label: `New work “${edit.work.title}”${edit.work.parentId ? ` under “${title(edit.work.parentId)}”` : ""}`,
        before: null,
        after: [edit.work.state, edit.work.understanding].filter(Boolean).join(" · "),
      };
    case "change-work": {
      const keys = patchKeys(edit.after);
      const show = (patch: QuestPlanWorkPatch) =>
        keys
          .map((key) => {
            const value = patch[key] ?? null;
            const text = key === "parentId" ? title(value as string | null) : value;
            return `${PLAN_WORK_LABELS[key]}: ${text ?? "(none)"}`;
          })
          .join("\n");
      return {
        label: `“${title(edit.workId)}” · ${keys.map((key) => PLAN_WORK_LABELS[key]).join(", ")}`,
        before: show(edit.before),
        after: show(edit.after),
      };
    }
    case "add-follows":
      return {
        label: "New dependency",
        before: null,
        after: `“${title(edit.from)}” follows “${title(edit.to)}”`,
      };
    case "remove-relation":
      return {
        label: "Removed relation",
        before: `“${title(edit.before.from)}” ${edit.before.type} “${title(edit.before.to)}”`,
        after: null,
      };
    case "set-current":
      return { label: "Current milestone", before: title(edit.before), after: title(edit.workId) };
    case "associate-conversation": {
      const conversation = state.conversations.find((item) => item.threadId === edit.threadId);
      return {
        label: `Discussion “${conversation?.purpose || conversation?.title || edit.threadId}” works on`,
        before: title(edit.before),
        after: title(edit.workId),
      };
    }
  }
}

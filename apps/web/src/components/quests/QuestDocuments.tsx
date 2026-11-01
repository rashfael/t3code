import { questQuestionStatus } from "@t3tools/contracts";
import { useState } from "react";

import { useEnvironmentQuery } from "~/state/query";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { useQuest } from "./questContext";
import { questEnvironment } from "./questEnvironment";

/** A pinned version's tab id: the document id and the retained content hash. */
export function pinnedTabId(documentId: string, sha256: string) {
  return `${documentId}@${sha256}`;
}

/** Shows one saved revision rebuilt from the baseline and revision records. */
export function ReconstructRevision() {
  const { environmentId, state } = useQuest();
  const [value, setValue] = useState("");
  const [revision, setRevision] = useState<number | null>(null);
  const query = useEnvironmentQuery(
    revision === null ? null : questEnvironment.reconstruct({ environmentId, input: { revision } }),
  );
  const past = query.data;
  const title = (workId: string | null) =>
    past?.domain.work.find((item) => item.id === workId)?.title;
  return (
    <section className="mt-4 rounded border p-3 text-sm">
      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const parsed = Number.parseInt(value, 10);
          if (Number.isInteger(parsed)) setRevision(parsed);
        }}
      >
        <label className="grid gap-1 text-xs text-muted-foreground">
          Show the saved Quest at revision
          <Input
            aria-label="Revision"
            inputMode="numeric"
            placeholder={String(state.revision)}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </label>
        <Button type="submit" size="sm" variant="outline">
          Show
        </Button>
      </form>
      {revision !== null && query.error ? (
        <p role="alert" className="mt-2 text-xs">
          {query.error}
        </p>
      ) : null}
      {past ? (
        <div className="mt-3 grid gap-2">
          <p className="text-xs text-muted-foreground">{past.limit}</p>
          <p>
            Revision {past.revision} · current milestone{" "}
            {title(past.domain.currentWorkId) ?? "none"}
          </p>
          <div>
            <p className="text-xs font-medium">Conversations</p>
            <ul className="text-xs">
              {past.domain.conversations.length === 0 ? <li>None</li> : null}
              {past.domain.conversations.map((item) => (
                <li key={item.threadId}>
                  {item.purpose || item.title} · {item.role}
                  {item.workId ? ` · about ${title(item.workId) ?? item.workId}` : ""}
                  {item.questionId
                    ? ` · about ${past.domain.questions.find((q) => q.id === item.questionId)?.title ?? item.questionId}`
                    : ""}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-xs font-medium">Decisions</p>
            <ul className="text-xs">
              {past.domain.questions.map((item) => (
                <li key={item.id}>
                  {item.title} · {questQuestionStatus(item)}
                  {item.answer ? ` · “${item.answer}”` : ""}
                </li>
              ))}
            </ul>
          </div>
          {past.records.at(-1)?.revision === past.revision ? (
            <div>
              <p className="text-xs font-medium">Changed in this revision</p>
              <ul className="text-xs">
                {past.records.at(-1)!.changes.map((change) => (
                  <li key={`${change.collection}:${change.id}`}>
                    {change.collection} · {change.id} ·{" "}
                    {change.before === null
                      ? "created"
                      : change.after === null
                        ? "removed"
                        : "changed"}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

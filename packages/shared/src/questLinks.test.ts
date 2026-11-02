import { describe, expect, it } from "vite-plus/test";

import { formatQuestLink, parseQuestLinkHref, questLinkSearch } from "./questLinks.ts";

const proposal = {
  environmentId: "env/one",
  questId: "t3-quests",
  kind: "proposal",
  id: "proposal-1",
} as const;

describe("quest links", () => {
  it("round-trips ids that need escaping and rejects unknown shapes", () => {
    const document = { ...proposal, kind: "document", id: "doc-1@" + "a".repeat(64) } as const;
    for (const link of [proposal, document]) {
      const href = formatQuestLink(link, "Title").match(/\]\((.*)\)$/)![1]!;
      expect(parseQuestLinkHref(href)).toEqual(link);
    }
    expect(parseQuestLinkHref("t3-quest://v1/env/quest/thread/x")).toBeNull();
    expect(parseQuestLinkHref("t3-quest://v1/env/quest/result")).toBeNull();
    expect(parseQuestLinkHref("t3-quest://v1/env/quest/result/%E0%A4%A")).toBeNull();
  });

  it("opens results and proposals in Decisions and documents in Documents", () => {
    expect(questLinkSearch({ ...proposal, kind: "result", id: "result-1" })).toEqual({
      env: "env/one",
      quest: "t3-quests",
      view: "decisions",
      question: "result-1",
    });
    expect(questLinkSearch({ ...proposal, kind: "document", id: "doc-1" })).toMatchObject({
      view: "documents",
      document: "doc-1",
    });
  });

  it("keeps labels readable and uses the caller's web origin when given", () => {
    expect(formatQuestLink(proposal, "Plan [draft]\nnext")).toBe(
      "[Plan draft next](t3-quest://v1/env%2Fone/t3-quests/proposal/proposal-1)",
    );
    expect(formatQuestLink(proposal, "P", "https://host.example")).toBe(
      "[P](https://host.example/quests?env=env%2Fone&quest=t3-quests&view=decisions&question=proposal-1)",
    );
  });
});

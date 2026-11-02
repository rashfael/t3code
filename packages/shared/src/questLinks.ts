export const QUEST_LINK_PROTOCOL = "t3-quest";
const V1_PREFIX = `${QUEST_LINK_PROTOCOL}://v1/`;

const QUEST_LINK_KINDS = ["result", "proposal", "question", "work", "document"] as const;
export type QuestLinkKind = (typeof QUEST_LINK_KINDS)[number];

/** One record in one Quest of one environment, by the immutable ids the Quest stores. */
export interface QuestLink {
  readonly environmentId: string;
  readonly questId: string;
  readonly kind: QuestLinkKind;
  /** A document id may carry `@<sha256>` to open that retained version. */
  readonly id: string;
}

function questLinkHref(link: QuestLink): string {
  return `${V1_PREFIX}${[link.environmentId, link.questId, link.kind, link.id].map(encodeURIComponent).join("/")}`;
}

export function parseQuestLinkHref(href: string): QuestLink | null {
  if (!href.startsWith(V1_PREFIX)) return null;
  const parts = href.slice(V1_PREFIX.length).split("/");
  if (parts.length !== 4 || parts.some((part) => part.length === 0)) return null;
  try {
    const [environmentId, questId, kind, id] = parts.map(decodeURIComponent) as [
      string,
      string,
      string,
      string,
    ];
    const known = QUEST_LINK_KINDS.find((item) => item === kind);
    return known ? { environmentId, questId, kind: known, id } : null;
  } catch {
    return null;
  }
}

/** The `/quests` route search that opens the record: Decisions holds results and proposals. */
export function questLinkSearch(link: QuestLink): Record<string, string> {
  const at = { env: link.environmentId, quest: link.questId };
  switch (link.kind) {
    case "result":
    case "proposal":
    case "question":
      return { ...at, view: "decisions", question: link.id };
    case "work":
      return { ...at, view: "overview", work: link.id };
    case "document":
      return { ...at, view: "documents", document: link.id };
  }
}

/**
 * A Markdown link with a readable label; clients that cannot open it still show the label.
 * With `webOrigin`, a web URL on that origin for MCP clients that cannot open T3 links.
 */
export function formatQuestLink(link: QuestLink, label: string, webOrigin?: string): string {
  const cleaned =
    label
      .replace(/[[\]\\\r\n]/g, " ")
      .replace(/\s+/g, " ")
      .trim() || link.id;
  const href =
    webOrigin === undefined
      ? questLinkHref(link)
      : `${webOrigin}/quests?${new URLSearchParams(questLinkSearch(link)).toString()}`;
  return `[${cleaned}](${href})`;
}

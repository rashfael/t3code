import ChatMarkdown from "../ChatMarkdown";

/**
 * Quest prose through T3's Markdown renderer. No workspace or thread is passed, so links to files
 * stay inert instead of opening a project's file panel for paths outside it.
 */
export function QuestMarkdown({ text, className }: { text: string; className?: string }) {
  return <ChatMarkdown text={text} cwd={undefined} className={className ?? "text-sm"} />;
}

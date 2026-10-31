import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const components: Components = {
  // Captured links point into the original repository, which this environment does not hold.
  a: ({ children }) => <span className="underline decoration-dotted">{children}</span>,
  table: ({ children }) => (
    <div className="chat-markdown-table-container">
      <table>{children}</table>
    </div>
  ),
};

export function QuestMarkdown({ text }: { text: string }) {
  return (
    <div className="chat-markdown w-full min-w-0 text-sm [overflow-wrap:anywhere]">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

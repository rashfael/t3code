import { EditProvider, File, Virtualizer } from "@pierre/diffs/react";
import { useState } from "react";

import { useRenderedAppearance } from "~/hooks/useTheme";
import { resolveDiffThemeName } from "~/lib/diffRendering";
import { PREFERRED_HIGHLIGHTER } from "~/lib/syntaxHighlighting";
import { DiffWorkerPoolProvider } from "../DiffWorkerPoolProvider";
import type { FileCommentAnnotationGroup } from "../files/fileCommentAnnotations";
import { projectFileCacheKey } from "../files/fileContentRevision";
import { createFileEditor, useEditableAfterHighlight } from "../files/fileEditor";
import { FILE_LINK_REVEAL_UNSAFE_CSS } from "../files/fileSurfaceChrome";

/** T3's source editor for one draft. The editor owns its text once mounted; changes only leave it. */
export default function QuestSourceEditor({
  name,
  contents,
  onChange,
}: {
  name: string;
  contents: string;
  onChange: (contents: string) => void;
}) {
  return (
    <DiffWorkerPoolProvider>
      <SourceEditorSurface name={name} contents={contents} onChange={onChange} />
    </DiffWorkerPoolProvider>
  );
}

function SourceEditorSurface({
  name,
  contents,
  onChange,
}: {
  name: string;
  contents: string;
  onChange: (contents: string) => void;
}) {
  const resolvedTheme = useRenderedAppearance();
  const [file] = useState(() => ({
    name,
    contents,
    cacheKey: `quest-editor:${projectFileCacheKey("quest", name, contents)}`,
  }));
  const { ready, onPostRender } = useEditableAfterHighlight(file);
  return (
    <EditProvider createEditor={createFileEditor}>
      <div className="flex min-h-0 flex-1">
        <Virtualizer
          className="file-preview-virtualizer min-h-0 flex-1 overflow-auto"
          config={{ overscrollSize: 600, intersectionObserverMargin: 1200 }}
        >
          <File<FileCommentAnnotationGroup>
            file={file}
            edit={ready}
            onEditChange={(event) => onChange(event.file.contents)}
            options={{
              disableFileHeader: true,
              overflow: "wrap",
              theme: resolveDiffThemeName(resolvedTheme),
              preferredHighlighter: PREFERRED_HIGHLIGHTER,
              themeType: resolvedTheme,
              unsafeCSS: FILE_LINK_REVEAL_UNSAFE_CSS,
              onPostRender: (_container, instance, phase) => onPostRender(instance.file, phase),
            }}
            className="min-h-full"
          />
        </Virtualizer>
      </div>
    </EditProvider>
  );
}

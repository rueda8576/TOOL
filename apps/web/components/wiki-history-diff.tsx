"use client";

import dynamic from "next/dynamic";
import { useCallback } from "react";
import type * as Monaco from "monaco-editor";

import { DOCTORAL_MONACO_THEME, ensureMonacoLanguages } from "../lib/monaco-languages";

const MonacoDiffEditor = dynamic(async () => (await import("@monaco-editor/react")).DiffEditor, {
  ssr: false,
  loading: () => <div className="wiki-history-diff-loading">Loading diff...</div>
});

export function WikiHistoryDiff({
  original,
  modified
}: {
  original: string;
  modified: string;
}): JSX.Element {
  const beforeMount = useCallback((monaco: typeof Monaco): void => {
    ensureMonacoLanguages(monaco);
    monaco.editor.setTheme(DOCTORAL_MONACO_THEME);
  }, []);

  return (
    <div className="wiki-history-diff-surface">
      <MonacoDiffEditor
        height="100%"
        language="markdown"
        original={original}
        modified={modified}
        theme={DOCTORAL_MONACO_THEME}
        beforeMount={beforeMount}
        options={{
          automaticLayout: true,
          domReadOnly: true,
          fontSize: 13,
          folding: true,
          glyphMargin: false,
          ignoreTrimWhitespace: false,
          lineNumbers: "on",
          minimap: { enabled: false },
          originalEditable: false,
          readOnly: true,
          renderOverviewRuler: false,
          renderSideBySide: true,
          scrollBeyondLastLine: false,
          useInlineViewWhenSpaceIsLimited: true,
          wordWrap: "off"
        }}
      />
    </div>
  );
}

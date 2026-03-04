"use client";

import dynamic from "next/dynamic";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState
} from "react";
import type * as Monaco from "monaco-editor";
import type { editor as MonacoEditorApi } from "monaco-editor";

import {
  DOCTORAL_MONACO_THEME,
  ensureMonacoLanguages,
  MonacoDocumentLanguage
} from "../lib/monaco-languages";

const MonacoEditor = dynamic(async () => (await import("@monaco-editor/react")).default, {
  ssr: false,
  loading: () => <div className="documents-monaco-loading">Loading editor...</div>
});

const FONT_SIZE_STORAGE_KEY = "documents_editor_font_size_px";
const DEFAULT_EDITOR_FONT_SIZE_PX = 14;
const MIN_EDITOR_FONT_SIZE_PX = 11;
const MAX_EDITOR_FONT_SIZE_PX = 28;
const FONT_SIZE_STEP_PX = 1;
const WORD_HIGHLIGHT_CLASS_NAME = "documents-monaco-word-highlight";

const WORD_CHAR_PATTERN = /[A-Za-z0-9_]/;

export type LatexMonacoEditorHandle = {
  focus: () => void;
  highlightWord: (word: string, durationMs?: number) => void;
};

type LatexMonacoEditorProps = {
  value: string;
  language: MonacoDocumentLanguage;
  readOnly?: boolean;
  disabled?: boolean;
  className?: string;
  onChange: (nextValue: string) => void;
  onFocusChange?: (isFocused: boolean) => void;
  onWordDoubleClick?: (word: string) => void;
  onSaveShortcut?: () => void;
  onToggleTreeShortcut?: () => void;
};

function clampEditorFontSize(nextSize: number): number {
  if (!Number.isFinite(nextSize)) {
    return DEFAULT_EDITOR_FONT_SIZE_PX;
  }

  return Math.min(Math.max(Math.round(nextSize), MIN_EDITOR_FONT_SIZE_PX), MAX_EDITOR_FONT_SIZE_PX);
}

function normalizeWordToken(rawValue: string): string {
  return rawValue.trim().replace(/^[^A-Za-z0-9_]+|[^A-Za-z0-9_]+$/g, "");
}

function isWordBoundary(character: string | undefined): boolean {
  if (!character) {
    return true;
  }

  return !WORD_CHAR_PATTERN.test(character);
}

function findWordRanges(model: MonacoEditorApi.ITextModel, rawWord: string): Monaco.IRange[] {
  const normalizedWord = normalizeWordToken(rawWord);
  if (!normalizedWord) {
    return [];
  }

  const normalizedWordLower = normalizedWord.toLowerCase();
  const matches: Monaco.IRange[] = [];

  for (let lineNumber = 1; lineNumber <= model.getLineCount(); lineNumber += 1) {
    const lineContent = model.getLineContent(lineNumber);
    if (!lineContent) {
      continue;
    }

    const lowerLine = lineContent.toLowerCase();
    let searchIndex = 0;
    while (searchIndex < lowerLine.length) {
      const matchIndex = lowerLine.indexOf(normalizedWordLower, searchIndex);
      if (matchIndex === -1) {
        break;
      }

      const startColumn = matchIndex + 1;
      const endColumn = startColumn + normalizedWord.length;
      const previousCharacter = lineContent[matchIndex - 1];
      const nextCharacter = lineContent[matchIndex + normalizedWord.length];

      if (isWordBoundary(previousCharacter) && isWordBoundary(nextCharacter)) {
        matches.push({
          startLineNumber: lineNumber,
          startColumn,
          endLineNumber: lineNumber,
          endColumn
        });
      }

      searchIndex = matchIndex + normalizedWord.length;
    }
  }

  return matches;
}

export const LatexMonacoEditor = forwardRef<LatexMonacoEditorHandle, LatexMonacoEditorProps>(function LatexMonacoEditor(
  {
    value,
    language,
    readOnly = false,
    disabled = false,
    className,
    onChange,
    onFocusChange,
    onWordDoubleClick,
    onSaveShortcut,
    onToggleTreeShortcut
  },
  ref
): JSX.Element {
  const editorRef = useRef<MonacoEditorApi.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);
  const fontSizeRef = useRef<number>(DEFAULT_EDITOR_FONT_SIZE_PX);
  const onFocusChangeRef = useRef<typeof onFocusChange>(onFocusChange);
  const onWordDoubleClickRef = useRef<typeof onWordDoubleClick>(onWordDoubleClick);
  const onSaveShortcutRef = useRef<typeof onSaveShortcut>(onSaveShortcut);
  const onToggleTreeShortcutRef = useRef<typeof onToggleTreeShortcut>(onToggleTreeShortcut);
  const highlightDecorationIdsRef = useRef<string[]>([]);
  const highlightTimeoutRef = useRef<number | null>(null);
  const [fontSizePx, setFontSizePx] = useState<number>(DEFAULT_EDITOR_FONT_SIZE_PX);
  const [fontSizePreferenceLoaded, setFontSizePreferenceLoaded] = useState(false);

  useEffect(() => {
    const storedFontSize = localStorage.getItem(FONT_SIZE_STORAGE_KEY);
    if (storedFontSize) {
      const parsed = Number.parseInt(storedFontSize, 10);
      if (Number.isFinite(parsed)) {
        setFontSizePx(clampEditorFontSize(parsed));
      }
    }

    setFontSizePreferenceLoaded(true);
  }, []);

  useEffect(() => {
    if (!fontSizePreferenceLoaded) {
      return;
    }

    localStorage.setItem(FONT_SIZE_STORAGE_KEY, String(fontSizePx));
  }, [fontSizePreferenceLoaded, fontSizePx]);

  const clearWordHighlight = useCallback((): void => {
    if (highlightTimeoutRef.current !== null) {
      window.clearTimeout(highlightTimeoutRef.current);
      highlightTimeoutRef.current = null;
    }

    const editor = editorRef.current;
    if (!editor) {
      highlightDecorationIdsRef.current = [];
      return;
    }

    highlightDecorationIdsRef.current = editor.deltaDecorations(highlightDecorationIdsRef.current, []);
  }, []);

  const highlightWord = useCallback(
    (rawWord: string, durationMs = 1500): void => {
      const editor = editorRef.current;
      if (!editor) {
        return;
      }

      const model = editor.getModel();
      if (!model) {
        return;
      }

      const ranges = findWordRanges(model, rawWord);
      highlightDecorationIdsRef.current = editor.deltaDecorations(
        highlightDecorationIdsRef.current,
        ranges.map((range) => ({
          range,
          options: {
            inlineClassName: WORD_HIGHLIGHT_CLASS_NAME
          }
        }))
      );

      if (ranges.length > 0) {
        editor.revealRangeInCenter(ranges[0]);
      }

      if (durationMs > 0) {
        if (highlightTimeoutRef.current !== null) {
          window.clearTimeout(highlightTimeoutRef.current);
        }

        highlightTimeoutRef.current = window.setTimeout(() => {
          clearWordHighlight();
        }, durationMs);
      }
    },
    [clearWordHighlight]
  );

  useImperativeHandle(
    ref,
    () => ({
      focus: () => {
        editorRef.current?.focus();
      },
      highlightWord
    }),
    [highlightWord]
  );

  const applyFontSize = useCallback((nextSize: number): void => {
    const clampedFontSize = clampEditorFontSize(nextSize);
    setFontSizePx(clampedFontSize);
    editorRef.current?.updateOptions({ fontSize: clampedFontSize });
  }, []);

  useEffect(() => {
    editorRef.current?.updateOptions({
      readOnly: readOnly || disabled,
      fontSize: fontSizePx
    });
    fontSizeRef.current = fontSizePx;
  }, [disabled, fontSizePx, readOnly]);

  useEffect(() => {
    onFocusChangeRef.current = onFocusChange;
  }, [onFocusChange]);

  useEffect(() => {
    onWordDoubleClickRef.current = onWordDoubleClick;
  }, [onWordDoubleClick]);

  useEffect(() => {
    onSaveShortcutRef.current = onSaveShortcut;
  }, [onSaveShortcut]);

  useEffect(() => {
    onToggleTreeShortcutRef.current = onToggleTreeShortcut;
  }, [onToggleTreeShortcut]);

  useEffect(
    () => () => {
      if (highlightTimeoutRef.current !== null) {
        window.clearTimeout(highlightTimeoutRef.current);
        highlightTimeoutRef.current = null;
      }
    },
    []
  );

  const beforeMount = useCallback((monaco: typeof Monaco): void => {
    ensureMonacoLanguages(monaco);
    monaco.editor.setTheme(DOCTORAL_MONACO_THEME);
  }, []);

  const mountEditor = useCallback(
    (editor: MonacoEditorApi.IStandaloneCodeEditor, monaco: typeof Monaco): void => {
      editorRef.current = editor;
      monacoRef.current = monaco;

      ensureMonacoLanguages(monaco);
      monaco.editor.setTheme(DOCTORAL_MONACO_THEME);

      const model = editor.getModel();
      if (model && model.getLanguageId() !== language) {
        monaco.editor.setModelLanguage(model, language);
      }

      editor.updateOptions({
        readOnly: readOnly || disabled,
        tabSize: 2,
        insertSpaces: true,
        fontSize: fontSizePx
      });

      editor.addAction({
        id: "doctoral.find",
        label: "Find",
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyF],
        run: async () => {
          await editor.getAction("actions.find")?.run();
        }
      });

      editor.addAction({
        id: "doctoral.replace",
        label: "Find and Replace",
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyH],
        run: async () => {
          await editor.getAction("editor.action.startFindReplaceAction")?.run();
        }
      });

      editor.addAction({
        id: "doctoral.indent.ctrl.bracket.right",
        label: "Indent Line",
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.BracketRight],
        run: async () => {
          await editor.getAction("editor.action.indentLines")?.run();
        }
      });

      editor.addAction({
        id: "doctoral.outdent.ctrl.bracket.left",
        label: "Outdent Line",
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.BracketLeft],
        run: async () => {
          await editor.getAction("editor.action.outdentLines")?.run();
        }
      });

      editor.addAction({
        id: "doctoral.font.zoom.in.equal",
        label: "Increase Editor Font Size",
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Equal, monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Equal],
        run: () => {
          applyFontSize(fontSizeRef.current + FONT_SIZE_STEP_PX);
        }
      });

      editor.addAction({
        id: "doctoral.font.zoom.in.numpad",
        label: "Increase Editor Font Size (Numpad)",
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.NumpadAdd],
        run: () => {
          applyFontSize(fontSizeRef.current + FONT_SIZE_STEP_PX);
        }
      });

      editor.addAction({
        id: "doctoral.font.zoom.out.minus",
        label: "Decrease Editor Font Size",
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Minus],
        run: () => {
          applyFontSize(fontSizeRef.current - FONT_SIZE_STEP_PX);
        }
      });

      editor.addAction({
        id: "doctoral.font.zoom.out.numpad",
        label: "Decrease Editor Font Size (Numpad)",
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.NumpadSubtract],
        run: () => {
          applyFontSize(fontSizeRef.current - FONT_SIZE_STEP_PX);
        }
      });

      editor.addAction({
        id: "doctoral.font.zoom.reset",
        label: "Reset Editor Font Size",
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Digit0, monaco.KeyMod.CtrlCmd | monaco.KeyCode.Numpad0],
        run: () => {
          applyFontSize(DEFAULT_EDITOR_FONT_SIZE_PX);
        }
      });

      editor.addAction({
        id: "doctoral.shortcut.save",
        label: "Save and Compile",
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
        run: () => {
          onSaveShortcutRef.current?.();
        }
      });

      editor.addAction({
        id: "doctoral.shortcut.tree.toggle",
        label: "Toggle Document Tree",
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyB],
        run: () => {
          onToggleTreeShortcutRef.current?.();
        }
      });

      editor.onDidFocusEditorText(() => {
        onFocusChangeRef.current?.(true);
      });

      editor.onDidBlurEditorText(() => {
        onFocusChangeRef.current?.(false);
      });

      editor.onMouseDown((mouseEvent) => {
        if (mouseEvent.event.detail !== 2) {
          return;
        }

        const position = mouseEvent.target.position;
        if (!position) {
          return;
        }

        const currentModel = editor.getModel();
        if (!currentModel) {
          return;
        }

        const word = currentModel.getWordAtPosition(position)?.word;
        if (!word) {
          return;
        }

        const normalizedWord = normalizeWordToken(word);
        if (!normalizedWord) {
          return;
        }

        onWordDoubleClickRef.current?.(normalizedWord);
      });
    },
    [applyFontSize, disabled, language, readOnly]
  );

  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) {
      return;
    }

    const model = editor.getModel();
    if (model && model.getLanguageId() !== language) {
      monaco.editor.setModelLanguage(model, language);
    }
  }, [language]);

  const editorClassName = useMemo(() => ["documents-monaco-host", className ?? ""].join(" ").trim(), [className]);

  return (
    <div className={editorClassName}>
      <MonacoEditor
        value={value}
        language={language}
        theme={DOCTORAL_MONACO_THEME}
        beforeMount={beforeMount}
        onMount={mountEditor}
        onChange={(nextValue) => {
          onChange(nextValue ?? "");
        }}
        options={{
          automaticLayout: true,
          minimap: { enabled: false },
          wordWrap: "on",
          scrollBeyondLastLine: false,
          tabSize: 2,
          insertSpaces: true,
          fontSize: fontSizePx,
          readOnly: readOnly || disabled,
          lineNumbersMinChars: 3,
          padding: {
            top: 10,
            bottom: 10
          }
        }}
      />
    </div>
  );
});

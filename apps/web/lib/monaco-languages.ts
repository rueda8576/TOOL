import type * as Monaco from "monaco-editor";

export const DOCTORAL_LATEX_LANGUAGE = "doctoral-latex";
export const DOCTORAL_BIBTEX_LANGUAGE = "doctoral-bibtex";
export const DOCTORAL_MONACO_THEME = "doctoral-academic-slate";

export type MonacoDocumentLanguage = typeof DOCTORAL_LATEX_LANGUAGE | typeof DOCTORAL_BIBTEX_LANGUAGE;

let monacoConfigured = false;

export function inferMonacoDocumentLanguage(filePath: string): MonacoDocumentLanguage {
  return filePath.toLowerCase().endsWith(".bib") ? DOCTORAL_BIBTEX_LANGUAGE : DOCTORAL_LATEX_LANGUAGE;
}

export function ensureMonacoLanguages(monaco: typeof Monaco): void {
  if (monacoConfigured) {
    return;
  }

  monaco.languages.register({ id: DOCTORAL_LATEX_LANGUAGE });
  monaco.languages.setLanguageConfiguration(DOCTORAL_LATEX_LANGUAGE, {
    comments: {
      lineComment: "%"
    },
    brackets: [
      ["{", "}"],
      ["[", "]"],
      ["(", ")"]
    ],
    autoClosingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "(", close: ")" },
      { open: "\"", close: "\"" }
    ],
    surroundingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "(", close: ")" },
      { open: "\"", close: "\"" }
    ],
    indentationRules: {
      increaseIndentPattern: /^((?!\\end\{).)*\\begin\{[^}]+\}.*$/,
      decreaseIndentPattern: /^\s*\\end\{[^}]+\}.*$/
    }
  });

  monaco.languages.setMonarchTokensProvider(DOCTORAL_LATEX_LANGUAGE, {
    tokenizer: {
      root: [
        [/%.*$/, "comment"],
        [/\\(begin|end)(?=\{)/, "keyword"],
        [/\{(itemize|enumerate|align\*?|aligned\*?|equation\*?)\}/, "type.identifier"],
        [/\\[A-Za-z@]+/, "keyword"],
        [/\$\$[^$]*\$\$/, "string"],
        [/\$[^$]*\$/, "string"],
        [/[{}\[\]()]/, "delimiter"],
        [/[-+*/=<>]+/, "operator"],
        [/\d+(?:\.\d+)?/, "number"],
        [/[A-Za-z_][A-Za-z0-9_:.-]*/, "identifier"]
      ]
    }
  });

  monaco.languages.register({ id: DOCTORAL_BIBTEX_LANGUAGE });
  monaco.languages.setLanguageConfiguration(DOCTORAL_BIBTEX_LANGUAGE, {
    comments: {
      lineComment: "%"
    },
    brackets: [["{", "}"]],
    autoClosingPairs: [
      { open: "{", close: "}" },
      { open: "\"", close: "\"" }
    ],
    surroundingPairs: [
      { open: "{", close: "}" },
      { open: "\"", close: "\"" }
    ],
    indentationRules: {
      increaseIndentPattern: /^\s*@[A-Za-z]+\s*\{[^,]*,?\s*$/,
      decreaseIndentPattern: /^\s*\}\s*,?\s*$/
    }
  });

  monaco.languages.setMonarchTokensProvider(DOCTORAL_BIBTEX_LANGUAGE, {
    tokenizer: {
      root: [
        [/%.*$/, "comment"],
        [/(@)([A-Za-z]+)/, ["keyword", "type.identifier"]],
        [/[{}(),=]/, "delimiter"],
        [/"(?:\\.|[^"])*"/, "string"],
        [/\b\d{4}\b/, "number"],
        [/[A-Za-z_][A-Za-z0-9_:-]*(?=\s*=)/, "attribute.name"],
        [/[A-Za-z_][A-Za-z0-9_:-]*/, "identifier"]
      ]
    }
  });

  monaco.editor.defineTheme(DOCTORAL_MONACO_THEME, {
    base: "vs",
    inherit: true,
    rules: [
      { token: "comment", foreground: "5B6980" },
      { token: "keyword", foreground: "1F4F8F", fontStyle: "bold" },
      { token: "type.identifier", foreground: "2B7A68", fontStyle: "bold" },
      { token: "attribute.name", foreground: "30527F" },
      { token: "string", foreground: "A06A2B" },
      { token: "number", foreground: "B3453F" },
      { token: "operator", foreground: "1C3D69" },
      { token: "delimiter", foreground: "4A5D7B" },
      { token: "identifier", foreground: "172133" }
    ],
    colors: {
      "editor.background": "#FFFFFF",
      "editor.foreground": "#172133",
      "editorLineNumber.foreground": "#8C9AB0",
      "editorLineNumber.activeForeground": "#5B6980",
      "editorGutter.background": "#FFFFFF",
      "editor.selectionBackground": "#DCE9FB",
      "editor.inactiveSelectionBackground": "#EAF2FF",
      "editor.selectionHighlightBackground": "#EAF2FF",
      "editorCursor.foreground": "#1F4F8F",
      "editorIndentGuide.background1": "#E3EAF5",
      "editorIndentGuide.activeBackground1": "#B8C7DE"
    }
  });

  monacoConfigured = true;
}

export type WikiMarkdownAction =
  | "heading1"
  | "heading2"
  | "heading3"
  | "bold"
  | "italic"
  | "link"
  | "inlineCode"
  | "codeBlock"
  | "quote"
  | "bullets"
  | "numbered"
  | "checklist"
  | "horizontalRule"
  | "indent"
  | "outdent";

export type WikiMarkdownTool = {
  action: WikiMarkdownAction;
  label: string;
  title: string;
};

export function WikiMarkdownToolbar({
  onAction,
  toolGroups
}: {
  onAction: (action: WikiMarkdownAction) => void;
  toolGroups: readonly (readonly WikiMarkdownTool[])[];
}): JSX.Element {
  return (
    <div className="wiki-markdown-toolbar" role="toolbar" aria-label="Markdown formatting toolbar">
      {toolGroups.map((group, groupIndex) => (
        <div className="wiki-markdown-toolbar-group" key={`wiki-markdown-group-${groupIndex}`}>
          {group.map((tool) => (
            <button
              key={tool.action}
              type="button"
              className="wiki-markdown-tool"
              title={tool.title}
              aria-label={tool.title}
              onClick={() => onAction(tool.action)}
            >
              {tool.label}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

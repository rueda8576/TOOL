export type LatexTreeEntry = { path: string; isDirectory: boolean };
export type LatexTreeNode = { name: string; path: string; isDirectory: boolean; children: LatexTreeNode[] };

export const SPLITTER_SIZE_PX = 20;
export const MIN_DOCUMENT_PANE_WIDTH_PX = 380;
export const SPLITTER_KEYBOARD_STEP_PX = 24;
export const DOCUMENT_SPLIT_MIN_VIEWPORT_PX = 768;

export function clampLeftPaneWidth(nextWidth: number, containerWidth: number, fixedColumnsWidth: number): number {
  const availableWidth = containerWidth - fixedColumnsWidth;
  if (availableWidth <= MIN_DOCUMENT_PANE_WIDTH_PX * 2) {
    return Math.max(0, Math.round(availableWidth / 2));
  }

  const maxLeftWidth = availableWidth - MIN_DOCUMENT_PANE_WIDTH_PX;
  return Math.min(Math.max(nextWidth, MIN_DOCUMENT_PANE_WIDTH_PX), maxLeftWidth);
}

export function getResizableWorkspaceMetrics(workspace: HTMLElement | null): { containerWidth: number; fixedColumnsWidth: number } | null {
  if (!workspace) {
    return null;
  }

  const containerWidth = workspace.clientWidth;
  if (containerWidth <= 0) {
    return null;
  }

  const computed = window.getComputedStyle(workspace);
  const columnGap = Number.parseFloat(computed.columnGap || computed.gap || "0");
  const resolvedGap = Number.isFinite(columnGap) ? columnGap : 0;
  const fixedColumnsWidth = SPLITTER_SIZE_PX + resolvedGap * 2;
  return { containerWidth, fixedColumnsWidth };
}

export function sanitizePdfFilename(title?: string): string {
  const normalized = (title ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `${normalized.length > 0 ? normalized : "document"}-latest.pdf`;
}

export function normalizeWordToken(rawValue: string): string {
  return rawValue.trim().replace(/^[^A-Za-z0-9_]+|[^A-Za-z0-9_]+$/g, "");
}

export function inferLatexEntryFile(latexPaths: string[]): string | undefined {
  if (latexPaths.length === 0) {
    return undefined;
  }

  const mainTexAtRoot = latexPaths.find((path) => path.toLowerCase() === "main.tex");
  if (mainTexAtRoot) {
    return mainTexAtRoot;
  }

  const mainTexNested = latexPaths.find((path) => path.toLowerCase().endsWith("/main.tex"));
  if (mainTexNested) {
    return mainTexNested;
  }

  return latexPaths.find((path) => path.toLowerCase().endsWith(".tex")) ?? undefined;
}

export function buildLatexTree(entries: LatexTreeEntry[]): LatexTreeNode[] {
  const root: LatexTreeNode = { name: "", path: "", isDirectory: true, children: [] };
  const nodesByPath = new Map<string, LatexTreeNode>([["", root]]);

  const ensureDirectory = (directoryPath: string): LatexTreeNode => {
    if (!directoryPath) {
      return root;
    }

    const existing = nodesByPath.get(directoryPath);
    if (existing) {
      return existing;
    }

    const segments = directoryPath.split("/").filter(Boolean);
    const parentPath = segments.slice(0, -1).join("/");
    const parent = ensureDirectory(parentPath);
    const created: LatexTreeNode = {
      name: segments[segments.length - 1] ?? directoryPath,
      path: directoryPath,
      isDirectory: true,
      children: []
    };
    parent.children.push(created);
    nodesByPath.set(directoryPath, created);
    return created;
  };

  for (const entry of entries) {
    const normalizedPath = entry.path.split("/").filter(Boolean).join("/");
    if (!normalizedPath) {
      continue;
    }

    const segments = normalizedPath.split("/");
    const parentPath = segments.slice(0, -1).join("/");
    const parent = ensureDirectory(parentPath);
    const current = nodesByPath.get(normalizedPath);

    if (current) {
      current.isDirectory = current.isDirectory || entry.isDirectory;
      continue;
    }

    const node: LatexTreeNode = {
      name: segments[segments.length - 1] ?? normalizedPath,
      path: normalizedPath,
      isDirectory: entry.isDirectory,
      children: []
    };
    parent.children.push(node);
    nodesByPath.set(normalizedPath, node);

    if (entry.isDirectory) {
      ensureDirectory(normalizedPath);
    }
  }

  const sortNodes = (nodes: LatexTreeNode[]): LatexTreeNode[] =>
    [...nodes]
      .sort((left, right) => {
        if (left.isDirectory !== right.isDirectory) {
          return left.isDirectory ? -1 : 1;
        }
        return left.name.localeCompare(right.name);
      })
      .map((node) =>
        node.isDirectory
          ? {
              ...node,
              children: sortNodes(node.children)
            }
          : node
      );

  return sortNodes(root.children);
}

export function collectDirectoryPaths(entries: LatexTreeEntry[]): string[] {
  const paths = new Set<string>();
  for (const entry of entries) {
    const segments = entry.path.split("/").filter(Boolean);
    if (entry.isDirectory && segments.length > 0) {
      paths.add(segments.join("/"));
    }
    for (let depth = 1; depth < segments.length; depth += 1) {
      paths.add(segments.slice(0, depth).join("/"));
    }
  }

  return [...paths].sort((left, right) => left.length - right.length || left.localeCompare(right));
}

export function terminalCompileStatus(status: string): boolean {
  return status === "succeeded" || status === "failed" || status === "timeout";
}

export function compileStatusLabel(status: string): string {
  switch (status) {
    case "running":
      return "Compiling";
    case "succeeded":
      return "Compiled";
    case "failed":
      return "Compile failed";
    case "timeout":
      return "Compile timeout";
    case "pending":
    default:
      return "Pending compile";
  }
}

export function wait(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, milliseconds);
  });
}

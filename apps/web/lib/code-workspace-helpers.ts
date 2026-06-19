import type { RepositoryRemovalBindingCounts } from "./gitlab";

export type CodeBreadcrumbSegment = {
  label: string;
  path: string;
};

const FILE_EXTENSION_BADGES: Record<string, string> = {
  tex: "TEX",
  bib: "BIB",
  pdf: "PDF",
  md: "MD",
  txt: "TXT",
  ts: "TS",
  tsx: "TSX",
  js: "JS",
  jsx: "JSX",
  py: "PY",
  sh: "SH",
  rb: "RB",
  json: "JSON",
  yml: "YML",
  yaml: "YML",
  toml: "TOML",
  css: "CSS",
  html: "HTML",
  svg: "SVG",
  png: "IMG",
  jpg: "IMG",
  jpeg: "IMG",
  gif: "IMG",
  csv: "CSV",
  xml: "XML"
};

export function relativeDate(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function authorInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join("");
}

export function fileExtBadge(filename: string): string {
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  return FILE_EXTENSION_BADGES[extension] ?? (extension.toUpperCase().slice(0, 4) || "FILE");
}

export function formatBytes(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }

  const units = ["KB", "MB", "GB"];
  let value = size / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

export function repositoryPathPreview(name: string, path: string): string {
  const raw = path.trim() || name.trim();
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function repositoryRemovalBindingItems(counts: RepositoryRemovalBindingCounts): string[] {
  const items: string[] = [];
  if (counts.active > 0) items.push(`${counts.active} active`);
  if (counts.deleted > 0) items.push(`${counts.deleted} deleted`);
  if (counts.conflict > 0) items.push(`${counts.conflict} conflict`);
  if (counts.error > 0) items.push(`${counts.error} error`);
  if (counts.unassigned > 0) items.push(`${counts.unassigned} unassigned`);
  return items;
}

export function buildCodeBreadcrumbSegments(browserPath: string): CodeBreadcrumbSegment[] {
  return browserPath
    ? browserPath.split("/").filter(Boolean).map((segment, index, segments) => ({
        label: segment,
        path: segments.slice(0, index + 1).join("/")
      }))
    : [];
}

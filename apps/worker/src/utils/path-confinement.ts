import { resolve, sep } from "path";

export function resolveContainedPath(rootPath: string, relativePath: string, message = "Invalid path"): string {
  const normalized = relativePath.replace(/\\/g, "/");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").some((segment) => segment === "..")) {
    throw new Error(message);
  }

  const root = resolve(rootPath);
  const absolute = resolve(root, normalized);
  const rootPrefix = root.endsWith(sep) ? root : `${root}${sep}`;
  if (absolute !== root && !absolute.startsWith(rootPrefix)) {
    throw new Error(message);
  }

  return absolute;
}

export function normalizeContainedRelativePath(value: string, message = "Invalid path"): string {
  const normalized = value.replace(/\\/g, "/").replace(/^\/+/, "");
  resolveContainedPath("/", normalized, message);
  return normalized;
}

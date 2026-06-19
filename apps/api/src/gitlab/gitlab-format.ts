export const GITLAB_DOCS_ROOT = "Docs";

export function buildRepositoryArchiveFileName(pathWithNamespace: string, ref: string): string {
  const pathFragment = pathWithNamespace
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .replace(/[^a-zA-Z0-9._/-]+/g, "-")
    .replace(/\//g, "-");
  const refFragment = ref
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${pathFragment || "repository"}-${refFragment || "archive"}.zip`;
}

export function buildRepositoryRawFileName(filePath: string): string {
  const fileName = filePath.split("/").pop()?.trim() || "repository-file";
  return fileName.replace(/[\r\n"]/g, "-");
}

export function detectRepositoryFileContentType(filePath: string): string | null {
  const extension = filePath.split(".").pop()?.toLowerCase();
  switch (extension) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "avif":
      return "image/avif";
    case "bmp":
      return "image/bmp";
    case "ico":
      return "image/x-icon";
    default:
      return null;
  }
}

export function isBinaryBuffer(buffer: Buffer): boolean {
  if (buffer.length === 0) {
    return false;
  }

  const sample = buffer.subarray(0, Math.min(buffer.length, 2048));
  let suspicious = 0;
  for (const byte of sample) {
    if (byte === 0) {
      return true;
    }
    if ((byte < 7 || (byte > 13 && byte < 32)) && byte !== 9 && byte !== 10 && byte !== 13) {
      suspicious += 1;
    }
  }

  return suspicious / sample.length > 0.15;
}

export function isDocsMarkdownPath(path: string, docsRoot = GITLAB_DOCS_ROOT): boolean {
  const normalized = path.replace(/\\/g, "/");
  return normalized.startsWith(`${docsRoot}/`) && /\.(md|markdown)$/i.test(normalized);
}

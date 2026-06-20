import AdmZip from "adm-zip";
import { mkdir, writeFile } from "fs/promises";
import { dirname } from "path";

import { resolveContainedPath } from "./path-confinement";

const MAX_ZIP_ENTRIES = 2_000;
const MAX_ZIP_TOTAL_BYTES = 250 * 1024 * 1024;
const MAX_ZIP_DEPTH = 24;
const MAX_ZIP_PATH_LENGTH = 240;

export async function extractZipSafely(zip: AdmZip, targetRoot: string): Promise<void> {
  const entries = zip.getEntries();
  if (entries.length > MAX_ZIP_ENTRIES) {
    throw new Error("ZIP archive contains too many files");
  }

  const seenPaths = new Set<string>();
  let totalBytes = 0;

  for (const entry of entries) {
    const rawEntryName = entry.entryName.replace(/\\/g, "/");
    if (
      rawEntryName.startsWith("/") ||
      /^[a-zA-Z]:\//.test(rawEntryName) ||
      rawEntryName.split("/").some((segment) => segment === "..")
    ) {
      throw new Error("Invalid ZIP entry path");
    }

    const entryName = rawEntryName.replace(/^\/+/, "");
    if (!entryName || entryName.length > MAX_ZIP_PATH_LENGTH) {
      throw new Error("Invalid ZIP entry path");
    }
    if (entryName.split("/").length > MAX_ZIP_DEPTH) {
      throw new Error("ZIP entry path is too deep");
    }
    const fileMode = entry.header.attr >>> 16;
    if ((fileMode & 0o170000) === 0o120000) {
      throw new Error("ZIP archive contains unsupported symlinks");
    }

    const absolutePath = resolveContainedPath(targetRoot, entryName, "Invalid ZIP entry path");
    const duplicateKey = entryName.toLowerCase();
    if (seenPaths.has(duplicateKey)) {
      throw new Error(`Duplicate ZIP entry path: ${entryName}`);
    }
    seenPaths.add(duplicateKey);

    if (entry.isDirectory) {
      await mkdir(absolutePath, { recursive: true });
      continue;
    }

    totalBytes += entry.header.size;
    if (totalBytes > MAX_ZIP_TOTAL_BYTES) {
      throw new Error("ZIP archive is too large");
    }

    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, entry.getData());
  }
}

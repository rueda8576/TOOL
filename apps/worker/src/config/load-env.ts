import { existsSync, readdirSync } from "fs";
import { dirname, isAbsolute, resolve } from "path";

import { config } from "dotenv";

const envCandidates = [
  resolve(process.cwd(), ".env"),
  resolve(process.cwd(), "../../.env"),
  resolve(__dirname, "../../../../.env")
];

const pickStorageRoot = (baseDir: string, rawStorageRoot: string): string => {
  const canonical = resolve(baseDir, rawStorageRoot);
  const candidates = [
    canonical,
    resolve(baseDir, "apps/api", rawStorageRoot),
    resolve(baseDir, "apps/worker", rawStorageRoot)
  ];

  const existingWithFiles = candidates.find((candidate) => {
    if (!existsSync(candidate)) {
      return false;
    }

    try {
      return readdirSync(candidate).length > 0;
    } catch {
      return false;
    }
  });

  if (existingWithFiles) {
    return existingWithFiles;
  }

  const existing = candidates.find((candidate) => existsSync(candidate));
  return existing ?? canonical;
};

for (const envPath of envCandidates) {
  if (!existsSync(envPath)) {
    continue;
  }

  config({ path: envPath, override: false });

  const storageRoot = process.env.STORAGE_ROOT;
  if (storageRoot && !isAbsolute(storageRoot)) {
    process.env.STORAGE_ROOT = pickStorageRoot(dirname(envPath), storageRoot);
  }
  break;
}

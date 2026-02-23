import { mkdir } from "fs/promises";
import { join } from "path";

import { getEnv } from "../config/env";

export const getStoragePath = (...segments: string[]): string => join(getEnv().STORAGE_ROOT, ...segments);

export const ensureStorageSubdir = async (subdir: string): Promise<string> => {
  const target = getStoragePath(subdir);
  await mkdir(target, { recursive: true });
  return target;
};

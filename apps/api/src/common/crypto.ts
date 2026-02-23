import { createHash, randomBytes } from "crypto";

export const hashValue = (value: string): string => createHash("sha256").update(value).digest("hex");

export const generateSecureToken = (size = 32): string => randomBytes(size).toString("hex");

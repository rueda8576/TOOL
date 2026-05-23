import { BadRequestException } from "@nestjs/common";

const USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,30}[a-z0-9])?$/;

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

export function validateAtlasiumUsername(value: string): string {
  const username = normalizeUsername(value);
  if (!USERNAME_PATTERN.test(username)) {
    throw new BadRequestException(
      "Username must be 2-32 lowercase letters, numbers, dots, underscores, or hyphens, and start and end with a letter or number"
    );
  }

  return username;
}

export function deriveUsernameFromEmail(email: string): string {
  const localPart = email.split("@")[0] || "user";
  const normalized = localPart
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "")
    .slice(0, 32)
    .replace(/[^a-z0-9]+$/g, "");

  return validateAtlasiumUsername(normalized.length >= 2 ? normalized : "user");
}

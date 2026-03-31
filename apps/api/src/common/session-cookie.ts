import { getEnv } from "../config/env";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function buildSessionCookie(token: string, expiresAt?: Date): string {
  const env = getEnv();
  const cookieName = env.ATLASIUM_SESSION_COOKIE_NAME;
  const resolvedExpiry = expiresAt ?? new Date(Date.now() + WEEK_MS);
  const secure = env.NODE_ENV === "production" ? "; Secure" : "";

  return `${cookieName}=${encodeURIComponent(token)}; Path=/; Expires=${resolvedExpiry.toUTCString()}; HttpOnly; SameSite=Lax${secure}`;
}

export function clearSessionCookie(): string {
  const env = getEnv();
  const cookieName = env.ATLASIUM_SESSION_COOKIE_NAME;
  const secure = env.NODE_ENV === "production" ? "; Secure" : "";

  return `${cookieName}=; Path=/; Expires=${new Date(0).toUTCString()}; HttpOnly; SameSite=Lax${secure}`;
}

export function readCookieValue(cookieHeader: string | undefined, cookieName: string): string | null {
  if (!cookieHeader) {
    return null;
  }

  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName === cookieName) {
      return decodeURIComponent(rawValue.join("="));
    }
  }

  return null;
}

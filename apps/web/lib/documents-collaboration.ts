import { LoginResponse } from "./client-api";

export type CollaboratorIdentity = {
  id: string;
  name: string;
  initials: string;
  color: string;
};

export type CollaboratorPresence = CollaboratorIdentity & {
  clientId: number;
  isSelf: boolean;
  activePath: string | null;
};

function extractInitials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  if (parts.length === 0) {
    return "?";
  }

  const initials = parts
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 2);

  return initials || "?";
}

function stableColorFromSeed(seed: string): string {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash << 5) - hash + seed.charCodeAt(index);
    hash |= 0;
  }

  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 72% 42%)`;
}

export function buildCollaboratorIdentity(user: LoginResponse["user"] | null): CollaboratorIdentity | null {
  if (!user) {
    return null;
  }

  return {
    id: user.id,
    name: user.name,
    initials: extractInitials(user.name),
    color: stableColorFromSeed(user.id)
  };
}

export function resolveCollaborationServerUrl(apiBaseUrl: string): string {
  const normalizedBaseUrl = apiBaseUrl.trim();
  const browserOrigin = typeof window !== "undefined" ? window.location.origin : null;
  const isAbsolute = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(normalizedBaseUrl);

  if (!isAbsolute && !browserOrigin) {
    throw new Error("Relative API base URL requires browser origin");
  }

  const parsed = isAbsolute
    ? new URL(normalizedBaseUrl)
    : new URL(normalizedBaseUrl || "/", browserOrigin as string);

  parsed.protocol = parsed.protocol === "https:" || parsed.protocol === "wss:" ? "wss:" : "ws:";
  parsed.search = "";
  parsed.hash = "";

  const normalizedPath = parsed.pathname.replace(/\/+$/, "");
  parsed.pathname = normalizedPath ? `${normalizedPath}/collab` : "/collab";
  return parsed.toString();
}

function extractCollaboratorIdentity(value: unknown): CollaboratorIdentity | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as {
    id?: unknown;
    name?: unknown;
    initials?: unknown;
    color?: unknown;
  };

  if (typeof candidate.id !== "string" || typeof candidate.name !== "string") {
    return null;
  }

  return {
    id: candidate.id,
    name: candidate.name,
    initials: typeof candidate.initials === "string" ? candidate.initials : extractInitials(candidate.name),
    color: typeof candidate.color === "string" ? candidate.color : stableColorFromSeed(candidate.id)
  };
}

export function listCollaboratorsFromAwareness(
  states: Map<number, Record<string, unknown>>,
  selfUserId: string | null
): CollaboratorPresence[] {
  const collaborators: CollaboratorPresence[] = [];

  for (const [clientId, state] of states.entries()) {
    const identity = extractCollaboratorIdentity(state.user);
    if (!identity) {
      continue;
    }

    collaborators.push({
      ...identity,
      clientId,
      isSelf: Boolean(selfUserId && identity.id === selfUserId),
      activePath: typeof state.activePath === "string" ? state.activePath : null
    });
  }

  return collaborators.sort((left, right) => {
    if (left.isSelf !== right.isSelf) {
      return left.isSelf ? -1 : 1;
    }

    return left.name.localeCompare(right.name);
  });
}

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

type RgbColor = { red: number; green: number; blue: number };

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

function clampColorChannel(value: number): number {
  return Math.min(Math.max(Math.round(value), 0), 255);
}

function parseHexColor(color: string): RgbColor | null {
  const hex = color.trim().replace(/^#/, "");
  if (!/^[\da-f]{6}$/i.test(hex)) {
    return null;
  }

  return {
    red: Number.parseInt(hex.slice(0, 2), 16),
    green: Number.parseInt(hex.slice(2, 4), 16),
    blue: Number.parseInt(hex.slice(4, 6), 16)
  };
}

function parseRgbColor(color: string): RgbColor | null {
  const match = color.match(/^rgba?\((.+)\)$/i);
  if (!match) {
    return null;
  }

  const channels = match[1]
    .split(/[,\s/]+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((channel) => Number.parseFloat(channel));

  if (channels.length !== 3 || channels.some((channel) => !Number.isFinite(channel))) {
    return null;
  }

  return {
    red: clampColorChannel(channels[0]),
    green: clampColorChannel(channels[1]),
    blue: clampColorChannel(channels[2])
  };
}

function hslToRgb(hue: number, saturation: number, lightness: number): RgbColor {
  const normalizedHue = ((((hue % 360) + 360) % 360) / 360);
  const normalizedSaturation = Math.min(Math.max(saturation / 100, 0), 1);
  const normalizedLightness = Math.min(Math.max(lightness / 100, 0), 1);

  if (normalizedSaturation === 0) {
    const channel = clampColorChannel(normalizedLightness * 255);
    return { red: channel, green: channel, blue: channel };
  }

  const q =
    normalizedLightness < 0.5
      ? normalizedLightness * (1 + normalizedSaturation)
      : normalizedLightness + normalizedSaturation - normalizedLightness * normalizedSaturation;
  const p = 2 * normalizedLightness - q;
  const channel = (offset: number): number => {
    let t = normalizedHue + offset;
    if (t < 0) {
      t += 1;
    }
    if (t > 1) {
      t -= 1;
    }
    if (t < 1 / 6) {
      return p + (q - p) * 6 * t;
    }
    if (t < 1 / 2) {
      return q;
    }
    if (t < 2 / 3) {
      return p + (q - p) * (2 / 3 - t) * 6;
    }
    return p;
  };

  return {
    red: clampColorChannel(channel(1 / 3) * 255),
    green: clampColorChannel(channel(0) * 255),
    blue: clampColorChannel(channel(-1 / 3) * 255)
  };
}

function parseHslColor(color: string): RgbColor | null {
  const match = color.match(/^hsla?\(\s*([+-]?\d+(?:\.\d+)?)(?:deg)?[\s,]+(\d+(?:\.\d+)?)%[\s,]+(\d+(?:\.\d+)?)%/i);
  if (!match) {
    return null;
  }

  const hue = Number.parseFloat(match[1]);
  const saturation = Number.parseFloat(match[2]);
  const lightness = Number.parseFloat(match[3]);
  if (![hue, saturation, lightness].every((value) => Number.isFinite(value))) {
    return null;
  }

  return hslToRgb(hue, saturation, lightness);
}

function parseCssColor(color: string): RgbColor | null {
  const normalizedColor = color.trim();
  return parseHexColor(normalizedColor) ?? parseRgbColor(normalizedColor) ?? parseHslColor(normalizedColor);
}

function relativeLuminance(color: RgbColor): number {
  const channel = (value: number): number => {
    const normalized = value / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };

  return 0.2126 * channel(color.red) + 0.7152 * channel(color.green) + 0.0722 * channel(color.blue);
}

function contrastRatio(left: number, right: number): number {
  const lighter = Math.max(left, right);
  const darker = Math.min(left, right);
  return (lighter + 0.05) / (darker + 0.05);
}

export function getCollaboratorTextColor(backgroundColor: string): string {
  const parsedBackground = parseCssColor(backgroundColor);
  if (!parsedBackground) {
    return "#111515";
  }

  const backgroundLuminance = relativeLuminance(parsedBackground);
  const lightContrast = contrastRatio(backgroundLuminance, 1);
  const darkContrast = contrastRatio(backgroundLuminance, relativeLuminance({ red: 17, green: 21, blue: 21 }));
  return lightContrast >= darkContrast ? "#ffffff" : "#111515";
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

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

function buildAuthRequestInit(token: string, init?: RequestInit): RequestInit {
  const hasFormDataBody = typeof FormData !== "undefined" && init?.body instanceof FormData;
  const headers = new Headers(init?.headers ?? undefined);

  headers.set("Authorization", `Bearer ${token}`);
  if (!hasFormDataBody && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  return {
    ...(init ?? {}),
    headers
  };
}

function collectErrorMessages(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectErrorMessages(entry));
  }

  if (value && typeof value === "object") {
    return Object.values(value).flatMap((entry) => collectErrorMessages(entry));
  }

  return [];
}

async function readErrorMessage(response: Response): Promise<string> {
  const text = await response.text();
  if (!text.trim()) {
    return `Request failed with status ${response.status}`;
  }

  try {
    const parsed = JSON.parse(text) as {
      message?: unknown;
      error?: unknown;
    };
    const messageParts = collectErrorMessages(parsed.message);
    if (messageParts.length > 0) {
      return messageParts.join(". ");
    }

    const errorParts = collectErrorMessages(parsed.error);
    if (errorParts.length > 0) {
      return errorParts.join(". ");
    }
  } catch {
    // Fall through to the original text when the response is not JSON.
  }

  return text;
}

export async function authFetch<T>(
  path: string,
  params: {
    token: string;
    init?: RequestInit;
  }
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, buildAuthRequestInit(params.token, params.init));

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return response.json() as Promise<T>;
}

export async function authFetchResponse(
  path: string,
  params: {
    token: string;
    init?: RequestInit;
  }
): Promise<Response> {
  const response = await fetch(`${API_BASE_URL}${path}`, buildAuthRequestInit(params.token, params.init));

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return response;
}

export type LoginResponse = {
  token: string;
  expiresAt: string;
  user: {
    id: string;
    email: string;
    name: string;
    globalRole: "admin" | "editor" | "reader";
  };
};

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

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
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...(params.init ?? {}),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.token}`,
      ...(params.init?.headers ?? {})
    }
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return response.json() as Promise<T>;
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

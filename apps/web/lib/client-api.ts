export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

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
    throw new Error(await response.text());
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

export type GitlabBinaryRequestOptions = {
  authMode?: "header" | "query";
};

export type GitlabBinaryResponse = {
  buffer: Buffer;
  contentType: string | null;
};

export class GitlabApiError extends Error {
  constructor(
    readonly status: number,
    readonly responseBody: string,
    message?: string,
    readonly metadata?: {
      contentType: string | null;
      requestId: string | null;
      gitlabMeta: string | null;
      path: string;
    }
  ) {
    super(message ?? responseBody ?? `GitLab API error (${status})`);
  }
}

export async function executeGitlabJsonRequest<T>(params: {
  apiBaseUrl: string;
  accessToken: string;
  path: string;
  init?: RequestInit;
}): Promise<T> {
  const response = await fetch(`${params.apiBaseUrl}/api/v4${params.path}`, {
    ...params.init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${params.accessToken}`,
      ...(params.init?.body ? { "Content-Type": "application/json" } : {}),
      ...(params.init?.headers ?? {})
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new GitlabApiError(response.status, text, text || `GitLab API error (${response.status})`);
  }

  const text = await response.text();
  if (!text) {
    return undefined as T;
  }

  return JSON.parse(text) as T;
}

export async function executeGitlabBinaryRequest(params: {
  apiBaseUrl: string;
  accessToken: string;
  path: string;
  init?: RequestInit;
  options?: GitlabBinaryRequestOptions;
}): Promise<GitlabBinaryResponse> {
  const url = new URL(`${params.apiBaseUrl}/api/v4${params.path}`);
  const authMode = params.options?.authMode ?? "header";
  if (authMode === "query") {
    url.searchParams.set("access_token", params.accessToken);
  }

  const response = await fetch(url.toString(), {
    ...params.init,
    headers: {
      Accept: "application/octet-stream",
      ...(authMode === "header" ? { Authorization: `Bearer ${params.accessToken}` } : {}),
      ...(params.init?.headers ?? {})
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new GitlabApiError(response.status, text, text || `GitLab API error (${response.status})`, {
      contentType: response.headers?.get("content-type") ?? null,
      requestId: response.headers?.get("x-request-id") ?? null,
      gitlabMeta: response.headers?.get("x-gitlab-meta") ?? null,
      path: params.path
    });
  }

  const arrayBuffer = await response.arrayBuffer();
  return {
    buffer: Buffer.from(arrayBuffer),
    contentType: response.headers.get("content-type")
  };
}

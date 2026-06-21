import {
  executeGitlabBinaryRequest,
  executeGitlabJsonRequest,
  GitlabApiError
} from "./gitlab-client";

type FetchResponse = {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  arrayBuffer: () => Promise<ArrayBuffer>;
  headers: {
    get: (name: string) => string | null;
  };
};

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function response(params: {
  status?: number;
  body?: string;
  buffer?: Uint8Array;
  headers?: Record<string, string>;
}): FetchResponse {
  const status = params.status ?? 200;
  const headers = params.headers ?? {};
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => params.body ?? "",
    arrayBuffer: async () => toArrayBuffer(params.buffer ?? new TextEncoder().encode(params.body ?? "")),
    headers: {
      get: (name: string) => headers[name.toLowerCase()] ?? headers[name] ?? null
    }
  };
}

describe("gitlab client", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as typeof fetch;
  });

  it("executes JSON requests with bearer auth and JSON content headers", async () => {
    fetchMock.mockResolvedValueOnce(response({ body: JSON.stringify({ ok: true }) }));

    await expect(executeGitlabJsonRequest<{ ok: boolean }>({
      apiBaseUrl: "https://git.atlasium.info",
      accessToken: "token",
      path: "/projects",
      init: {
        method: "POST",
        body: JSON.stringify({ name: "Navigation" })
      }
    })).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledWith("https://git.atlasium.info/api/v4/projects", {
      method: "POST",
      body: JSON.stringify({ name: "Navigation" }),
      headers: {
        Accept: "application/json",
        Authorization: "Bearer token",
        "Content-Type": "application/json"
      }
    });
  });

  it("returns undefined for empty successful JSON responses", async () => {
    fetchMock.mockResolvedValueOnce(response({ body: "" }));

    await expect(executeGitlabJsonRequest<void>({
      apiBaseUrl: "https://git.atlasium.info",
      accessToken: "token",
      path: "/projects/1/archive"
    })).resolves.toBeUndefined();
  });

  it("throws GitlabApiError for JSON failures", async () => {
    fetchMock.mockResolvedValueOnce(response({ status: 403, body: "forbidden" }));

    await expect(executeGitlabJsonRequest({
      apiBaseUrl: "https://git.atlasium.info",
      accessToken: "token",
      path: "/projects/1"
    })).rejects.toMatchObject({
      status: 403,
      responseBody: "forbidden",
      message: "forbidden"
    });
  });

  it("executes binary requests with query-token auth and preserves error metadata", async () => {
    fetchMock
      .mockResolvedValueOnce(response({
        buffer: Uint8Array.from([1, 2, 3]),
        headers: { "content-type": "application/zip" }
      }))
      .mockResolvedValueOnce(response({
        status: 406,
        body: "not acceptable",
        headers: {
          "content-type": "text/plain",
          "x-request-id": "request-1",
          "x-gitlab-meta": "meta-1"
        }
      }));

    await expect(executeGitlabBinaryRequest({
      apiBaseUrl: "https://git.atlasium.info",
      accessToken: "token",
      path: "/projects/1/repository/archive.zip",
      options: { authMode: "query" }
    })).resolves.toMatchObject({
      buffer: Buffer.from([1, 2, 3]),
      contentType: "application/zip"
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://git.atlasium.info/api/v4/projects/1/repository/archive.zip?access_token=token"
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: {
        Accept: "application/octet-stream"
      }
    });

    let error: unknown;
    try {
      await executeGitlabBinaryRequest({
        apiBaseUrl: "https://git.atlasium.info",
        accessToken: "token",
        path: "/projects/1/repository/archive.zip"
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(GitlabApiError);
    expect(error).toMatchObject({
      status: 406,
      responseBody: "not acceptable",
      metadata: {
        contentType: "text/plain",
        requestId: "request-1",
        gitlabMeta: "meta-1",
        path: "/projects/1/repository/archive.zip"
      }
    });
  });
});

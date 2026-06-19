import { EventEmitter } from "events";
import { mkdtemp, mkdir, readFile, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import { CompileStatus, ProjectRole } from "@prisma/client";
import { UnauthorizedException } from "@nestjs/common";
import * as encoding from "lib0/encoding";
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import { WebSocket } from "ws";

describe("DocumentsCollaborationServer", () => {
  const createdServers: any[] = [];

  const loadServer = async (storageRoot: string, envOverrides: Record<string, string> = {}) => {
    jest.resetModules();
    process.env.STORAGE_ROOT = storageRoot;
    process.env.JWT_SECRET = "integration-secret-123";
    process.env.APP_BASE_URL = envOverrides.APP_BASE_URL ?? "https://atlasium.example";
    process.env.COLLAB_ALLOW_QUERY_TOKEN = envOverrides.COLLAB_ALLOW_QUERY_TOKEN ?? "true";
    process.env.ATLASIUM_SESSION_COOKIE_NAME = "atlasium_session";
    jest.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      const [message] = args;
      if (typeof message === "string" && message.includes("Yjs was already imported")) {
        return;
      }
      console.warn(...args);
    });
    return import("./documents-collaboration.server");
  };

  const instantiateServer = (
    ServerCtor: new (prisma: any, sessionAuthService: any, accessService: any) => any,
    prisma: any,
    sessionAuthService: any,
    accessService: any
  ) => {
    const server = new ServerCtor(prisma, sessionAuthService, accessService);
    createdServers.push(server);
    return server;
  };

  const makeSocket = (readyState: number = WebSocket.OPEN): any => {
    const socket = Object.create(WebSocket.prototype) as any;
    Object.defineProperty(socket, "readyState", {
      value: readyState,
      writable: true,
      configurable: true
    });
    socket.send = jest.fn((...args: any[]) => {
      const callback =
        typeof args[1] === "function"
          ? args[1]
          : typeof args[2] === "function"
            ? args[2]
            : undefined;
      callback?.();
    });
    socket.close = jest.fn();
    socket.on = jest.fn();
    return socket;
  };

  afterEach(() => {
    for (const server of createdServers.splice(0)) {
      try {
        server.wsServer?.close();
      } catch {}
    }
    jest.useRealTimers();
    jest.clearAllMocks();
    jest.restoreAllMocks();
    jest.resetModules();
  });

  it("registers upgrade handling only for collaboration paths", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "atlasium-collab-start-"));
    const { DocumentsCollaborationServer } = await loadServer(storageRoot);
    const prisma: any = {};
    const sessionAuthService: any = {};
    const accessService: any = {};
    const server = instantiateServer(DocumentsCollaborationServer, prisma, sessionAuthService, accessService);
    const httpServer = new EventEmitter() as any;
    const upgradedSocket = makeSocket();
    const handleUpgrade = jest
      .spyOn((server as any).wsServer, "handleUpgrade")
      .mockImplementation((...args: any[]) => {
        const callback = args[3] as (socket: WebSocket) => void;
        callback(upgradedSocket);
      });
    const emitSpy = jest.spyOn((server as any).wsServer, "emit").mockImplementation(() => false);

    server.start(httpServer);

    httpServer.emit("upgrade", { url: "/health", headers: { host: "localhost" } }, {}, Buffer.alloc(0));
    expect(handleUpgrade).not.toHaveBeenCalled();

    httpServer.emit(
      "upgrade",
      {
        url: "/collab?kind=presence&token=ok&documentId=doc-1",
        headers: { host: "localhost" }
      },
      {},
      Buffer.alloc(0)
    );

    expect(handleUpgrade).toHaveBeenCalled();
    expect(emitSpy).toHaveBeenCalledWith("connection", upgradedSocket, expect.any(Object));
  });

  it("rejects collaboration WebSocket upgrades from untrusted origins", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "atlasium-collab-origin-"));
    const { DocumentsCollaborationServer } = await loadServer(storageRoot, {
      APP_BASE_URL: "https://atlasium.example"
    });
    const server = instantiateServer(DocumentsCollaborationServer, {} as any, {} as any, {} as any);
    const httpServer = new EventEmitter() as any;
    const upgradedSocket = makeSocket();
    const handleUpgrade = jest
      .spyOn((server as any).wsServer, "handleUpgrade")
      .mockImplementation((...args: any[]) => {
        const callback = args[3] as (socket: WebSocket) => void;
        callback(upgradedSocket);
      });
    const emitSpy = jest.spyOn((server as any).wsServer, "emit").mockImplementation(() => false);
    const rejectedSocket = {
      write: jest.fn(),
      destroy: jest.fn()
    };

    server.start(httpServer);

    httpServer.emit(
      "upgrade",
      {
        url: "/collab?kind=presence&token=ok&documentId=doc-1",
        headers: {
          host: "api.atlasium.example",
          origin: "https://evil.example"
        }
      },
      rejectedSocket,
      Buffer.alloc(0)
    );

    expect(handleUpgrade).not.toHaveBeenCalled();
    expect(rejectedSocket.write).toHaveBeenCalledWith(expect.stringContaining("403 Forbidden"));
    expect(rejectedSocket.destroy).toHaveBeenCalled();

    httpServer.emit(
      "upgrade",
      {
        url: "/collab?kind=presence&token=ok&documentId=doc-1",
        headers: {
          host: "api.atlasium.example",
          origin: "https://atlasium.example"
        }
      },
      {},
      Buffer.alloc(0)
    );

    expect(handleUpgrade).toHaveBeenCalledTimes(1);
    expect(emitSpy).toHaveBeenCalledWith("connection", upgradedSocket, expect.any(Object));
  });

  it("rejects handshake when collaboration authentication fails", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "atlasium-collab-auth-"));
    const { DocumentsCollaborationServer } = await loadServer(storageRoot);
    const prisma: any = {};
    const sessionAuthService: any = {
      authenticateToken: jest.fn().mockRejectedValue(new UnauthorizedException("Invalid collaboration token"))
    };
    const accessService: any = {};
    const server = instantiateServer(DocumentsCollaborationServer, prisma, sessionAuthService, accessService);
    const socket = makeSocket(WebSocket.CONNECTING);

    await (server as any).handleConnection(socket, {
      url: "/collab?kind=presence&token=bad&documentId=doc-1",
      headers: { host: "localhost" }
    });

    expect(socket.close).toHaveBeenCalledWith(1008, "Invalid collaboration token");
  });

  it("authenticates collaboration handshakes from the Atlasium session cookie", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "atlasium-collab-cookie-"));
    const { DocumentsCollaborationServer } = await loadServer(storageRoot, { COLLAB_ALLOW_QUERY_TOKEN: "false" });
    const prisma: any = {
      document: {
        findFirst: jest.fn().mockResolvedValue({ id: "doc-1", projectId: "project-1" })
      }
    };
    const sessionAuthService: any = {
      authenticateToken: jest.fn().mockResolvedValue({
        userId: "user-1",
        email: "user@example.com",
        globalRole: "editor"
      })
    };
    const accessService: any = {
      getProjectAccess: jest.fn().mockResolvedValue({ canWrite: true })
    };
    const server = instantiateServer(DocumentsCollaborationServer, prisma, sessionAuthService, accessService);
    const socket = makeSocket(WebSocket.OPEN);

    await (server as any).handleConnection(socket, {
      url: "/collab?kind=presence&documentId=doc-1",
      headers: {
        host: "localhost",
        cookie: "atlasium_session=cookie-token"
      }
    });

    expect(sessionAuthService.authenticateToken).toHaveBeenCalledWith("cookie-token", expect.any(Object));
    expect(socket.close).not.toHaveBeenCalled();
  });

  it("rejects malformed collaboration room queries before authentication", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "atlasium-collab-query-"));
    const { DocumentsCollaborationServer } = await loadServer(storageRoot);
    const sessionAuthService: any = {
      authenticateToken: jest.fn()
    };
    const server = instantiateServer(DocumentsCollaborationServer, {} as any, sessionAuthService, {} as any);

    const missingTokenSocket = makeSocket(WebSocket.CONNECTING);
    await (server as any).handleConnection(missingTokenSocket, {
      url: "/collab?kind=presence&documentId=doc-1",
      headers: { host: "localhost" }
    });
    expect(missingTokenSocket.close).toHaveBeenCalledWith(1008, "Missing collaboration token");

    const missingDocumentSocket = makeSocket(WebSocket.CONNECTING);
    await (server as any).handleConnection(missingDocumentSocket, {
      url: "/collab?kind=presence&token=ok",
      headers: { host: "localhost" }
    });
    expect(missingDocumentSocket.close).toHaveBeenCalledWith(1008, "Missing documentId");

    const unsupportedKindSocket = makeSocket(WebSocket.CONNECTING);
    await (server as any).handleConnection(unsupportedKindSocket, {
      url: "/collab?kind=unknown&token=ok",
      headers: { host: "localhost" }
    });
    expect(unsupportedKindSocket.close).toHaveBeenCalledWith(1008, "Unsupported collaboration room kind");
    expect(sessionAuthService.authenticateToken).not.toHaveBeenCalled();
  });

  it("rejects unknown endpoints and missing file/wiki query params before authentication", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "atlasium-collab-query-extra-"));
    const { DocumentsCollaborationServer } = await loadServer(storageRoot);
    const sessionAuthService: any = {
      authenticateToken: jest.fn()
    };
    const server = instantiateServer(DocumentsCollaborationServer, {} as any, sessionAuthService, {} as any);

    const unknownPathSocket = makeSocket(WebSocket.CONNECTING);
    await (server as any).handleConnection(unknownPathSocket, {
      url: "/unknown?token=ok&kind=presence&documentId=doc-1",
      headers: { host: "localhost" }
    });
    expect(unknownPathSocket.close).toHaveBeenCalledWith(1008, "Unknown collaboration endpoint");

    const missingFilePathSocket = makeSocket(WebSocket.CONNECTING);
    await (server as any).handleConnection(missingFilePathSocket, {
      url: "/collab?kind=file&token=ok&documentVersionId=version-1",
      headers: { host: "localhost" }
    });
    expect(missingFilePathSocket.close).toHaveBeenCalledWith(1008, "Missing documentVersionId or path");

    const missingWikiPageSocket = makeSocket(WebSocket.CONNECTING);
    await (server as any).handleConnection(missingWikiPageSocket, {
      url: "/collab?kind=wiki-page&token=ok",
      headers: { host: "localhost" }
    });
    expect(missingWikiPageSocket.close).toHaveBeenCalledWith(1008, "Missing wikiPageId");
    expect(sessionAuthService.authenticateToken).not.toHaveBeenCalled();
  });

  it("joins a file room, loads initial content, and tracks the connection", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "atlasium-collab-file-"));
    const workspaceRelativePath = "workspaces/version-1";
    const workspaceAbsolutePath = join(storageRoot, workspaceRelativePath);
    await mkdir(workspaceAbsolutePath, { recursive: true });
    await writeFile(join(workspaceAbsolutePath, "main.tex"), "\\section{Intro}", "utf8");

    const { DocumentsCollaborationServer } = await loadServer(storageRoot);
    const prisma: any = {
      documentVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: "version-1",
          latexWorkspacePath: workspaceRelativePath,
          document: {
            projectId: "project-1"
          }
        })
      }
    };
    const sessionAuthService: any = {};
    const accessService: any = {
      getProjectAccess: jest.fn().mockResolvedValue({
        canWrite: true,
        projectRole: ProjectRole.EDITOR,
        isAdmin: false
      })
    };
    const server = instantiateServer(DocumentsCollaborationServer, prisma, sessionAuthService, accessService);
    const socket = makeSocket();

    const result = await (server as any).joinRoom(
      {
        kind: "file",
        token: "ok",
        documentVersionId: "version-1",
        path: "main.tex"
      },
      {
        userId: "user-1",
        email: "user@example.com",
        globalRole: "editor"
      },
      socket
    );

    expect(result.canWrite).toBe(true);
    expect(result.room.kind).toBe("file");
    expect(result.room.doc.getText("content").toString()).toBe("\\section{Intro}");
    expect(result.room.connections.get(socket)).toEqual(new Set());
    expect(result.room.connectionUsers.get(socket)).toBe("user-1");
  });

  it("joins presence and wiki-presence rooms using project access state", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "atlasium-collab-presence-"));
    const { DocumentsCollaborationServer } = await loadServer(storageRoot);
    const prisma: any = {
      document: {
        findFirst: jest.fn().mockResolvedValue({
          id: "document-1",
          projectId: "project-1"
        })
      },
      wikiPage: {
        findFirst: jest.fn().mockResolvedValue({
          id: "page-1",
          projectId: "project-2"
        })
      }
    };
    const accessService: any = {
      getProjectAccess: jest
        .fn()
        .mockResolvedValueOnce({
          canWrite: false,
          projectRole: ProjectRole.READER,
          isAdmin: false
        })
        .mockResolvedValueOnce({
          canWrite: true,
          projectRole: ProjectRole.EDITOR,
          isAdmin: false
        })
    };
    const server = instantiateServer(DocumentsCollaborationServer, prisma, {} as any, accessService);

    const presenceResult = await (server as any).joinRoom(
      {
        kind: "presence",
        token: "ok",
        documentId: "document-1"
      },
      {
        userId: "reader-1",
        email: "reader@example.com",
        globalRole: "reader"
      },
      makeSocket()
    );

    const wikiPresenceResult = await (server as any).joinRoom(
      {
        kind: "wiki-presence",
        token: "ok",
        wikiPageId: "page-1"
      },
      {
        userId: "editor-1",
        email: "editor@example.com",
        globalRole: "editor"
      },
      makeSocket()
    );

    expect(presenceResult.room.kind).toBe("presence");
    expect(presenceResult.canWrite).toBe(false);
    expect(wikiPresenceResult.room.kind).toBe("wiki-presence");
    expect(wikiPresenceResult.canWrite).toBe(true);
  });

  it("disconnects matching users and removes already-closed connections from their rooms", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "atlasium-collab-disconnect-"));
    const { DocumentsCollaborationServer } = await loadServer(storageRoot);
    const server = instantiateServer(DocumentsCollaborationServer, {} as any, {} as any, {} as any);
    const openSocket = makeSocket(WebSocket.OPEN);
    const closedSocket = makeSocket(WebSocket.CLOSED);

    const openRoom = (server as any).getOrCreatePresenceRoom("presence:doc-1");
    openRoom.connections.set(openSocket, new Set());
    openRoom.connectionUsers.set(openSocket, "user-1");

    const closedRoom = (server as any).getOrCreatePresenceRoom("presence:doc-2");
    closedRoom.connections.set(closedSocket, new Set());
    closedRoom.connectionUsers.set(closedSocket, "user-1");

    server.disconnectUser("user-1", "Session revoked");

    expect(openSocket.close).toHaveBeenCalledWith(1008, "Session revoked");
    expect(closedRoom.connections.has(closedSocket)).toBe(false);
    expect((server as any).rooms.has("presence:doc-2")).toBe(false);
  });

  it("persists file room content, writes it to disk, and marks compile status as pending", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "atlasium-collab-persist-file-"));
    const workspaceRootPath = join(storageRoot, "workspaces/version-2");
    await mkdir(workspaceRootPath, { recursive: true });

    const { DocumentsCollaborationServer } = await loadServer(storageRoot);
    const prisma: any = {
      documentVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: "version-2"
        }),
        update: jest.fn().mockResolvedValue(undefined)
      }
    };
    const server = instantiateServer(DocumentsCollaborationServer, prisma, {} as any, {} as any);
    const room = (server as any).getOrCreateFileRoom({
      roomKey: "file:version-2:main.tex",
      documentVersionId: "version-2",
      projectId: "project-1",
      workspaceRootPath,
      filePath: "main.tex",
      absoluteFilePath: join(workspaceRootPath, "main.tex")
    });

    await (server as any).persistRoom(room, "Updated content");

    expect(await readFile(join(workspaceRootPath, "main.tex"), "utf8")).toBe("Updated content");
    expect(prisma.documentVersion.update).toHaveBeenCalledWith({
      where: { id: "version-2" },
      data: {
        compileStatus: CompileStatus.PENDING,
        compileLog: null
      }
    });
  });

  it("removes an invalid file room immediately when there are no active connections left", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "atlasium-collab-invalid-room-"));
    const workspaceRootPath = join(storageRoot, "workspaces/version-3");
    const { DocumentsCollaborationServer } = await loadServer(storageRoot);
    const server = instantiateServer(DocumentsCollaborationServer, {} as any, {} as any, {} as any);
    const room = (server as any).getOrCreateFileRoom({
      roomKey: "file:version-3:main.tex",
      documentVersionId: "version-3",
      projectId: "project-1",
      workspaceRootPath,
      filePath: "main.tex",
      absoluteFilePath: join(workspaceRootPath, "main.tex")
    });

    (server as any).closeRoomDueToInvalidVersion(room, "Document version is no longer available");

    expect((server as any).rooms.has(room.key)).toBe(false);
  });

  it("rejects workspace paths that escape the configured storage root", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "atlasium-collab-invalid-workspace-"));
    const { DocumentsCollaborationServer } = await loadServer(storageRoot);
    const prisma: any = {
      documentVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: "version-1",
          latexWorkspacePath: "../../outside",
          document: {
            projectId: "project-1"
          }
        })
      }
    };
    const accessService: any = {
      getProjectAccess: jest.fn().mockResolvedValue({
        canWrite: true,
        projectRole: ProjectRole.EDITOR,
        isAdmin: false
      })
    };
    const server = instantiateServer(DocumentsCollaborationServer, prisma, {} as any, accessService);

    await expect(
      (server as any).joinRoom(
        {
          kind: "file",
          token: "ok",
          documentVersionId: "version-1",
          path: "main.tex"
        },
        {
          userId: "user-1",
          email: "user@example.com",
          globalRole: "editor"
        },
        makeSocket()
      )
    ).rejects.toMatchObject({
      message: "Invalid workspace path"
    });
  });

  it("flushes a live wiki page room and returns the draft snapshot", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "atlasium-collab-wiki-flush-"));
    const { DocumentsCollaborationServer } = await loadServer(storageRoot);
    const wikiPageTx = {
      wikiPage: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({
            id: "page-1",
            title: "Published title",
            currentRevision: {
              contentMarkdown: "Published content"
            },
            draft: {
              id: "draft-1"
            }
          })
          .mockResolvedValueOnce({
            id: "page-1",
            title: "Published title",
            currentRevision: {
              contentMarkdown: "Published content"
            },
            draft: {
              draftVersion: 2,
              updatedAt: new Date("2026-04-06T12:00:00.000Z"),
              updatedBy: {
                id: "editor-1",
                name: "Editor",
                email: "editor@example.com"
              }
            }
          })
      },
      wikiDraft: {
        update: jest.fn().mockResolvedValue({
          updatedById: "editor-1"
        })
      }
    };
    const prisma: any = {
      wikiPage: {
        findFirst: jest.fn().mockResolvedValue({
          id: "page-1",
          projectId: "project-1"
        })
      },
      $transaction: jest
        .fn()
        .mockImplementationOnce(async (handler: (tx: any) => Promise<unknown>) => handler(wikiPageTx))
        .mockImplementationOnce(async (handler: (tx: any) => Promise<unknown>) => handler(wikiPageTx))
    };
    const accessService: any = {
      ensureProjectWritable: jest.fn().mockResolvedValue(undefined)
    };
    const server = instantiateServer(DocumentsCollaborationServer, prisma, {} as any, accessService);
    const room = (server as any).getOrCreateWikiPageRoom({
      roomKey: "wiki-page:page-1",
      wikiPageId: "page-1",
      projectId: "project-1",
      initialTitle: "Published title",
      initialContent: "Published content",
      initialUpdatedById: "owner-1"
    });

    room.doc.transact(() => {
      const title = room.doc.getText("title");
      const content = room.doc.getText("content");
      title.delete(0, title.length);
      title.insert(0, "Draft title");
      content.delete(0, content.length);
      content.insert(0, "Draft content");
    }, makeSocket());

    await expect(
      server.flushWikiPageDraft("page-1", {
        userId: "editor-1",
        email: "editor@example.com",
        globalRole: "editor"
      } as any)
    ).resolves.toEqual({
      draftVersion: 2,
      updatedAt: "2026-04-06T12:00:00.000Z",
      updatedBy: {
        id: "editor-1",
        name: "Editor",
        email: "editor@example.com"
      }
    });

    expect(accessService.ensureProjectWritable).toHaveBeenCalledWith("editor-1", "editor", "project-1");
    expect(room.lastPersistedTitle).toBe("Draft title");
    expect(room.lastPersistedContent).toBe("Draft content");
  });

  it("removes the last file-room connection and persists the content snapshot during teardown", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "atlasium-collab-remove-"));
    const workspaceRootPath = join(storageRoot, "workspaces/version-4");
    await mkdir(workspaceRootPath, { recursive: true });
    const { DocumentsCollaborationServer } = await loadServer(storageRoot);
    const server = instantiateServer(DocumentsCollaborationServer, {} as any, {} as any, {} as any);
    const room = (server as any).getOrCreateFileRoom({
      roomKey: "file:version-4:main.tex",
      documentVersionId: "version-4",
      projectId: "project-1",
      workspaceRootPath,
      filePath: "main.tex",
      absoluteFilePath: join(workspaceRootPath, "main.tex")
    });
    const socket = makeSocket();
    room.connections.set(socket, new Set());
    room.connectionUsers.set(socket, "user-1");
    room.doc.getText("content").insert(0, "snapshot");
    const persistRoomSpy = jest.spyOn(server as any, "persistRoom").mockResolvedValue(undefined);

    (server as any).removeConnectionFromRoom(room, socket);

    expect(persistRoomSpy).toHaveBeenCalledWith(room, "snapshot");
    expect((server as any).rooms.has(room.key)).toBe(false);
  });

  it("keeps rooms alive when other connections remain during close handling", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "atlasium-collab-remaining-"));
    const { DocumentsCollaborationServer } = await loadServer(storageRoot);
    const server = instantiateServer(DocumentsCollaborationServer, {} as any, {} as any, {} as any);
    const room = (server as any).getOrCreatePresenceRoom("presence:doc-4");
    const firstSocket = makeSocket();
    const secondSocket = makeSocket();
    room.connections.set(firstSocket, new Set());
    room.connections.set(secondSocket, new Set());
    room.connectionUsers.set(firstSocket, "user-1");
    room.connectionUsers.set(secondSocket, "user-2");
    const teardownSpy = jest.spyOn(room, "teardown");

    (server as any).onClose(
      {
        room,
        canWrite: false,
        userId: "user-1"
      },
      firstSocket
    );

    expect(room.connections.has(firstSocket)).toBe(false);
    expect(room.connections.has(secondSocket)).toBe(true);
    expect((server as any).rooms.has(room.key)).toBe(true);
    expect(teardownSpy).not.toHaveBeenCalled();
  });

  it("responds to awareness queries with the current awareness state", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "atlasium-collab-awareness-"));
    const { DocumentsCollaborationServer } = await loadServer(storageRoot);
    const server = instantiateServer(DocumentsCollaborationServer, {} as any, {} as any, {} as any);
    const room = (server as any).getOrCreatePresenceRoom("presence:doc-3");
    const socket = makeSocket();
    room.awareness.setLocalState({
      user: "editor-1"
    });

    const encoder = new Uint8Array([3]);
    (server as any).onMessage(
      {
        room,
        canWrite: true,
        userId: "editor-1"
      },
      socket,
      encoder
    );

    expect(socket.send).toHaveBeenCalled();
  });

  it("sends awareness on initial sync and accepts ArrayBuffer and Buffer[] websocket payloads", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "atlasium-collab-payloads-"));
    const { DocumentsCollaborationServer } = await loadServer(storageRoot);
    const server = instantiateServer(DocumentsCollaborationServer, {} as any, {} as any, {} as any);
    const room = (server as any).getOrCreatePresenceRoom("presence:doc-payloads");
    const socket = makeSocket();

    room.awareness.setLocalState({ user: "editor-1" });
    (server as any).sendInitialSync(room, socket);
    expect(socket.send).toHaveBeenCalledTimes(2);

    socket.send.mockClear();
    const queryEncoder = encoding.createEncoder();
    encoding.writeVarUint(queryEncoder, 3);
    const queryPayload = encoding.toUint8Array(queryEncoder);
    const arrayBufferPayload = queryPayload.buffer.slice(
      queryPayload.byteOffset,
      queryPayload.byteOffset + queryPayload.byteLength
    );

    (server as any).onMessage(
      {
        room,
        canWrite: true,
        userId: "editor-1"
      },
      socket,
      arrayBufferPayload
    );

    expect(socket.send).toHaveBeenCalledTimes(1);

    socket.send.mockClear();
    (server as any).onMessage(
      {
        room,
        canWrite: true,
        userId: "editor-1"
      },
      socket,
      [Buffer.from(queryPayload)] as any
    );

    expect(socket.send).toHaveBeenCalledTimes(1);
  });

  it("does not send initial sync payloads to closed sockets and closes sockets on send callback failures", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "atlasium-collab-send-"));
    const { DocumentsCollaborationServer } = await loadServer(storageRoot);
    const server = instantiateServer(DocumentsCollaborationServer, {} as any, {} as any, {} as any);
    const room = (server as any).getOrCreatePresenceRoom("presence:doc-5");
    room.awareness.setLocalState({ user: "editor-1" });

    const closedSocket = makeSocket(WebSocket.CLOSED);
    (server as any).sendInitialSync(room, closedSocket);
    expect(closedSocket.send).not.toHaveBeenCalled();

    const failingSocket = makeSocket(WebSocket.OPEN);
    failingSocket.send = jest.fn((...args: any[]) => {
      const callback =
        typeof args[1] === "function"
          ? args[1]
          : typeof args[2] === "function"
            ? args[2]
            : undefined;
      callback?.(new Error("boom"));
    });

    (server as any).sendInitialSync(room, failingSocket);
    expect(failingSocket.close).toHaveBeenCalledWith(1011, "Send failed");
  });

  it("ignores sync updates from read-only clients and logs malformed websocket payloads", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "atlasium-collab-sync-readonly-"));
    const workspaceRootPath = join(storageRoot, "workspaces/version-readonly");
    await mkdir(workspaceRootPath, { recursive: true });

    const { DocumentsCollaborationServer } = await loadServer(storageRoot);
    const server = instantiateServer(DocumentsCollaborationServer, {} as any, {} as any, {} as any);
    const room = (server as any).getOrCreateFileRoom({
      roomKey: "file:version-readonly:main.tex",
      documentVersionId: "version-readonly",
      projectId: "project-1",
      workspaceRootPath,
      filePath: "main.tex",
      absoluteFilePath: join(workspaceRootPath, "main.tex")
    });
    const socket = makeSocket();
    const updateDoc = new Y.Doc();
    updateDoc.getText("content").insert(0, "readonly-change");
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 0);
    syncProtocol.writeUpdate(encoder, Y.encodeStateAsUpdate(updateDoc));

    (server as any).onMessage(
      {
        room,
        canWrite: false,
        userId: "reader-1"
      },
      socket,
      Buffer.from(encoding.toUint8Array(encoder))
    );

    expect(room.doc.getText("content").toString()).toBe("");

    const loggerWarnSpy = jest.spyOn((server as any).logger, "warn").mockImplementation(() => undefined);
    (server as any).onMessage(
      {
        room,
        canWrite: true,
        userId: "editor-1"
      },
      socket,
      [Buffer.from([255]), Buffer.from([255])] as any
    );
    expect(loggerWarnSpy).toHaveBeenCalledWith(expect.stringContaining("Collaboration message rejected"));
  });

  it("marks file-room persistence as queued when another persist is already in flight", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "atlasium-collab-queued-"));
    const workspaceRootPath = join(storageRoot, "workspaces/version-queued");
    await mkdir(workspaceRootPath, { recursive: true });

    const { DocumentsCollaborationServer } = await loadServer(storageRoot);
    const server = instantiateServer(DocumentsCollaborationServer, {} as any, {} as any, {} as any);
    const room = (server as any).getOrCreateFileRoom({
      roomKey: "file:version-queued:main.tex",
      documentVersionId: "version-queued",
      projectId: "project-1",
      workspaceRootPath,
      filePath: "main.tex",
      absoluteFilePath: join(workspaceRootPath, "main.tex")
    });
    room.persistInFlight = true;

    await (server as any).persistRoom(room, "queued");

    expect(room.persistQueued).toBe(true);
  });

  it("closes invalid file rooms during autosave and logs queued wiki persistence failures", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "atlasium-collab-persist-errors-"));
    const workspaceRootPath = join(storageRoot, "workspaces/version-invalid-persist");
    await mkdir(workspaceRootPath, { recursive: true });

    const { DocumentsCollaborationServer } = await loadServer(storageRoot);
    const prisma: any = {
      documentVersion: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn()
      },
      $transaction: jest.fn().mockRejectedValue(new Error("draft save failed"))
    };
    const server = instantiateServer(DocumentsCollaborationServer, prisma, {} as any, {} as any);
    const fileRoom = (server as any).getOrCreateFileRoom({
      roomKey: "file:version-invalid-persist:main.tex",
      documentVersionId: "version-invalid-persist",
      projectId: "project-1",
      workspaceRootPath,
      filePath: "main.tex",
      absoluteFilePath: join(workspaceRootPath, "main.tex")
    });
    const closeRoomSpy = jest.spyOn(server as any, "closeRoomDueToInvalidVersion").mockImplementation(() => undefined);

    await (server as any).persistRoom(fileRoom, "updated");

    expect(closeRoomSpy).toHaveBeenCalledWith(fileRoom, "Document version is no longer available");

    const wikiRoom = (server as any).getOrCreateWikiPageRoom({
      roomKey: "wiki-page:page-persist",
      wikiPageId: "page-persist",
      projectId: "project-1",
      initialTitle: "Original",
      initialContent: "Published",
      initialUpdatedById: "owner-1"
    });
    wikiRoom.persistQueued = true;
    const scheduleWikiPersistSpy = jest.spyOn(server as any, "scheduleWikiPageRoomPersist").mockImplementation(() => undefined);
    const loggerErrorSpy = jest.spyOn((server as any).logger, "error").mockImplementation(() => undefined);

    await (server as any).persistWikiPageRoom(
      wikiRoom,
      {
        title: "Changed title",
        contentMarkdown: "Changed content"
      },
      "editor-1"
    );

    expect(loggerErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Wiki collaboration autosave failed"));
    expect(scheduleWikiPersistSpy).toHaveBeenCalledWith(wikiRoom);
    expect(wikiRoom.persistQueued).toBe(false);
  });

  it("rejects invalid LaTeX file paths when joining file rooms", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "atlasium-collab-invalid-path-"));
    const { DocumentsCollaborationServer } = await loadServer(storageRoot);
    const prisma: any = {
      documentVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: "version-1",
          latexWorkspacePath: "workspaces/version-1",
          document: {
            projectId: "project-1"
          }
        })
      }
    };
    const accessService: any = {
      getProjectAccess: jest.fn().mockResolvedValue({
        canWrite: true,
        projectRole: ProjectRole.EDITOR,
        isAdmin: false
      })
    };
    const server = instantiateServer(DocumentsCollaborationServer, prisma, {} as any, accessService);

    await expect(
      (server as any).joinRoom(
        {
          kind: "file",
          token: "ok",
          documentVersionId: "version-1",
          path: "../secret.tex"
        },
        {
          userId: "user-1",
          email: "user@example.com",
          globalRole: "editor"
        },
        makeSocket()
      )
    ).rejects.toMatchObject({
      message: "Invalid LaTeX file path"
    });
  });
});

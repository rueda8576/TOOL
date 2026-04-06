import { EventEmitter } from "events";
import { mkdtemp, mkdir, readFile, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import { CompileStatus, ProjectRole } from "@prisma/client";
import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import * as Y from "yjs";
import { WebSocket } from "ws";

describe("DocumentsCollaborationServer", () => {
  const createdServers: any[] = [];

  const loadServer = async (storageRoot: string) => {
    jest.resetModules();
    process.env.STORAGE_ROOT = storageRoot;
    process.env.JWT_SECRET = "integration-secret-123";
    jest.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      const [message] = args;
      if (typeof message === "string" && message.includes("Yjs was already imported")) {
        return;
      }
      // eslint-disable-next-line no-console
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

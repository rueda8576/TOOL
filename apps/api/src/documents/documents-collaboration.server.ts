import { ForbiddenException, Logger, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { CompileStatus } from "@prisma/client";
import * as awarenessProtocol from "y-protocols/awareness";
import { Awareness } from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as Y from "yjs";
import type { IncomingMessage } from "http";
import type { Server as HttpServer } from "http";
import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname, resolve, sep } from "path";
import { URL } from "url";
import { WebSocket, WebSocketServer, RawData } from "ws";

import { ProjectAccessService } from "../common/project-access.service";
import { AuthenticatedUser } from "../common/authenticated-user";
import { SessionAuthService } from "../common/session-auth.service";
import { PrismaService } from "../prisma/prisma.service";
import { getEnv } from "../config/env";

type CollaborationRoomKind = "presence" | "file" | "wiki-presence" | "wiki-page";

type BaseRoom = {
  key: string;
  kind: CollaborationRoomKind;
  doc: Y.Doc;
  awareness: Awareness;
  connections: Map<WebSocket, Set<number>>;
  connectionUsers: Map<WebSocket, string>;
  teardown: () => void;
};

type PresenceRoom = BaseRoom & {
  kind: "presence";
};

type WikiPresenceRoom = BaseRoom & {
  kind: "wiki-presence";
};

type FileRoom = BaseRoom & {
  kind: "file";
  documentVersionId: string;
  projectId: string;
  workspaceRootPath: string;
  filePath: string;
  absoluteFilePath: string;
  persistTimer: NodeJS.Timeout | null;
  persistInFlight: boolean;
  persistQueued: boolean;
  lastPersistedContent: string;
  loadPromise: Promise<void> | null;
};

type WikiPageRoom = BaseRoom & {
  kind: "wiki-page";
  wikiPageId: string;
  projectId: string;
  persistTimer: NodeJS.Timeout | null;
  persistInFlight: boolean;
  persistQueued: boolean;
  lastPersistedTitle: string;
  lastPersistedContent: string;
  lastUpdatedById: string;
};

type CollaborationRoom = PresenceRoom | FileRoom | WikiPresenceRoom | WikiPageRoom;

type AuthenticatedCollabUser = {
  userId: string;
  email: string;
  globalRole: "admin" | "editor" | "reader";
};

type RoomConnectionContext = {
  room: CollaborationRoom;
  canWrite: boolean;
  userId: string;
};

type RoomQuery =
  | {
      kind: "presence";
      token?: string;
      documentId: string;
    }
  | {
      kind: "file";
      token?: string;
      documentVersionId: string;
      path: string;
    }
  | {
      kind: "wiki-presence";
      token?: string;
      wikiPageId: string;
    }
  | {
      kind: "wiki-page";
      token?: string;
      wikiPageId: string;
    };

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
const MESSAGE_QUERY_AWARENESS = 3;
const AUTOSAVE_DEBOUNCE_MS = 3000;
const COLLAB_PATH_PREFIX = "/collab";
const FILE_YDOC_TEXT_KEY = "content";
const WIKI_YDOC_TITLE_KEY = "title";
const WIKI_YDOC_CONTENT_KEY = "content";
const INITIAL_LOAD_ORIGIN = Symbol("initial-load");

function normalizeOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function allowedCollaborationOrigins(): Set<string> {
  const env = getEnv();
  const origins = [
    env.APP_BASE_URL,
    "http://localhost:3000",
    "http://127.0.0.1:3000"
  ];

  return new Set(origins.map((origin) => normalizeOrigin(origin)).filter((origin): origin is string => Boolean(origin)));
}

function normalizeLatexPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.split("/").some((segment) => segment === ".." || segment.startsWith("-"))) {
    throw new ForbiddenException("Invalid LaTeX file path");
  }
  return normalized;
}

function toBinaryPayload(payload: RawData): Uint8Array {
  if (payload instanceof ArrayBuffer) {
    return new Uint8Array(payload);
  }
  if (Array.isArray(payload)) {
    return new Uint8Array(Buffer.concat(payload));
  }
  return new Uint8Array(payload);
}

function safeSend(connection: WebSocket, payload: Uint8Array): void {
  if (connection.readyState !== WebSocket.OPEN) {
    return;
  }
  connection.send(payload, (error) => {
    if (error && connection.readyState === WebSocket.OPEN) {
      connection.close(1011, "Send failed");
    }
  });
}

function parseRoomQuery(request: IncomingMessage): RoomQuery {
  const host = request.headers.host ?? "localhost";
  const parsedUrl = new URL(request.url ?? COLLAB_PATH_PREFIX, `http://${host}`);

  if (!parsedUrl.pathname.startsWith(COLLAB_PATH_PREFIX)) {
    throw new NotFoundException("Unknown collaboration endpoint");
  }

  const token = parsedUrl.searchParams.get("token")?.trim();
  const kind = parsedUrl.searchParams.get("kind")?.trim();
  if (kind === "presence") {
    const documentId = parsedUrl.searchParams.get("documentId")?.trim();
    if (!documentId) {
      throw new ForbiddenException("Missing documentId");
    }
    return { kind, token, documentId };
  }

  if (kind === "file") {
    const documentVersionId = parsedUrl.searchParams.get("documentVersionId")?.trim();
    const path = parsedUrl.searchParams.get("path")?.trim();
    if (!documentVersionId || !path) {
      throw new ForbiddenException("Missing documentVersionId or path");
    }
    return { kind, token, documentVersionId, path };
  }

  if (kind === "wiki-presence" || kind === "wiki-page") {
    const wikiPageId = parsedUrl.searchParams.get("wikiPageId")?.trim();
    if (!wikiPageId) {
      throw new ForbiddenException("Missing wikiPageId");
    }
    return { kind, token, wikiPageId };
  }

  throw new ForbiddenException("Unsupported collaboration room kind");
}

function readCookie(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) {
    return null;
  }

  for (const cookiePart of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = cookiePart.trim().split("=");
    if (rawName === name) {
      return decodeURIComponent(rawValue.join("="));
    }
  }

  return null;
}

export class DocumentsCollaborationServer {
  private readonly logger = new Logger(DocumentsCollaborationServer.name);
  private readonly wsServer = new WebSocketServer({
    noServer: true,
    clientTracking: false,
    perMessageDeflate: false
  });
  private readonly rooms = new Map<string, CollaborationRoom>();
  private readonly storageRoot = resolve(getEnv().STORAGE_ROOT);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessionAuthService: SessionAuthService,
    private readonly accessService: ProjectAccessService
  ) {}

  start(httpServer: HttpServer): void {
    httpServer.on("upgrade", (request, socket, head) => {
      const host = request.headers.host ?? "localhost";
      const parsedUrl = new URL(request.url ?? COLLAB_PATH_PREFIX, `http://${host}`);
      if (!parsedUrl.pathname.startsWith(COLLAB_PATH_PREFIX)) {
        return;
      }

      if (!this.isAllowedUpgradeOrigin(request)) {
        socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }

      this.wsServer.handleUpgrade(request, socket, head, (socketConnection) => {
        this.wsServer.emit("connection", socketConnection, request);
      });
    });

    this.wsServer.on("connection", (connection, request) => {
      void this.handleConnection(connection, request);
    });
  }

  private isAllowedUpgradeOrigin(request: IncomingMessage): boolean {
    const originHeader = request.headers.origin;
    if (!originHeader) {
      return true;
    }
    if (Array.isArray(originHeader)) {
      return false;
    }

    const origin = normalizeOrigin(originHeader);
    return Boolean(origin && allowedCollaborationOrigins().has(origin));
  }

  private async handleConnection(connection: WebSocket, request: IncomingMessage): Promise<void> {
    let roomContext: RoomConnectionContext | null = null;

    try {
      const query = parseRoomQuery(request);
      const user = await this.authenticate(request, query.token);
      roomContext = await this.joinRoom(query, user, connection);
      this.sendInitialSync(roomContext.room, connection);

      connection.on("message", (payload) => {
        this.onMessage(roomContext as RoomConnectionContext, connection, payload);
      });

      connection.on("close", () => {
        this.onClose(roomContext as RoomConnectionContext, connection);
      });

      connection.on("error", (error) => {
        this.logger.warn(`Collaboration socket error: ${error.message}`);
        this.onClose(roomContext as RoomConnectionContext, connection);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Collaboration handshake failed";
      this.logger.warn(`Collaboration handshake rejected: ${message}`);
      if (connection.readyState === WebSocket.OPEN || connection.readyState === WebSocket.CONNECTING) {
        connection.close(1008, message.slice(0, 120));
      }
    }
  }

  private async authenticate(request: IncomingMessage, queryToken?: string): Promise<AuthenticatedCollabUser> {
    const env = getEnv();
    const cookieToken = readCookie(request.headers.cookie, env.ATLASIUM_SESSION_COOKIE_NAME);
    const token = cookieToken ?? (env.COLLAB_ALLOW_QUERY_TOKEN ? queryToken : undefined);
    if (!token) {
      throw new UnauthorizedException("Missing collaboration token");
    }

    return this.sessionAuthService.authenticateToken(token, {
      invalidToken: "Invalid collaboration token",
      expiredSession: "Session expired"
    });
  }

  private workspaceAbsolutePath(workspaceRelativePath: string): string {
    const absolutePath = resolve(this.storageRoot, workspaceRelativePath);
    if (absolutePath !== this.storageRoot && !absolutePath.startsWith(`${this.storageRoot}${sep}`)) {
      throw new ForbiddenException("Invalid workspace path");
    }
    return absolutePath;
  }

  private fileAbsolutePath(workspaceRootPath: string, filePath: string): string {
    const absoluteFilePath = resolve(workspaceRootPath, filePath);
    if (absoluteFilePath !== workspaceRootPath && !absoluteFilePath.startsWith(`${workspaceRootPath}${sep}`)) {
      throw new ForbiddenException("Invalid LaTeX file path");
    }
    return absoluteFilePath;
  }

  private closeRoomDueToInvalidVersion(room: FileRoom, reason: string): void {
    if (room.persistTimer) {
      clearTimeout(room.persistTimer);
      room.persistTimer = null;
    }

    const activeConnections = Array.from(room.connections.keys());
    for (const connection of activeConnections) {
      if (connection.readyState === WebSocket.OPEN || connection.readyState === WebSocket.CONNECTING) {
        connection.close(1008, reason.slice(0, 120));
      }
    }

    if (activeConnections.length === 0) {
      room.teardown();
      this.rooms.delete(room.key);
    }
  }

  disconnectUser(userId: string, reason: string): void {
    for (const room of this.rooms.values()) {
      for (const [connection, connectionUserId] of room.connectionUsers.entries()) {
        if (connectionUserId !== userId) {
          continue;
        }

        if (connection.readyState === WebSocket.OPEN || connection.readyState === WebSocket.CONNECTING) {
          connection.close(1008, reason.slice(0, 120));
          continue;
        }

        this.removeConnectionFromRoom(room, connection);
      }
    }
  }

  private async joinRoom(query: RoomQuery, user: AuthenticatedCollabUser, connection: WebSocket): Promise<RoomConnectionContext> {
    if (query.kind === "presence") {
      const document = await this.prisma.document.findFirst({
        where: {
          id: query.documentId,
          deletedAt: null
        },
        select: {
          id: true,
          projectId: true
        }
      });

      if (!document) {
        throw new NotFoundException("Document not found");
      }

      const access = await this.accessService.getProjectAccess(user.userId, user.globalRole, document.projectId);

      const roomKey = `presence:${document.id}`;
      const room = this.getOrCreatePresenceRoom(roomKey);
      room.connections.set(connection, new Set<number>());
      room.connectionUsers.set(connection, user.userId);

      return {
        room,
        canWrite: access.canWrite,
        userId: user.userId
      };
    }

    if (query.kind === "wiki-presence") {
      const page = await this.prisma.wikiPage.findFirst({
        where: {
          id: query.wikiPageId,
          deletedAt: null
        },
        select: {
          id: true,
          projectId: true
        }
      });

      if (!page) {
        throw new NotFoundException("Wiki page not found");
      }

      const access = await this.accessService.getProjectAccess(user.userId, user.globalRole, page.projectId);

      const roomKey = `wiki-presence:${page.id}`;
      const room = this.getOrCreateWikiPresenceRoom(roomKey);
      room.connections.set(connection, new Set<number>());
      room.connectionUsers.set(connection, user.userId);

      return {
        room,
        canWrite: access.canWrite,
        userId: user.userId
      };
    }

    if (query.kind === "wiki-page") {
      const page = await this.prisma.wikiPage.findFirst({
        where: {
          id: query.wikiPageId,
          deletedAt: null
        },
        select: {
          id: true,
          projectId: true,
          title: true,
          createdById: true,
          currentRevision: {
            select: {
              contentMarkdown: true
            }
          },
          draft: {
            select: {
              title: true,
              contentMarkdown: true,
              updatedById: true
            }
          }
        }
      });

      if (!page) {
        throw new NotFoundException("Wiki page not found");
      }

      const access = await this.accessService.getProjectAccess(user.userId, user.globalRole, page.projectId);

      const roomKey = `wiki-page:${page.id}`;
      const room = this.getOrCreateWikiPageRoom({
        roomKey,
        wikiPageId: page.id,
        projectId: page.projectId,
        initialTitle: page.draft?.title ?? page.title,
        initialContent: page.draft?.contentMarkdown ?? page.currentRevision?.contentMarkdown ?? "",
        initialUpdatedById: page.draft?.updatedById ?? page.createdById
      });
      room.connections.set(connection, new Set<number>());
      room.connectionUsers.set(connection, user.userId);

      return {
        room,
        canWrite: access.canWrite,
        userId: user.userId
      };
    }

    const version = await this.prisma.documentVersion.findFirst({
      where: {
        id: query.documentVersionId,
        deletedAt: null,
        branch: {
          deletedAt: null
        },
        document: {
          deletedAt: null
        }
      },
      select: {
        id: true,
        latexWorkspacePath: true,
        document: {
          select: {
            projectId: true
          }
        }
      }
    });

    if (!version) {
      throw new NotFoundException("Document version not found");
    }

    const access = await this.accessService.getProjectAccess(user.userId, user.globalRole, version.document.projectId);

    if (!version.latexWorkspacePath) {
      throw new NotFoundException("Document version has no editable LaTeX workspace");
    }

    const normalizedPath = normalizeLatexPath(query.path);
    const workspaceRootPath = this.workspaceAbsolutePath(version.latexWorkspacePath);
    const absoluteFilePath = this.fileAbsolutePath(workspaceRootPath, normalizedPath);

    const roomKey = `file:${version.id}:${normalizedPath}`;
    const room = this.getOrCreateFileRoom({
      roomKey,
      documentVersionId: version.id,
      projectId: version.document.projectId,
      workspaceRootPath,
      filePath: normalizedPath,
      absoluteFilePath
    });

    room.connections.set(connection, new Set<number>());
    room.connectionUsers.set(connection, user.userId);
    await this.ensureFileRoomLoaded(room);

    return {
      room,
      canWrite: access.canWrite,
      userId: user.userId
    };
  }

  private getOrCreatePresenceRoom(roomKey: string): PresenceRoom {
    const existing = this.rooms.get(roomKey);
    if (existing) {
      return existing as PresenceRoom;
    }

    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    const room: PresenceRoom = {
      key: roomKey,
      kind: "presence",
      doc,
      awareness,
      connections: new Map<WebSocket, Set<number>>(),
      connectionUsers: new Map<WebSocket, string>(),
      teardown: () => {
        awareness.off("update", awarenessUpdateHandler);
        doc.destroy();
      }
    };

    const awarenessUpdateHandler = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown): void => {
      const changedClients = [...added, ...updated, ...removed];
      if (origin instanceof WebSocket) {
        const controlledClients = room.connections.get(origin);
        if (controlledClients) {
          for (const clientId of added) {
            controlledClients.add(clientId);
          }
          for (const clientId of removed) {
            controlledClients.delete(clientId);
          }
        }
      }

      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(room.awareness, changedClients));
      const message = encoding.toUint8Array(encoder);

      for (const ws of room.connections.keys()) {
        safeSend(ws, message);
      }
    };

    awareness.on("update", awarenessUpdateHandler);
    this.rooms.set(roomKey, room);
    return room;
  }

  private getOrCreateWikiPresenceRoom(roomKey: string): WikiPresenceRoom {
    const existing = this.rooms.get(roomKey);
    if (existing) {
      return existing as WikiPresenceRoom;
    }

    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    const room: WikiPresenceRoom = {
      key: roomKey,
      kind: "wiki-presence",
      doc,
      awareness,
      connections: new Map<WebSocket, Set<number>>(),
      connectionUsers: new Map<WebSocket, string>(),
      teardown: () => {
        awareness.off("update", awarenessUpdateHandler);
        doc.destroy();
      }
    };

    const awarenessUpdateHandler = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown): void => {
      const changedClients = [...added, ...updated, ...removed];
      if (origin instanceof WebSocket) {
        const controlledClients = room.connections.get(origin);
        if (controlledClients) {
          for (const clientId of added) {
            controlledClients.add(clientId);
          }
          for (const clientId of removed) {
            controlledClients.delete(clientId);
          }
        }
      }

      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(room.awareness, changedClients));
      const message = encoding.toUint8Array(encoder);

      for (const ws of room.connections.keys()) {
        safeSend(ws, message);
      }
    };

    awareness.on("update", awarenessUpdateHandler);
    this.rooms.set(roomKey, room);
    return room;
  }

  private getOrCreateFileRoom(params: {
    roomKey: string;
    documentVersionId: string;
    projectId: string;
    workspaceRootPath: string;
    filePath: string;
    absoluteFilePath: string;
  }): FileRoom {
    const existing = this.rooms.get(params.roomKey);
    if (existing) {
      return existing as FileRoom;
    }

    const doc = new Y.Doc();
    const awareness = new Awareness(doc);

    const room: FileRoom = {
      key: params.roomKey,
      kind: "file",
      doc,
      awareness,
      documentVersionId: params.documentVersionId,
      projectId: params.projectId,
      workspaceRootPath: params.workspaceRootPath,
      filePath: params.filePath,
      absoluteFilePath: params.absoluteFilePath,
      connections: new Map<WebSocket, Set<number>>(),
      connectionUsers: new Map<WebSocket, string>(),
      persistTimer: null,
      persistInFlight: false,
      persistQueued: false,
      lastPersistedContent: "",
      loadPromise: null,
      teardown: () => {
        awareness.off("update", awarenessUpdateHandler);
        doc.off("update", documentUpdateHandler);
        if (room.persistTimer) {
          clearTimeout(room.persistTimer);
          room.persistTimer = null;
        }
        doc.destroy();
      }
    };

    const awarenessUpdateHandler = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown): void => {
      const changedClients = [...added, ...updated, ...removed];
      if (origin instanceof WebSocket) {
        const controlledClients = room.connections.get(origin);
        if (controlledClients) {
          for (const clientId of added) {
            controlledClients.add(clientId);
          }
          for (const clientId of removed) {
            controlledClients.delete(clientId);
          }
        }
      }

      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(room.awareness, changedClients));
      const message = encoding.toUint8Array(encoder);

      for (const ws of room.connections.keys()) {
        safeSend(ws, message);
      }
    };

    const documentUpdateHandler = (update: Uint8Array, origin: unknown): void => {
      if (origin === INITIAL_LOAD_ORIGIN) {
        return;
      }

      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      const message = encoding.toUint8Array(encoder);

      for (const ws of room.connections.keys()) {
        if (origin instanceof WebSocket && ws === origin) {
          continue;
        }
        safeSend(ws, message);
      }

      this.scheduleRoomPersist(room);
    };

    awareness.on("update", awarenessUpdateHandler);
    doc.on("update", documentUpdateHandler);

    this.rooms.set(params.roomKey, room);
    return room;
  }

  private getOrCreateWikiPageRoom(params: {
    roomKey: string;
    wikiPageId: string;
    projectId: string;
    initialTitle: string;
    initialContent: string;
    initialUpdatedById: string;
  }): WikiPageRoom {
    const existing = this.rooms.get(params.roomKey);
    if (existing) {
      return existing as WikiPageRoom;
    }

    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    const room: WikiPageRoom = {
      key: params.roomKey,
      kind: "wiki-page",
      doc,
      awareness,
      wikiPageId: params.wikiPageId,
      projectId: params.projectId,
      connections: new Map<WebSocket, Set<number>>(),
      connectionUsers: new Map<WebSocket, string>(),
      persistTimer: null,
      persistInFlight: false,
      persistQueued: false,
      lastPersistedTitle: params.initialTitle,
      lastPersistedContent: params.initialContent,
      lastUpdatedById: params.initialUpdatedById,
      teardown: () => {
        awareness.off("update", awarenessUpdateHandler);
        doc.off("update", documentUpdateHandler);
        if (room.persistTimer) {
          clearTimeout(room.persistTimer);
          room.persistTimer = null;
        }
        doc.destroy();
      }
    };

    const awarenessUpdateHandler = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown): void => {
      const changedClients = [...added, ...updated, ...removed];
      if (origin instanceof WebSocket) {
        const controlledClients = room.connections.get(origin);
        if (controlledClients) {
          for (const clientId of added) {
            controlledClients.add(clientId);
          }
          for (const clientId of removed) {
            controlledClients.delete(clientId);
          }
        }
      }

      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(room.awareness, changedClients));
      const message = encoding.toUint8Array(encoder);

      for (const ws of room.connections.keys()) {
        safeSend(ws, message);
      }
    };

    const documentUpdateHandler = (update: Uint8Array, origin: unknown): void => {
      if (origin === INITIAL_LOAD_ORIGIN) {
        return;
      }

      if (origin instanceof WebSocket) {
        const userId = room.connectionUsers.get(origin);
        if (userId) {
          room.lastUpdatedById = userId;
        }
      }

      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      const message = encoding.toUint8Array(encoder);

      for (const ws of room.connections.keys()) {
        if (origin instanceof WebSocket && ws === origin) {
          continue;
        }
        safeSend(ws, message);
      }

      this.scheduleWikiPageRoomPersist(room);
    };

    awareness.on("update", awarenessUpdateHandler);
    doc.on("update", documentUpdateHandler);
    doc.transact(() => {
      const yTitle = doc.getText(WIKI_YDOC_TITLE_KEY);
      const yContent = doc.getText(WIKI_YDOC_CONTENT_KEY);
      if (params.initialTitle.length > 0) {
        yTitle.insert(0, params.initialTitle);
      }
      if (params.initialContent.length > 0) {
        yContent.insert(0, params.initialContent);
      }
    }, INITIAL_LOAD_ORIGIN);

    this.rooms.set(params.roomKey, room);
    return room;
  }

  private scheduleWikiPageRoomPersist(room: WikiPageRoom): void {
    if (room.persistTimer) {
      clearTimeout(room.persistTimer);
    }

    room.persistTimer = setTimeout(() => {
      room.persistTimer = null;
      void this.persistWikiPageRoom(room);
    }, AUTOSAVE_DEBOUNCE_MS);
  }

  private wikiPageRoomSnapshot(room: WikiPageRoom): { title: string; contentMarkdown: string } {
    return {
      title: room.doc.getText(WIKI_YDOC_TITLE_KEY).toString(),
      contentMarkdown: room.doc.getText(WIKI_YDOC_CONTENT_KEY).toString()
    };
  }

  private async persistWikiPageRoom(
    room: WikiPageRoom,
    forcedState?: { title: string; contentMarkdown: string },
    forcedUpdatedById?: string
  ): Promise<void> {
    if (room.persistInFlight) {
      room.persistQueued = true;
      return;
    }

    room.persistInFlight = true;

    try {
      const nextState = forcedState ?? this.wikiPageRoomSnapshot(room);
      const hasChanges =
        nextState.title !== room.lastPersistedTitle || nextState.contentMarkdown !== room.lastPersistedContent;
      if (!hasChanges) {
        return;
      }

      const updatedById = forcedUpdatedById ?? room.lastUpdatedById;
      const updatedDraft = await this.prisma.$transaction(async (tx) => {
        const page = await tx.wikiPage.findFirst({
          where: {
            id: room.wikiPageId,
            deletedAt: null
          },
          select: {
            id: true,
            title: true,
            currentRevision: {
              select: {
                contentMarkdown: true
              }
            },
            draft: {
              select: {
                id: true
              }
            }
          }
        });

        if (!page) {
          throw new NotFoundException("Wiki page not found");
        }

        if (page.draft) {
          return tx.wikiDraft.update({
            where: {
              pageId: room.wikiPageId
            },
            data: {
              title: nextState.title,
              contentMarkdown: nextState.contentMarkdown,
              draftVersion: {
                increment: 1
              },
              updatedById
            },
            select: {
              updatedById: true
            }
          });
        }

        return tx.wikiDraft.create({
          data: {
            pageId: room.wikiPageId,
            title: nextState.title || page.title,
            contentMarkdown: nextState.contentMarkdown || page.currentRevision?.contentMarkdown || "",
            draftVersion: 1,
            updatedById
          },
          select: {
            updatedById: true
          }
        });
      });

      room.lastPersistedTitle = nextState.title;
      room.lastPersistedContent = nextState.contentMarkdown;
      room.lastUpdatedById = updatedDraft.updatedById;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown wiki persistence error";
      this.logger.error(`Wiki collaboration autosave failed for ${room.key}: ${message}`);
    } finally {
      room.persistInFlight = false;
      if (room.persistQueued) {
        room.persistQueued = false;
        this.scheduleWikiPageRoomPersist(room);
      }
    }
  }

  private async getOrCreateWikiDraftSnapshot(pageId: string, updatedById: string): Promise<{
    draftVersion: number;
    updatedAt: string;
    updatedBy: { id: string; name: string; email: string };
  }> {
    const draft = await this.prisma.$transaction(async (tx) => {
      const page = await tx.wikiPage.findFirst({
        where: {
          id: pageId,
          deletedAt: null
        },
        select: {
          id: true,
          title: true,
          currentRevision: {
            select: {
              contentMarkdown: true
            }
          },
          draft: {
            select: {
              title: true,
              contentMarkdown: true,
              draftVersion: true,
              updatedAt: true,
              updatedBy: {
                select: {
                  id: true,
                  name: true,
                  email: true
                }
              }
            }
          }
        }
      });

      if (!page) {
        throw new NotFoundException("Wiki page not found");
      }

      if (page.draft) {
        return page.draft;
      }

      return tx.wikiDraft.create({
        data: {
          pageId: page.id,
          title: page.title,
          contentMarkdown: page.currentRevision?.contentMarkdown ?? "",
          draftVersion: 1,
          updatedById
        },
        select: {
          draftVersion: true,
          updatedAt: true,
          updatedBy: {
            select: {
              id: true,
              name: true,
              email: true
            }
          }
        }
      });
    });

    return {
      draftVersion: draft.draftVersion,
      updatedAt: draft.updatedAt.toISOString(),
      updatedBy: draft.updatedBy
    };
  }

  async flushWikiPageDraft(pageId: string, user: AuthenticatedUser): Promise<{
    draftVersion: number;
    updatedAt: string;
    updatedBy: { id: string; name: string; email: string };
  }> {
    const page = await this.prisma.wikiPage.findFirst({
      where: {
        id: pageId,
        deletedAt: null
      },
      select: {
        id: true,
        projectId: true
      }
    });

    if (!page) {
      throw new NotFoundException("Wiki page not found");
    }

    await this.accessService.ensureProjectWritable(user.userId, user.globalRole, page.projectId);

    const roomKey = `wiki-page:${page.id}`;
    const room = this.rooms.get(roomKey);
    if (room?.kind === "wiki-page") {
      const snapshot = this.wikiPageRoomSnapshot(room);
      room.lastUpdatedById = user.userId;
      await this.persistWikiPageRoom(room, snapshot, user.userId);
    }

    return this.getOrCreateWikiDraftSnapshot(page.id, user.userId);
  }

  private async ensureFileRoomLoaded(room: FileRoom): Promise<void> {
    if (room.loadPromise) {
      await room.loadPromise;
      return;
    }

    room.loadPromise = (async () => {
      let initialContent = "";
      try {
        initialContent = await readFile(room.absoluteFilePath, "utf8");
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "ENOENT") {
          throw error;
        }
      }

      room.doc.transact(() => {
        const yText = room.doc.getText(FILE_YDOC_TEXT_KEY);
        if (yText.length > 0) {
          yText.delete(0, yText.length);
        }
        if (initialContent.length > 0) {
          yText.insert(0, initialContent);
        }
      }, INITIAL_LOAD_ORIGIN);

      room.lastPersistedContent = initialContent;
    })();

    await room.loadPromise;
  }

  private scheduleRoomPersist(room: FileRoom): void {
    if (room.persistTimer) {
      clearTimeout(room.persistTimer);
    }

    room.persistTimer = setTimeout(() => {
      room.persistTimer = null;
      void this.persistRoom(room);
    }, AUTOSAVE_DEBOUNCE_MS);
  }

  private async persistRoom(room: FileRoom, forcedContent?: string): Promise<void> {
    if (room.persistInFlight) {
      room.persistQueued = true;
      return;
    }

    room.persistInFlight = true;

    try {
      const nextContent = forcedContent ?? room.doc.getText(FILE_YDOC_TEXT_KEY).toString();
      if (nextContent === room.lastPersistedContent) {
        return;
      }

      const activeVersion = await this.prisma.documentVersion.findFirst({
        where: {
          id: room.documentVersionId,
          deletedAt: null,
          branch: {
            deletedAt: null
          },
          document: {
            deletedAt: null
          }
        },
        select: {
          id: true
        }
      });

      if (!activeVersion) {
        this.closeRoomDueToInvalidVersion(room, "Document version is no longer available");
        return;
      }

      await mkdir(dirname(room.absoluteFilePath), { recursive: true });
      await writeFile(room.absoluteFilePath, nextContent, "utf8");
      room.lastPersistedContent = nextContent;

      await this.prisma.documentVersion.update({
        where: { id: room.documentVersionId },
        data: {
          compileStatus: CompileStatus.PENDING,
          compileLog: null
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown persistence error";
      this.logger.error(`Collaboration autosave failed for ${room.key}: ${message}`);
    } finally {
      room.persistInFlight = false;
      if (room.persistQueued) {
        room.persistQueued = false;
        this.scheduleRoomPersist(room);
      }
    }
  }

  private onMessage(context: RoomConnectionContext, connection: WebSocket, payload: RawData): void {
    try {
      const binaryPayload = toBinaryPayload(payload);
      const decoder = decoding.createDecoder(binaryPayload);
      const messageType = decoding.readVarUint(decoder);

      if (messageType === MESSAGE_SYNC) {
        const syncMessageType = decoding.readVarUint(decoder);

        if (!context.canWrite && syncMessageType !== syncProtocol.messageYjsSyncStep1) {
          return;
        }

        if (syncMessageType === syncProtocol.messageYjsSyncStep1) {
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, MESSAGE_SYNC);
          syncProtocol.readSyncStep1(decoder, encoder, context.room.doc);
          safeSend(connection, encoding.toUint8Array(encoder));
          return;
        }

        if (syncMessageType === syncProtocol.messageYjsSyncStep2) {
          syncProtocol.readSyncStep2(decoder, context.room.doc, connection);
          return;
        }

        if (syncMessageType === syncProtocol.messageYjsUpdate) {
          syncProtocol.readUpdate(decoder, context.room.doc, connection);
          return;
        }

        return;
      }

      if (messageType === MESSAGE_AWARENESS) {
        const awarenessUpdate = decoding.readVarUint8Array(decoder);
        awarenessProtocol.applyAwarenessUpdate(context.room.awareness, awarenessUpdate, connection);
        return;
      }

      if (messageType === MESSAGE_QUERY_AWARENESS) {
        const clients = Array.from(context.room.awareness.getStates().keys());
        if (clients.length === 0) {
          return;
        }

        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(context.room.awareness, clients));
        safeSend(connection, encoding.toUint8Array(encoder));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown collaboration message error";
      this.logger.warn(`Collaboration message rejected: ${message}`);
    }
  }

  private removeConnectionFromRoom(room: CollaborationRoom, connection: WebSocket): void {
    if (!room.connections.has(connection)) {
      return;
    }

    const controlledAwarenessIds = room.connections.get(connection);

    if (controlledAwarenessIds && controlledAwarenessIds.size > 0) {
      awarenessProtocol.removeAwarenessStates(room.awareness, Array.from(controlledAwarenessIds), connection);
    }

    room.connections.delete(connection);
    room.connectionUsers.delete(connection);

    if (room.connections.size === 0) {
      if (room.kind === "file") {
        const contentSnapshot = room.doc.getText(FILE_YDOC_TEXT_KEY).toString();
        void this.persistRoom(room, contentSnapshot);
      } else if (room.kind === "wiki-page") {
        const snapshot = this.wikiPageRoomSnapshot(room);
        void this.persistWikiPageRoom(room, snapshot);
      }
      room.teardown();
      this.rooms.delete(room.key);
    }
  }

  private onClose(context: RoomConnectionContext, connection: WebSocket): void {
    this.removeConnectionFromRoom(context.room, connection);
  }

  private sendInitialSync(room: CollaborationRoom, connection: WebSocket): void {
    const syncEncoder = encoding.createEncoder();
    encoding.writeVarUint(syncEncoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(syncEncoder, room.doc);
    safeSend(connection, encoding.toUint8Array(syncEncoder));

    const awarenessStates = Array.from(room.awareness.getStates().keys());
    if (awarenessStates.length > 0) {
      const awarenessEncoder = encoding.createEncoder();
      encoding.writeVarUint(awarenessEncoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(
        awarenessEncoder,
        awarenessProtocol.encodeAwarenessUpdate(room.awareness, awarenessStates)
      );
      safeSend(connection, encoding.toUint8Array(awarenessEncoder));
    }
  }
}

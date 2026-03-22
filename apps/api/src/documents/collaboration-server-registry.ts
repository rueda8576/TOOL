import { DocumentsCollaborationServer } from "./documents-collaboration.server";

let collaborationServer: DocumentsCollaborationServer | null = null;

export function setDocumentsCollaborationServer(server: DocumentsCollaborationServer): void {
  collaborationServer = server;
}

export function getDocumentsCollaborationServer(): DocumentsCollaborationServer | null {
  return collaborationServer;
}

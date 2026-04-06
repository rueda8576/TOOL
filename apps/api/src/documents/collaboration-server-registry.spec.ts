import { getDocumentsCollaborationServer, setDocumentsCollaborationServer } from "./collaboration-server-registry";

describe("collaboration-server-registry", () => {
  it("stores and returns the current collaboration server instance", () => {
    const server = { shutdown: jest.fn() } as any;

    setDocumentsCollaborationServer(server);

    expect(getDocumentsCollaborationServer()).toBe(server);
  });

  it("replaces the stored instance when a new server is registered", () => {
    const firstServer = { id: "first" } as any;
    const secondServer = { id: "second" } as any;

    setDocumentsCollaborationServer(firstServer);
    setDocumentsCollaborationServer(secondServer);

    expect(getDocumentsCollaborationServer()).toBe(secondServer);
  });
});

import { Prisma } from "@prisma/client";

import {
  WikiDocsRepositoriesService,
  WikiDocsRepositoryRecord
} from "./wiki-docs-repositories.service";

describe("WikiDocsRepositoriesService", () => {
  const makeService = () => {
    const prisma: any = {
      projectRepository: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn()
      }
    };
    return {
      service: new WikiDocsRepositoriesService(prisma),
      prisma
    };
  };

  const repository = (overrides: Partial<WikiDocsRepositoryRecord> = {}): WikiDocsRepositoryRecord => ({
    id: "repo-1",
    projectId: "project-1",
    name: "Research Repo",
    pathWithNamespace: "atlasium/research-repo",
    defaultBranch: "main",
    wikiDocsPrefix: null,
    wikiDocsLastSyncedAt: null,
    wikiDocsLastSyncError: null,
    ...overrides
  });

  it("returns repositories that already have a Docs prefix unchanged", async () => {
    const { service, prisma } = makeService();
    const existing = repository({ wikiDocsPrefix: "research-repo" });

    await expect(service.ensureRepositoryWikiDocsPrefix(existing)).resolves.toBe(existing);
    expect(prisma.projectRepository.findMany).not.toHaveBeenCalled();
    expect(prisma.projectRepository.update).not.toHaveBeenCalled();
  });

  it("generates a stable unique Docs prefix from repository name", async () => {
    const { service, prisma } = makeService();
    const updated = repository({ wikiDocsPrefix: "research-repo-2" });
    prisma.projectRepository.findMany.mockResolvedValue([{ wikiDocsPrefix: "research-repo" }]);
    prisma.projectRepository.update.mockResolvedValue(updated);

    await expect(service.ensureRepositoryWikiDocsPrefix(repository())).resolves.toEqual(updated);
    expect(prisma.projectRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "repo-1" },
        data: { wikiDocsPrefix: "research-repo-2" }
      })
    );
  });

  it("reloads the repository when prefix update loses a unique race", async () => {
    const { service, prisma } = makeService();
    const reloaded = repository({ wikiDocsPrefix: "research-repo" });
    prisma.projectRepository.findMany.mockResolvedValue([]);
    prisma.projectRepository.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test"
      })
    );
    prisma.projectRepository.findUnique.mockResolvedValue(reloaded);

    await expect(service.ensureRepositoryWikiDocsPrefix(repository())).resolves.toEqual(reloaded);
    expect(prisma.projectRepository.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "repo-1" } }));
  });

  it("ensures all repository prefixes in listed order", async () => {
    const { service, prisma } = makeService();
    const first = repository({ id: "repo-1", name: "A", wikiDocsPrefix: "a" });
    const second = repository({ id: "repo-2", name: "B", wikiDocsPrefix: null });
    const updatedSecond = { ...second, wikiDocsPrefix: "b" };
    prisma.projectRepository.findMany
      .mockResolvedValueOnce([first, second])
      .mockResolvedValueOnce([]);
    prisma.projectRepository.update.mockResolvedValue(updatedSecond);

    await expect(service.ensureAllRepositoryWikiDocsPrefixes("project-1")).resolves.toEqual([first, updatedSecond]);
  });
});

import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import { toWikiPathSegment } from "./wiki-paths";

export type WikiDocsRepositoryRecord = {
  id: string;
  projectId: string;
  name: string;
  pathWithNamespace: string;
  defaultBranch: string;
  wikiDocsPrefix: string | null;
  wikiDocsLastSyncedAt: Date | null;
  wikiDocsLastSyncError: string | null;
};

const wikiDocsRepositorySelect = {
  id: true,
  projectId: true,
  name: true,
  pathWithNamespace: true,
  defaultBranch: true,
  wikiDocsPrefix: true,
  wikiDocsLastSyncedAt: true,
  wikiDocsLastSyncError: true
} as const;

@Injectable()
export class WikiDocsRepositoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async listDocsRepositories(projectId: string): Promise<WikiDocsRepositoryRecord[]> {
    return this.prisma.projectRepository.findMany({
      where: {
        projectId
      },
      orderBy: [
        { name: "asc" },
        { pathWithNamespace: "asc" }
      ],
      select: wikiDocsRepositorySelect
    });
  }

  async ensureRepositoryWikiDocsPrefix(repository: WikiDocsRepositoryRecord): Promise<WikiDocsRepositoryRecord> {
    if (repository.wikiDocsPrefix) {
      return repository;
    }

    const rawBase = repository.name || repository.pathWithNamespace.split("/").pop() || "repository";
    const basePrefix = toWikiPathSegment(rawBase, "repository");
    const existingPrefixes = new Set(
      (
        await this.prisma.projectRepository.findMany({
          where: {
            projectId: repository.projectId,
            wikiDocsPrefix: {
              not: null
            }
          },
          select: {
            wikiDocsPrefix: true
          }
        })
      )
        .map((row) => row.wikiDocsPrefix)
        .filter((prefix): prefix is string => Boolean(prefix))
    );

    let candidate = basePrefix;
    let suffix = 2;
    while (existingPrefixes.has(candidate)) {
      candidate = `${basePrefix}-${suffix}`;
      suffix += 1;
    }

    try {
      return await this.prisma.projectRepository.update({
        where: {
          id: repository.id
        },
        data: {
          wikiDocsPrefix: candidate
        },
        select: wikiDocsRepositorySelect
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const reloaded = await this.prisma.projectRepository.findUnique({
          where: { id: repository.id },
          select: wikiDocsRepositorySelect
        });
        if (reloaded?.wikiDocsPrefix) {
          return reloaded;
        }
      }
      throw error;
    }
  }

  async ensureAllRepositoryWikiDocsPrefixes(projectId: string): Promise<WikiDocsRepositoryRecord[]> {
    const repositories = (await this.listDocsRepositories(projectId)) ?? [];
    const ensured: WikiDocsRepositoryRecord[] = [];
    for (const repository of repositories) {
      ensured.push(await this.ensureRepositoryWikiDocsPrefix(repository));
    }
    return ensured;
  }
}

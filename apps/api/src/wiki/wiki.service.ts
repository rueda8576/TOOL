import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";

import { AuditService } from "../audit/audit.service";
import { AuthenticatedUser } from "../common/authenticated-user";
import { ProjectAccessService } from "../common/project-access.service";
import { PrismaService } from "../prisma/prisma.service";
import { CreateWikiPageDto } from "./dto/create-wiki-page.dto";
import { UpdateWikiPageDto } from "./dto/update-wiki-page.dto";

@Injectable()
export class WikiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessService: ProjectAccessService,
    private readonly auditService: AuditService
  ) {}

  async createPage(projectId: string, dto: CreateWikiPageDto, user: AuthenticatedUser): Promise<{
    id: string;
    projectId: string;
    slug: string;
    title: string;
    revisionNumber: number;
  }> {
    await this.accessService.ensureProjectWritable(user.userId, user.globalRole, projectId);

    const existingSlug = await this.prisma.wikiPage.findUnique({
      where: { projectId_slug: { projectId, slug: dto.slug } },
      select: { id: true }
    });

    if (existingSlug) {
      throw new BadRequestException("Wiki slug already exists in this project");
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const page = await tx.wikiPage.create({
        data: {
          projectId,
          title: dto.title,
          slug: dto.slug,
          templateType: dto.templateType,
          createdById: user.userId
        },
        select: { id: true, projectId: true, slug: true, title: true }
      });

      const revision = await tx.wikiRevision.create({
        data: {
          pageId: page.id,
          revisionNumber: 1,
          contentMarkdown: dto.contentMarkdown,
          createdById: user.userId
        },
        select: { id: true, revisionNumber: true }
      });

      await tx.wikiPage.update({
        where: { id: page.id },
        data: {
          currentRevisionId: revision.id
        }
      });

      return {
        ...page,
        revisionNumber: revision.revisionNumber
      };
    });

    await this.auditService.log({
      userId: user.userId,
      projectId,
      entityType: "wiki_page",
      entityId: created.id,
      action: "wiki.page.create"
    });

    return created;
  }

  async updatePage(pageId: string, dto: UpdateWikiPageDto, user: AuthenticatedUser): Promise<{
    pageId: string;
    revisionNumber: number;
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

    const result = await this.prisma.$transaction(async (tx) => {
      const lastRevision = await tx.wikiRevision.findFirst({
        where: { pageId },
        orderBy: { revisionNumber: "desc" },
        select: { revisionNumber: true }
      });

      const revision = await tx.wikiRevision.create({
        data: {
          pageId,
          revisionNumber: (lastRevision?.revisionNumber ?? 0) + 1,
          contentMarkdown: dto.contentMarkdown,
          changeNote: dto.changeNote,
          createdById: user.userId
        },
        select: {
          id: true,
          revisionNumber: true
        }
      });

      await tx.wikiPage.update({
        where: { id: pageId },
        data: {
          title: dto.title,
          currentRevisionId: revision.id
        }
      });

      return {
        pageId,
        revisionNumber: revision.revisionNumber
      };
    });

    await this.auditService.log({
      userId: user.userId,
      projectId: page.projectId,
      entityType: "wiki_page",
      entityId: pageId,
      action: "wiki.page.update",
      metadata: {
        revisionNumber: result.revisionNumber
      }
    });

    return result;
  }

  async listRevisions(pageId: string, user: AuthenticatedUser): Promise<Array<{
    id: string;
    revisionNumber: number;
    createdAt: Date;
    createdBy: { id: string; name: string; email: string };
    changeNote: string | null;
  }>> {
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

    await this.accessService.ensureProjectReadable(user.userId, user.globalRole, page.projectId);

    return this.prisma.wikiRevision.findMany({
      where: { pageId },
      orderBy: { revisionNumber: "desc" },
      select: {
        id: true,
        revisionNumber: true,
        createdAt: true,
        changeNote: true,
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });
  }
}

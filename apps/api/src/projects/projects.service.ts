import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";

import { AuditService } from "../audit/audit.service";
import { AuthenticatedUser } from "../common/authenticated-user";
import { ProjectAccessService } from "../common/project-access.service";
import { PrismaService } from "../prisma/prisma.service";
import { AddProjectMemberDto } from "./dto/add-project-member.dto";
import { CreateProjectDto } from "./dto/create-project.dto";

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessService: ProjectAccessService,
    private readonly auditService: AuditService
  ) {}

  async createProject(dto: CreateProjectDto, user: AuthenticatedUser): Promise<{
    id: string;
    key: string;
    name: string;
    description: string | null;
  }> {
    if (user.globalRole === "reader") {
      throw new ForbiddenException("Reader role cannot create projects");
    }

    const key = dto.key.trim().toUpperCase();

    const existing = await this.prisma.project.findUnique({
      where: { key },
      select: { id: true }
    });

    if (existing) {
      throw new BadRequestException("Project key already exists");
    }

    const project = await this.prisma.project.create({
      data: {
        key,
        name: dto.name,
        description: dto.description,
        createdById: user.userId,
        members: {
          create: {
            userId: user.userId
          }
        }
      },
      select: {
        id: true,
        key: true,
        name: true,
        description: true
      }
    });

    await this.auditService.log({
      userId: user.userId,
      projectId: project.id,
      entityType: "project",
      entityId: project.id,
      action: "project.create"
    });

    return project;
  }

  async listProjects(user: AuthenticatedUser): Promise<Array<{
    id: string;
    key: string;
    name: string;
    description: string | null;
    createdAt: string;
    isPinned: boolean;
  }>> {
    const where = user.globalRole === "admin"
      ? { deletedAt: null }
      : {
          deletedAt: null,
          members: {
            some: {
              userId: user.userId
            }
          }
        };

    const projects = await this.prisma.project.findMany({
      where,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        key: true,
        name: true,
        description: true,
        createdAt: true,
        pinnedByUsers: {
          where: {
            userId: user.userId
          },
          select: {
            id: true
          }
        }
      }
    });

    return projects.map((project) => ({
      id: project.id,
      key: project.key,
      name: project.name,
      description: project.description,
      createdAt: project.createdAt.toISOString(),
      isPinned: project.pinnedByUsers.length > 0
    }));
  }

  async pinProject(projectId: string, user: AuthenticatedUser): Promise<{ projectId: string; pinned: true; pinnedAt: string }> {
    await this.accessService.ensureProjectReadable(user.userId, user.globalRole, projectId);

    const pinned = await this.prisma.userPinnedProject.upsert({
      where: {
        userId_projectId: {
          userId: user.userId,
          projectId
        }
      },
      create: {
        userId: user.userId,
        projectId
      },
      update: {},
      select: {
        projectId: true,
        createdAt: true
      }
    });

    await this.auditService.log({
      userId: user.userId,
      projectId,
      entityType: "project_pin",
      entityId: `${projectId}:${user.userId}`,
      action: "project.pin"
    });

    return {
      projectId: pinned.projectId,
      pinned: true,
      pinnedAt: pinned.createdAt.toISOString()
    };
  }

  async unpinProject(projectId: string, user: AuthenticatedUser): Promise<{ projectId: string; pinned: false }> {
    await this.accessService.ensureProjectReadable(user.userId, user.globalRole, projectId);

    await this.prisma.userPinnedProject.deleteMany({
      where: {
        userId: user.userId,
        projectId
      }
    });

    await this.auditService.log({
      userId: user.userId,
      projectId,
      entityType: "project_pin",
      entityId: `${projectId}:${user.userId}`,
      action: "project.unpin"
    });

    return {
      projectId,
      pinned: false
    };
  }

  async listMembers(projectId: string, user: AuthenticatedUser): Promise<Array<{ userId: string; name: string; email: string }>> {
    await this.accessService.ensureProjectReadable(user.userId, user.globalRole, projectId);

    const members = await this.prisma.projectMember.findMany({
      where: {
        projectId,
        user: {
          deletedAt: null
        }
      },
      orderBy: {
        createdAt: "asc"
      },
      select: {
        userId: true,
        user: {
          select: {
            name: true,
            email: true
          }
        }
      }
    });

    return members.map((member) => ({
      userId: member.userId,
      name: member.user.name,
      email: member.user.email
    }));
  }

  async addMember(projectId: string, dto: AddProjectMemberDto, user: AuthenticatedUser): Promise<{ projectId: string; userId: string }> {
    await this.accessService.ensureProjectWritable(user.userId, user.globalRole, projectId);

    const member = dto.userId
      ? await this.prisma.user.findUnique({ where: { id: dto.userId }, select: { id: true } })
      : await this.prisma.user.findUnique({ where: { email: dto.email?.toLowerCase() }, select: { id: true } });

    if (!member) {
      throw new NotFoundException("User not found");
    }

    const projectMember = await this.prisma.projectMember.upsert({
      where: {
        projectId_userId: {
          projectId,
          userId: member.id
        }
      },
      create: {
        projectId,
        userId: member.id
      },
      update: {},
      select: {
        projectId: true,
        userId: true
      }
    });

    await this.auditService.log({
      userId: user.userId,
      projectId,
      entityType: "project_member",
      entityId: `${projectId}:${member.id}`,
      action: "project.member.add"
    });

    return projectMember;
  }
}

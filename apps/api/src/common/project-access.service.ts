import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ProjectRole } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";

export type ProjectAccessContext = {
  isAdmin: boolean;
  projectRole: "admin" | "editor" | "reader";
  canWrite: boolean;
};

@Injectable()
export class ProjectAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async getProjectAccess(userId: string, role: string, projectId: string): Promise<ProjectAccessContext> {
    const exists = await this.prisma.project.findFirst({
      where: {
        id: projectId,
        deletedAt: null
      },
      select: { id: true }
    });

    if (!exists) {
      throw new NotFoundException("Project not found");
    }

    if (role === "admin") {
      return {
        isAdmin: true,
        projectRole: "admin",
        canWrite: true
      };
    }

    const membership = await this.prisma.projectMember.findUnique({
      where: {
        projectId_userId: {
          projectId,
          userId
        }
      },
      select: {
        role: true
      }
    });

    if (!membership) {
      throw new ForbiddenException("You are not assigned to this project");
    }

    const projectRole = membership.role === ProjectRole.EDITOR ? "editor" : "reader";
    return {
      isAdmin: false,
      projectRole,
      canWrite: projectRole === "editor"
    };
  }

  async ensureProjectReadable(userId: string, role: string, projectId: string): Promise<void> {
    await this.getProjectAccess(userId, role, projectId);
  }

  async ensureProjectWritable(userId: string, role: string, projectId: string): Promise<void> {
    const access = await this.getProjectAccess(userId, role, projectId);
    if (!access.canWrite) {
      throw new ForbiddenException("Reader role cannot modify project resources");
    }
  }
}

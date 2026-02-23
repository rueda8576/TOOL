import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class ProjectAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async ensureProjectReadable(userId: string, role: string, projectId: string): Promise<void> {
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
      return;
    }

    const membership = await this.prisma.projectMember.findUnique({
      where: {
        projectId_userId: {
          projectId,
          userId
        }
      },
      select: { id: true }
    });

    if (!membership) {
      throw new ForbiddenException("You are not assigned to this project");
    }
  }

  async ensureProjectWritable(userId: string, role: string, projectId: string): Promise<void> {
    await this.ensureProjectReadable(userId, role, projectId);
    if (role === "reader") {
      throw new ForbiddenException("Reader role cannot modify project resources");
    }
  }
}

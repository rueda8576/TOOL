import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(params: {
    userId?: string;
    projectId?: string;
    taskId?: string;
    entityType: string;
    entityId: string;
    action: string;
    metadata?: Prisma.JsonValue;
  }): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        userId: params.userId,
        projectId: params.projectId,
        taskId: params.taskId,
        entityType: params.entityType,
        entityId: params.entityId,
        action: params.action,
        metadata:
          params.metadata === undefined
            ? undefined
            : (params.metadata as Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput)
      }
    });
  }
}

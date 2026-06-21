import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";

import { AuditService } from "../audit/audit.service";
import { AuthenticatedUser } from "../common/authenticated-user";
import { ProjectAccessService } from "../common/project-access.service";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";

const WIKI_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const WIKI_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

export type WikiAssetUploadResult = {
  assetId: string;
  url: string;
  mimeType: string;
  sizeBytes: number;
  originalName: string;
};

export type WikiAssetContent = {
  buffer: Buffer;
  mimeType: string;
  fileName: string;
};

@Injectable()
export class WikiAssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessService: ProjectAccessService,
    private readonly auditService: AuditService,
    private readonly storageService: StorageService
  ) {}

  async uploadWikiAsset(
    projectId: string,
    file: Express.Multer.File | undefined,
    user: AuthenticatedUser
  ): Promise<WikiAssetUploadResult> {
    await this.accessService.ensureProjectWritable(user.userId, user.globalRole, projectId);

    if (!file) {
      throw new BadRequestException("Missing asset upload");
    }
    if (!WIKI_IMAGE_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException("Unsupported wiki image type");
    }
    if (file.size > WIKI_IMAGE_MAX_BYTES) {
      throw new BadRequestException(`Wiki image exceeds ${WIKI_IMAGE_MAX_BYTES} bytes`);
    }

    const savedFile = await this.storageService.saveUpload(file, user.userId);
    const fileObject = await this.prisma.fileObject.findUnique({
      where: {
        id: savedFile.id
      },
      select: {
        id: true,
        mimeType: true,
        sizeBytes: true,
        originalName: true
      }
    });

    if (!fileObject) {
      throw new NotFoundException("Uploaded file metadata not found");
    }

    const asset = await this.prisma.wikiAsset.create({
      data: {
        projectId,
        fileObjectId: fileObject.id,
        uploadedById: user.userId
      },
      select: {
        id: true
      }
    });

    await this.auditService.log({
      userId: user.userId,
      projectId,
      entityType: "wiki_asset",
      entityId: asset.id,
      action: "wiki.asset.upload"
    });

    return {
      assetId: asset.id,
      url: `/wiki-assets/${asset.id}/content`,
      mimeType: fileObject.mimeType,
      sizeBytes: Number(fileObject.sizeBytes),
      originalName: fileObject.originalName
    };
  }

  async getWikiAssetContent(assetId: string, user: AuthenticatedUser): Promise<WikiAssetContent> {
    const asset = await this.prisma.wikiAsset.findFirst({
      where: {
        id: assetId
      },
      select: {
        id: true,
        projectId: true,
        fileObject: {
          select: {
            storagePath: true,
            mimeType: true,
            originalName: true
          }
        }
      }
    });

    if (!asset) {
      throw new NotFoundException("Wiki asset not found");
    }

    await this.accessService.ensureProjectReadable(user.userId, user.globalRole, asset.projectId);
    const buffer = await this.storageService.readObject(asset.fileObject.storagePath);

    return {
      buffer,
      mimeType: asset.fileObject.mimeType,
      fileName: asset.fileObject.originalName
    };
  }
}

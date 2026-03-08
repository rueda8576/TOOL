import { BadRequestException, Injectable, InternalServerErrorException } from "@nestjs/common";
import { createHash, randomUUID } from "crypto";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import { join } from "path";

import { getEnv } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class StorageService {
  private readonly storageRoot = getEnv().STORAGE_ROOT;
  private readonly maxUploadSizeBytes = getEnv().PDF_UPLOAD_LIMIT_BYTES;

  constructor(private readonly prisma: PrismaService) {}

  async saveUpload(file: Express.Multer.File, uploadedById?: string): Promise<{ id: string; storagePath: string }> {
    if (!file) {
      throw new BadRequestException("Missing file upload");
    }

    if (file.size > this.maxUploadSizeBytes) {
      throw new BadRequestException(`File size exceeds ${this.maxUploadSizeBytes} bytes`);
    }

    const normalizedName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    const objectKey = `${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${normalizedName}`;
    const absolutePath = join(this.storageRoot, objectKey);

    const buffer = file.buffer && file.buffer.length > 0 ? file.buffer : await readFile(file.path);

    await mkdir(join(this.storageRoot, new Date().toISOString().slice(0, 10)), { recursive: true });
    await writeFile(absolutePath, buffer);

    if (file.path) {
      await rm(file.path, { force: true });
    }

    const checksum = createHash("sha256").update(buffer).digest("hex");

    const saved = await this.prisma.fileObject.create({
      data: {
        storagePath: objectKey,
        originalName: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: BigInt(file.size),
        checksum,
        uploadedById
      },
      select: {
        id: true,
        storagePath: true
      }
    });

    return saved;
  }

  async saveBuffer(params: {
    buffer: Buffer;
    fileName: string;
    mimeType: string;
    uploadedById?: string;
  }): Promise<{ id: string; storagePath: string }> {
    if (params.buffer.byteLength > this.maxUploadSizeBytes) {
      throw new BadRequestException(`File size exceeds ${this.maxUploadSizeBytes} bytes`);
    }

    const normalizedName = params.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const objectKey = `${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${normalizedName}`;
    const absolutePath = join(this.storageRoot, objectKey);

    await mkdir(join(this.storageRoot, new Date().toISOString().slice(0, 10)), { recursive: true });
    await writeFile(absolutePath, params.buffer);

    const checksum = createHash("sha256").update(params.buffer).digest("hex");

    const saved = await this.prisma.fileObject.create({
      data: {
        storagePath: objectKey,
        originalName: params.fileName,
        mimeType: params.mimeType,
        sizeBytes: BigInt(params.buffer.byteLength),
        checksum,
        uploadedById: params.uploadedById
      },
      select: {
        id: true,
        storagePath: true
      }
    });

    return saved;
  }

  async readObject(storagePath: string): Promise<Buffer> {
    try {
      return await readFile(join(this.storageRoot, storagePath));
    } catch {
      throw new InternalServerErrorException("Stored file is unavailable");
    }
  }
}

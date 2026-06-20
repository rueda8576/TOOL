import { PrismaClient } from "@prisma/client";

declare global {
  var __prismaClient: PrismaClient | undefined;
}

export const prisma = global.__prismaClient ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  global.__prismaClient = prisma;
}

import "../config/load-env";
import { PrismaClient, GlobalRole } from "@prisma/client";
import bcrypt from "bcryptjs";

async function main(): Promise<void> {
  const prisma = new PrismaClient();

  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME ?? "Platform Admin";

  if (!email || !password) {
    throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD are required");
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const user = await prisma.user.upsert({
    where: { email: email.toLowerCase() },
    create: {
      email: email.toLowerCase(),
      name,
      passwordHash,
      globalRole: GlobalRole.ADMIN
    },
    update: {
      name,
      passwordHash,
      globalRole: GlobalRole.ADMIN,
      isActive: true,
      deletedAt: null
    },
    select: {
      id: true,
      email: true,
      globalRole: true
    }
  });

  await prisma.notificationPreference.upsert({
    where: { userId: user.id },
    create: { userId: user.id },
    update: {}
  });

  await prisma.$disconnect();

  console.log(`Admin seeded: ${user.email} (${user.globalRole})`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

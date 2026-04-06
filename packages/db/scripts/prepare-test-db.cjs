const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const { PrismaClient } = require("@prisma/client");

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const schemaPath = path.resolve(__dirname, "..", "prisma", "schema.prisma");
const migrationsDir = path.resolve(__dirname, "..", "prisma", "migrations");
const prismaCliPath = require.resolve("prisma/build/index.js", {
  paths: [path.resolve(__dirname, "..")]
});

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/doctoral_platform_test?schema=public";
}

const runPrisma = (args) => {
  const result = spawnSync(process.execPath, [prismaCliPath, ...args, "--schema", schemaPath], {
    cwd: repoRoot,
    env: process.env,
    stdio: "inherit"
  });

  if (result.status !== 0) {
    throw new Error(`Prisma command failed: prisma ${args.join(" ")}`);
  }
};

const listMigrationNames = () =>
  fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

async function main() {
  const prisma = new PrismaClient();
  let hasTable = false;
  let finishedCount = 0;
  let failedMigrationNames = [];

  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT to_regclass('public._prisma_migrations')::text AS table_name`
    );
    hasTable = Boolean(rows[0]?.table_name);

    if (hasTable) {
      const counts = await prisma.$queryRawUnsafe(`
        SELECT
          COUNT(*) FILTER (WHERE finished_at IS NOT NULL)::int AS finished_count,
          COUNT(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL)::int AS failed_count
        FROM public._prisma_migrations
      `);

      finishedCount = counts[0]?.finished_count ?? 0;
      const failedCount = counts[0]?.failed_count ?? 0;

      if (failedCount > 0) {
        const failedRows = await prisma.$queryRawUnsafe(`
          SELECT migration_name
          FROM public._prisma_migrations
          WHERE finished_at IS NULL AND rolled_back_at IS NULL
          ORDER BY started_at
        `);
        failedMigrationNames = failedRows
          .map((row) => row.migration_name)
          .filter((name) => typeof name === "string" && name.length > 0);
      }
    }

    if (hasTable && finishedCount === 0) {
      console.log("Prisma migrations table exists without a successful baseline. Clearing stale rows...");
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE public._prisma_migrations`);
      failedMigrationNames = [];
    }
  } finally {
    await prisma.$disconnect();
  }

  if (failedMigrationNames.length > 0) {
    console.log(`Resolving ${failedMigrationNames.length} failed Prisma migration record(s) as rolled back...`);
    for (const migrationName of failedMigrationNames) {
      runPrisma(["migrate", "resolve", "--rolled-back", migrationName]);
    }
  }

  if (!hasTable || finishedCount === 0) {
    console.log("Fresh DB detected. Bootstrapping schema baseline before migrate deploy...");
    runPrisma(["db", "push", "--skip-generate"]);
    for (const migrationName of listMigrationNames()) {
      runPrisma(["migrate", "resolve", "--applied", migrationName]);
    }
  } else {
    console.log("Existing Prisma baseline detected. Skipping bootstrap.");
  }

  console.log("Running prisma migrate deploy...");
  runPrisma(["migrate", "deploy"]);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

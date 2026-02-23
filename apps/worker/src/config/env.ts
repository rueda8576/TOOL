import { z } from "zod";

const EnvSchema = z.object({
  DATABASE_URL: z
    .string()
    .min(1)
    .default("postgresql://postgres:postgres@localhost:5432/doctoral_platform?schema=public"),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  STORAGE_ROOT: z.string().default("./storage"),
  LATEX_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  SMTP_HOST: z.string().default("localhost"),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default("no-reply@example.com"),
  BACKUP_RETENTION_DAYS: z.coerce.number().int().positive().default(30)
});

export type WorkerEnv = z.infer<typeof EnvSchema>;

let envCache: WorkerEnv | null = null;

export const getEnv = (): WorkerEnv => {
  if (envCache) {
    return envCache;
  }

  envCache = EnvSchema.parse(process.env);
  return envCache;
};

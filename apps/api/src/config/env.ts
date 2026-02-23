import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z
    .string()
    .min(1)
    .default("postgresql://postgres:postgres@localhost:5432/doctoral_platform?schema=public"),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  JWT_SECRET: z.string().min(16).default("change-me-in-production"),
  API_PORT: z.coerce.number().int().default(4000),
  STORAGE_ROOT: z.string().default("./storage"),
  PDF_UPLOAD_LIMIT_BYTES: z.coerce.number().int().positive().default(1_073_741_824),
  LATEX_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000)
});

export type AppEnv = z.infer<typeof EnvSchema>;

let cachedEnv: AppEnv | null = null;

export const getEnv = (): AppEnv => {
  if (cachedEnv) {
    return cachedEnv;
  }

  cachedEnv = EnvSchema.parse(process.env);
  return cachedEnv;
};

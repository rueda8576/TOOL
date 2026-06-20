import { z } from "zod";

const optionalNonEmptyString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional()
);

const explicitBoolean = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.enum(["true", "false"]).optional()
).transform((value) => value === "true");

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z
    .string()
    .min(1)
    .default("postgresql://postgres:postgres@localhost:5432/doctoral_platform?schema=public"),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  JWT_SECRET: z.string().min(16).default("change-me-in-production"),
  WORKER_HEALTH_PORT: z.coerce.number().int().min(0).default(4100),
  STORAGE_ROOT: z.string().default("./storage"),
  LATEX_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  SMTP_HOST: z.string().default("localhost"),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default("no-reply@example.com"),
  BACKUP_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  OPENAI_API_KEY: optionalNonEmptyString,
  OPENAI_MODEL: optionalNonEmptyString,
  OPENAI_BASE_URL: z.preprocess((value) => (value === "" ? undefined : value), z.string().url().optional()),
  OPENAI_TIMEOUT_MS: z.coerce.number().int().positive().default(45_000),
  AI_MAX_INPUT_CHARS: z.coerce.number().int().positive().default(50_000),
  AI_MEETING_AUTOMATION_ENABLED: explicitBoolean
}).superRefine((env, context) => {
  if (env.NODE_ENV !== "production" || !env.AI_MEETING_AUTOMATION_ENABLED) {
    return;
  }

  if (!env.OPENAI_API_KEY) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["OPENAI_API_KEY"],
      message: "OPENAI_API_KEY is required when meeting automation is enabled in production"
    });
  }

  if (!env.OPENAI_MODEL) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["OPENAI_MODEL"],
      message: "OPENAI_MODEL is required when meeting automation is enabled in production"
    });
  }
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

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
  APP_BASE_URL: z.string().url().default("http://localhost:3000"),
  GITLAB_BASE_URL: z.string().url().optional(),
  GITLAB_EXTERNAL_URL: z.string().url().optional(),
  GITLAB_OAUTH_CLIENT_ID: z.string().optional(),
  GITLAB_OAUTH_CLIENT_SECRET: z.string().optional(),
  GITLAB_DEFAULT_NAMESPACE_ID: z.string().optional(),
  GITLAB_OAUTH_REDIRECT_URI: z.string().url().optional(),
  GITLAB_SYSTEM_ACCESS_TOKEN: z.string().optional(),
  GITLAB_SYSTEM_USER_ID: z.string().optional(),
  GITLAB_MANAGED_GROUP_ID: z.string().optional(),
  GITLAB_MANAGED_GROUP_PATH: z.string().optional(),
  GITLAB_MANAGED_GROUP_NAME: z.string().optional(),
  ATLASIUM_OIDC_CLIENT_ID: z.string().optional(),
  ATLASIUM_OIDC_CLIENT_SECRET: z.string().optional(),
  ATLASIUM_OIDC_PRIVATE_KEY_BASE64: z.string().optional(),
  ATLASIUM_SESSION_COOKIE_NAME: z.string().default("atlasium_session"),
  COLLAB_ALLOW_QUERY_TOKEN: explicitBoolean,
  API_PORT: z.coerce.number().int().default(4000),
  STORAGE_ROOT: z.string().default("./storage"),
  PDF_UPLOAD_LIMIT_BYTES: z.coerce.number().int().positive().default(1_073_741_824),
  LATEX_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  OPENAI_API_KEY: optionalNonEmptyString,
  OPENAI_MODEL: optionalNonEmptyString,
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

export type AppEnv = z.infer<typeof EnvSchema>;

let cachedEnv: AppEnv | null = null;

export const getEnv = (): AppEnv => {
  if (cachedEnv) {
    return cachedEnv;
  }

  cachedEnv = EnvSchema.parse(process.env);
  return cachedEnv;
};

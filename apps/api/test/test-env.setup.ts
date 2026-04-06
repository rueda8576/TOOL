process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "integration-secret-123";
process.env.APP_BASE_URL = process.env.APP_BASE_URL || "http://localhost:3000";
process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
process.env.STORAGE_ROOT = process.env.STORAGE_ROOT || "./storage";
process.env.DATABASE_URL =
  process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/doctoral_platform_test?schema=public";

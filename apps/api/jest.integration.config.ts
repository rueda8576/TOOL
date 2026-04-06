import type { Config } from "jest";

const config: Config = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/test"],
  moduleFileExtensions: ["ts", "js", "json"],
  testRegex: ".*\\.e2e-spec\\.ts$",
  setupFiles: ["<rootDir>/test/test-env.setup.ts"],
  testTimeout: 30000
};

export default config;

import type { Config } from "jest";

const coverageTargets = [
  "<rootDir>/src/**/*.ts",
  "!<rootDir>/src/**/*.spec.ts",
  "!<rootDir>/src/**/*.module.ts",
  "!<rootDir>/src/main.ts",
  "!<rootDir>/src/scripts/**",
  "!<rootDir>/src/**/*.types.ts",
  "!<rootDir>/src/**/*.decorator.ts",
  "!<rootDir>/src/config/load-env.ts",
  "!<rootDir>/src/common/authenticated-user.ts"
];

const config: Config = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/test"],
  moduleFileExtensions: ["ts", "js", "json"],
  testRegex: ".*\\.e2e-spec\\.ts$",
  setupFiles: ["<rootDir>/test/test-env.setup.ts"],
  testTimeout: 30000,
  collectCoverageFrom: coverageTargets
};

export default config;

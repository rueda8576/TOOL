import type { Config } from "jest";

const config: Config = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  moduleFileExtensions: ["ts", "js", "json"],
  testRegex: ".*\\.spec\\.ts$",
  collectCoverageFrom: [
    "<rootDir>/src/**/*.ts",
    "!<rootDir>/src/**/*.spec.ts",
    "!<rootDir>/src/main.ts",
    "!<rootDir>/src/config/load-env.ts"
  ],
  coverageDirectory: "<rootDir>/coverage",
  coverageReporters: ["text-summary", "json-summary", "lcov", "json"]
};

export default config;

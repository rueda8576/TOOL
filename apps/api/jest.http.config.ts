import type { Config } from "jest";

const config: Config = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/test/http"],
  moduleFileExtensions: ["ts", "js", "json"],
  testRegex: ".*\\.http\\.spec\\.ts$"
};

export default config;

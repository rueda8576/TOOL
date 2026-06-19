import { execFileSync } from "node:child_process";

const trackedFiles = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean)
  .map((filePath) => filePath.replaceAll("\\", "/"));

const exactGeneratedFiles = new Set([
  "apps/api/test/api-smoke.e2e-spec.d.ts",
  "apps/api/test/api-smoke.e2e-spec.js",
  "apps/api/test/api-smoke.e2e-spec.js.map",
  "apps/web/tsconfig.tsbuildinfo"
]);

function isForbiddenTrackedFile(filePath) {
  if (exactGeneratedFiles.has(filePath)) {
    return true;
  }

  if (filePath.endsWith(".tsbuildinfo")) {
    return true;
  }

  const segments = filePath.split("/");
  if (segments.includes("dist") || segments.includes(".next") || segments.includes("coverage")) {
    return true;
  }

  return (
    filePath === "storage" ||
    filePath.startsWith("storage/") ||
    filePath === "tmp" ||
    filePath.startsWith("tmp/") ||
    filePath.startsWith("apps/api/storage/") ||
    filePath.startsWith("apps/worker/storage/")
  );
}

const violations = trackedFiles.filter(isForbiddenTrackedFile);

if (violations.length > 0) {
  console.error("Generated/runtime files are tracked and must be removed from the index:");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log("Repo hygiene check passed.");

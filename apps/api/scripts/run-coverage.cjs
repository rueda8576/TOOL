const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { createCoverageMap } = require("istanbul-lib-coverage");
const libReport = require("istanbul-lib-report");
const reports = require("istanbul-reports");

const rootDir = path.resolve(__dirname, "..");
const coverageDir = path.join(rootDir, "coverage");
const pnpmBin = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const thresholdArg = process.argv.find((arg) => arg.startsWith("--threshold="));
const threshold = thresholdArg ? Number(thresholdArg.split("=")[1]) : null;

const suites = [
  { name: "unit", config: "jest.config.ts" },
  { name: "http", config: "jest.http.config.ts" },
  { name: "integration", config: "jest.integration.config.ts" }
];

const ensureCleanDirectory = (targetPath) => {
  fs.rmSync(targetPath, { recursive: true, force: true });
  fs.mkdirSync(targetPath, { recursive: true });
};

const runSuiteCoverage = (suite) => {
  const suiteCoverageDir = path.join(coverageDir, suite.name);
  ensureCleanDirectory(suiteCoverageDir);

  execFileSync(
    pnpmBin,
    [
      "exec",
      "jest",
      "--config",
      suite.config,
      "--runInBand",
      "--coverage",
      "--coverageDirectory",
      suiteCoverageDir,
      "--coverageReporters=json"
    ],
    {
      cwd: rootDir,
      stdio: "inherit",
      env: process.env
    }
  );
};

const mergeCoverage = () => {
  const coverageMap = createCoverageMap({});

  for (const suite of suites) {
    const coverageFile = path.join(coverageDir, suite.name, "coverage-final.json");
    if (!fs.existsSync(coverageFile)) {
      throw new Error(`Missing coverage artifact for suite ${suite.name}: ${coverageFile}`);
    }

    coverageMap.merge(JSON.parse(fs.readFileSync(coverageFile, "utf8")));
  }

  fs.writeFileSync(
    path.join(coverageDir, "coverage-final.json"),
    JSON.stringify(coverageMap.toJSON()),
    "utf8"
  );

  const context = libReport.createContext({
    dir: coverageDir,
    coverageMap,
    defaultSummarizer: "flat"
  });

  reports.create("json-summary").execute(context);
  reports.create("lcov").execute(context);
  reports.create("text-summary").execute(context);

  return JSON.parse(fs.readFileSync(path.join(coverageDir, "coverage-summary.json"), "utf8"));
};

const assertThreshold = (summary) => {
  if (threshold === null) {
    return;
  }

  const metrics = ["statements", "branches", "functions", "lines"];
  const failures = metrics.filter((metric) => summary.total[metric].pct < threshold);

  if (failures.length === 0) {
    return;
  }

  const details = failures
    .map((metric) => `${metric}=${summary.total[metric].pct}% < ${threshold}%`)
    .join(", ");

  throw new Error(`API coverage gate failed: ${details}`);
};

ensureCleanDirectory(coverageDir);
for (const suite of suites) {
  runSuiteCoverage(suite);
}
const summary = mergeCoverage();
assertThreshold(summary);

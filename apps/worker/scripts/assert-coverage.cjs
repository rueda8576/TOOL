const fs = require("fs");
const path = require("path");

const summaryPath = path.join(__dirname, "..", "coverage", "coverage-summary.json");
const thresholdArg = process.argv.find((arg) => arg.startsWith("--threshold="));
const threshold = thresholdArg ? Number(thresholdArg.split("=")[1]) : null;

if (threshold === null || Number.isNaN(threshold)) {
  throw new Error("Worker coverage gate requires --threshold=<number>");
}

if (!fs.existsSync(summaryPath)) {
  throw new Error(`Missing worker coverage summary at ${summaryPath}`);
}

const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
const metrics = ["statements", "branches", "functions", "lines"];
const failures = metrics.filter((metric) => summary.total[metric].pct < threshold);

if (failures.length === 0) {
  process.exit(0);
}

const details = failures
  .map((metric) => `${metric}=${summary.total[metric].pct}% < ${threshold}%`)
  .join(", ");

throw new Error(`Worker coverage gate failed: ${details}`);

import { mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import { normalizeContainedRelativePath, resolveContainedPath } from "./path-confinement";

describe("path confinement", () => {
  it("resolves relative paths inside the configured root", async () => {
    const root = await mkdtemp(join(tmpdir(), "atlasium-path-"));

    expect(resolveContainedPath(root, "workspace/main.tex")).toBe(join(root, "workspace/main.tex"));
    expect(normalizeContainedRelativePath("/workspace\\main.tex")).toBe("workspace/main.tex");
  });

  it("rejects empty, absolute, and traversal paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "atlasium-path-"));

    expect(() => resolveContainedPath(root, "")).toThrow("Invalid path");
    expect(() => resolveContainedPath(root, "/etc/passwd")).toThrow("Invalid path");
    expect(() => resolveContainedPath(root, "../escape")).toThrow("Invalid path");
    expect(() => normalizeContainedRelativePath("../escape")).toThrow("Invalid path");
  });
});

import {
  buildRepositoryArchiveFileName,
  buildRepositoryRawFileName,
  detectRepositoryFileContentType,
  isBinaryBuffer,
  isDocsMarkdownPath
} from "./gitlab-format";

describe("GitLab format helpers", () => {
  it("builds stable archive and raw file names", () => {
    expect(buildRepositoryArchiveFileName("/atlasium/nav/", "feature/nav")).toBe("atlasium-nav-feature-nav.zip");
    expect(buildRepositoryArchiveFileName(" ", " ")).toBe("repository-archive.zip");
    expect(buildRepositoryRawFileName("Docs/Research/Guide.md")).toBe("Guide.md");
    expect(buildRepositoryRawFileName("bad\r\n\"name.md")).toBe("bad---name.md");
    expect(buildRepositoryRawFileName("")).toBe("repository-file");
  });

  it("detects previewable image content types from paths", () => {
    expect(detectRepositoryFileContentType("image.PNG")).toBe("image/png");
    expect(detectRepositoryFileContentType("photo.jpeg")).toBe("image/jpeg");
    expect(detectRepositoryFileContentType("diagram.svg")).toBeNull();
    expect(detectRepositoryFileContentType("README.md")).toBeNull();
  });

  it("detects binary buffers using the existing threshold", () => {
    expect(isBinaryBuffer(Buffer.alloc(0))).toBe(false);
    expect(isBinaryBuffer(Buffer.from("plain text\n"))).toBe(false);
    expect(isBinaryBuffer(Buffer.from([0x41, 0x00, 0x42]))).toBe(true);
    expect(isBinaryBuffer(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]))).toBe(true);
  });

  it("matches Markdown files under the repo Docs root", () => {
    expect(isDocsMarkdownPath("Docs/Research/index.md")).toBe(true);
    expect(isDocsMarkdownPath("Docs\\Implementation\\guide.markdown")).toBe(true);
    expect(isDocsMarkdownPath("docs/Research/index.md")).toBe(false);
    expect(isDocsMarkdownPath("Docs/Research/image.png")).toBe(false);
    expect(isDocsMarkdownPath("Other/Docs/Research/index.md")).toBe(false);
  });
});

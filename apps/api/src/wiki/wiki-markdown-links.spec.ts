import {
  isExternalMarkdownTarget,
  parseMarkdownRelativeWikiLinks,
  parseWikiLinks,
  resolveRelativeDocsPath
} from "./wiki-markdown-links";

describe("wiki markdown link helpers", () => {
  it("detects external or non-repository markdown targets", () => {
    expect(isExternalMarkdownTarget("https://example.com")).toBe(true);
    expect(isExternalMarkdownTarget("mailto:team@example.com")).toBe(true);
    expect(isExternalMarkdownTarget("#local")).toBe(true);
    expect(isExternalMarkdownTarget("/absolute.md")).toBe(true);
    expect(isExternalMarkdownTarget("../guide.md")).toBe(false);
  });

  it("resolves relative Docs paths without changing existing filtering", () => {
    expect(resolveRelativeDocsPath("Docs/Research/backend/index.md", "../intro.md#heading")).toBe("Docs/Research/intro.md");
    expect(resolveRelativeDocsPath("Docs/Research/backend/index.md", "./deep/API%20Reference.markdown?x=1")).toBe(
      "Docs/Research/backend/deep/API Reference.markdown"
    );
    expect(resolveRelativeDocsPath("Docs/Research/index.md", "../../escape.md")).toBe("escape.md");
    expect(resolveRelativeDocsPath("Docs/Research/index.md", "../image.png")).toBe(null);
    expect(resolveRelativeDocsPath("Docs/Research/index.md", "https://example.com/guide.md")).toBe(null);
  });

  it("parses markdown links into Wiki paths only when a Docs source is present", () => {
    const markdown = "[Intro](../intro.md#top) ![Image](../image.md) [External](https://example.com/x.md)";
    expect(parseMarkdownRelativeWikiLinks(markdown)).toEqual([]);
    expect(parseMarkdownRelativeWikiLinks(markdown, { prefix: "repo", docsPath: "Docs/Research/backend/index.md" })).toEqual([
      "research/repo/intro"
    ]);
  });

  it("parses wiki links and deduplicates markdown-derived links", () => {
    const markdown = "[[guides/roadmap]] [[bad path]] [[guides\\notes]] [[guides/roadmap]] [Intro](../intro.md)";
    expect(parseWikiLinks(markdown, { prefix: "repo", docsPath: "Docs/Research/backend/index.md" })).toEqual([
      "guides/roadmap",
      "guides/notes",
      "research/repo/intro"
    ]);
  });
});

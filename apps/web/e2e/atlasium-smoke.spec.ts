import { expect, test, type Locator } from "@playwright/test";

import { expectAtlasiumBrand, expectNoDecorativeBrandDrift, expectNoHorizontalOverflow, waitForAtlasiumRouteReady } from "./support/assertions";
import { installMockApi, seedSession } from "./support/mock-api";

const authenticatedRoutes = [
  { path: "/projects", heading: "Projects" },
  { path: "/projects/project-1", heading: "Atlasium Research Archive" },
  { path: "/projects/project-1/wiki", heading: "Research Index" },
  { path: "/projects/project-1/documents", heading: "Documents" },
  { path: "/projects/project-1/documents/document-1", heading: "Field Study Protocol" },
  { path: "/projects/project-1/code", heading: "Code" },
  { path: "/projects/project-1/tasks", heading: "Tasks" },
  { path: "/projects/project-1/meetings", heading: "Meetings" },
  { path: "/account", heading: "Account" }
];

async function wordPointIn(locator: Locator, word: string, occurrenceIndex = 0): Promise<{ x: number; y: number }> {
  const point = await locator.evaluate(
    (root, options) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let currentNode = walker.nextNode();
      let seen = 0;
      while (currentNode) {
        const text = currentNode.textContent ?? "";
        let index = text.indexOf(options.word);
        while (index >= 0) {
          if (seen === options.occurrenceIndex) {
            const range = document.createRange();
            range.setStart(currentNode, index);
            range.setEnd(currentNode, index + options.word.length);
            const rect = range.getBoundingClientRect();
            return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
          }
          seen += 1;
          index = text.indexOf(options.word, index + options.word.length);
        }
        currentNode = walker.nextNode();
      }
      return null;
    },
    { word, occurrenceIndex }
  );
  expect(point).not.toBeNull();
  if (!point) {
    throw new Error(`Unable to find "${word}" in locator text.`);
  }
  return point;
}

test.beforeEach(async ({ page }) => {
  await installMockApi(page);
});

test("@e2e public auth surfaces render Atlasium operational copy", async ({ page }) => {
  for (const path of ["/", "/login", "/forgot-password", "/reset-password?token=qa-reset", "/accept-invite?token=qa-invite"]) {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await waitForAtlasiumRouteReady(page, path);
    await expectAtlasiumBrand(page);
    await expectNoDecorativeBrandDrift(page);
    await expectNoHorizontalOverflow(page);
  }
});

test("@e2e authenticated modules render from mocked API fixtures", async ({ page }) => {
  await seedSession(page, "admin");

  for (const route of authenticatedRoutes) {
    await page.goto(route.path, { waitUntil: "domcontentloaded" });
    await waitForAtlasiumRouteReady(page, route.path);
    await expect(page.getByText(route.heading).first()).toBeVisible();
    await expectAtlasiumBrand(page);
    await expectNoDecorativeBrandDrift(page);
    await expectNoHorizontalOverflow(page);
  }
});

test("@e2e admin operations ledger renders backup evidence without restore controls", async ({ page }) => {
  await seedSession(page, "admin");
  await page.goto("/projects", { waitUntil: "domcontentloaded" });

  await page.getByRole("button", { name: "Operations" }).click();

  await expect(page.getByRole("heading", { name: "Operations ledger" })).toBeVisible();
  await expect(page.getByText("Backup operations")).toBeVisible();
  await expect(page.getByText("backup-1")).toBeVisible();
  await expect(page.getByText("DB SHA 1234567890ab")).toBeVisible();
  await expect(page.getByRole("button", { name: "Run backup" })).toBeVisible();
  await expect(page.getByRole("button", { name: /restore/i })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test("@e2e project directory row renders access metadata and actions", async ({ page }) => {
  await seedSession(page, "admin");
  await page.goto("/projects", { waitUntil: "domcontentloaded" });

  await expect(page.getByText("ATLS Atlasium Research Archive")).toBeVisible();
  await expect(page.getByText("Pinned in directory")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Unpin" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("@e2e document detail collaborator strip renders realtime state", async ({ page }) => {
  await seedSession(page, "admin");
  await page.goto("/projects/project-1/documents/document-1", { waitUntil: "domcontentloaded" });

  const collaborators = page.getByLabel("Collaborators in this document");
  await expect(collaborators).toBeVisible();
  await expect(collaborators.getByText("Offline")).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("@e2e wiki markdown toolbar renders editor formatting controls", async ({ page }) => {
  await seedSession(page, "admin");
  await page.goto("/projects/project-1/wiki/home", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "Archive Home", level: 2 })).toBeVisible();
  await page.getByRole("button", { name: "Edit" }).click();
  await expect(page.getByRole("toolbar", { name: "Markdown formatting toolbar" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Bold (Ctrl/Cmd+B)" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Link (Ctrl/Cmd+K)" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("@e2e wiki editor and preview cross-highlight double-clicked words", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await seedSession(page, "admin");
  await page.goto("/projects/project-1/wiki/home", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "Archive Home", level: 2 })).toBeVisible();
  const readArticle = page.locator(".wiki-read-view .wiki-markdown");
  const readWordPoint = await wordPointIn(readArticle.locator("p").first(), "Atlasium");
  await page.mouse.click(readWordPoint.x, readWordPoint.y);
  await expect(readArticle.locator(".wiki-word-highlight")).toHaveCount(0);

  await page.getByRole("button", { name: "Edit" }).click();

  const textarea = page.locator(".wiki-editor-textarea");
  const previewArticle = page.locator(".wiki-preview-panel .wiki-markdown");
  await expect(textarea).toBeVisible();
  await textarea.click();
  await expect(previewArticle.locator(".wiki-word-highlight")).toHaveCount(0);

  const previewWordPoint = await wordPointIn(previewArticle.locator("p").first(), "Atlasium");
  await page.mouse.click(previewWordPoint.x, previewWordPoint.y);
  await expect(previewArticle.locator(".wiki-word-highlight")).toHaveCount(0);

  const longMarkdown = [
    "# Archive Home",
    "",
    "Opening Atlasium reference stays near the top of the page.",
    "",
    ...Array.from({ length: 34 }, (_, index) => `Paragraph ${String(index + 1).padStart(2, "0")} keeps project knowledge traceable across modules.`),
    "",
    "Final Atlasium anchor proves the selected occurrence is centered across the editor and preview.",
    "",
    ...Array.from({ length: 10 }, (_, index) => `Tail paragraph ${String(index + 1).padStart(2, "0")} leaves enough paper below the target for centered scrolling.`)
  ].join("\n\n");
  await textarea.fill(longMarkdown);

  await textarea.evaluate((node: HTMLTextAreaElement) => {
    const index = node.value.lastIndexOf("Atlasium");
    node.focus();
    node.setSelectionRange(index, index + "Atlasium".length);
    node.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  });

  const atlasiumHighlights = previewArticle.locator(".wiki-word-highlight", { hasText: "Atlasium" });
  await expect(atlasiumHighlights).toHaveCount(2);
  const targetHighlight = previewArticle.locator(".wiki-word-highlight-target", { hasText: "Atlasium" });
  await expect(targetHighlight).toHaveCount(1);
  await expect.poll(() => targetHighlight.evaluate((node) => node.closest("p")?.textContent ?? "")).toContain("Final Atlasium anchor");
  await expect
    .poll(() =>
      targetHighlight.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        const center = rect.top + rect.height / 2;
        return Math.abs(center - window.innerHeight / 2) < window.innerHeight * 0.38;
      })
    )
    .toBe(true);

  await textarea.evaluate((node: HTMLTextAreaElement) => {
    node.scrollTop = 0;
    node.setSelectionRange(0, 0);
  });
  await targetHighlight.dblclick();

  const selectedText = await textarea.evaluate((node: HTMLTextAreaElement) => node.value.slice(node.selectionStart, node.selectionEnd));
  expect(selectedText).toBe("Atlasium");
  const textareaState = await textarea.evaluate((node: HTMLTextAreaElement) => ({
    expectedStart: node.value.lastIndexOf("Atlasium"),
    selectionStart: node.selectionStart,
    scrollTop: node.scrollTop,
    rect: (() => {
      const rect = node.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom };
    })()
  }));
  expect(textareaState.selectionStart).toBe(textareaState.expectedStart);
  expect(textareaState.scrollTop).toBeGreaterThan(0);
  expect(textareaState.rect.bottom).toBeGreaterThan(0);
  expect(textareaState.rect.top).toBeLessThan(await page.evaluate(() => window.innerHeight));
  await expectNoHorizontalOverflow(page);
});

test("@e2e wiki single-repo sections render without repository rows", async ({ page }) => {
  await seedSession(page, "admin");
  await page.goto("/projects/project-1/wiki", { waitUntil: "domcontentloaded" });
  await waitForAtlasiumRouteReady(page, "/projects/project-1/wiki");

  const dossierRows = page.locator(".wiki-tree-row-section-dossier");
  await expect(dossierRows).toHaveCount(2);
  await expect(dossierRows.filter({ hasText: "Research" }).locator(".wiki-tree-count")).toHaveText("2");
  await expect(dossierRows.filter({ hasText: "Implementation" }).locator(".wiki-tree-count")).toHaveText("1");
  await expect(page.locator(".wiki-tree-row-repository")).toHaveCount(0);
  await expect(page.locator(".wiki-tree-row-index").filter({ hasText: "Research Index" })).toBeVisible();
  await expect(page.locator(".wiki-tree-row-index").filter({ hasText: "Implementation Index" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("@e2e wiki search renders an indexed result list with evidence", async ({ page }) => {
  await seedSession(page, "admin");
  await page.goto("/projects/project-1/wiki", { waitUntil: "domcontentloaded" });
  await waitForAtlasiumRouteReady(page, "/projects/project-1/wiki");

  const searchInput = page.getByLabel("Search wiki content");
  await searchInput.fill("sputtering");

  const resultRows = page.locator(".wiki-search-result-row");
  await expect(resultRows).toHaveCount(1);
  await expect(page.locator(".wiki-tree-list")).toHaveCount(0);

  const fieldResult = resultRows.first();
  await expect(fieldResult.getByRole("button", { name: /Field Study Context/ })).toBeVisible();
  await expect(fieldResult.locator(".wiki-search-hit").filter({ hasText: /sputtering/i }).first()).toBeVisible();
  await expect(fieldResult.locator(".badge", { hasText: "Published" })).toBeVisible();

  await fieldResult.getByRole("button", { name: /Field Study Context/ }).click();

  await expect(page.getByRole("heading", { name: "Field Study Context", level: 2 })).toBeVisible();
  await expect(searchInput).toHaveValue("sputtering");
  await expect(page.getByLabel("Find in page")).toHaveValue("sputtering");
  const targetMatch = page.locator(".wiki-page-find-highlight-target", { hasText: /sputtering/i });
  await expect(targetMatch).toHaveCount(1);
  await expect.poll(() =>
    targetMatch.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      const center = rect.top + rect.height / 2;
      return Math.abs(center - window.innerHeight / 2) < window.innerHeight * 0.38;
    })
  ).toBe(true);
  await expect(fieldResult.locator(".badge", { hasText: "Current" })).toBeVisible();

  await page.getByRole("button", { name: "Clear wiki search" }).click();

  await expect(searchInput).toHaveValue("");
  await expect(page.locator(".wiki-search-result-row")).toHaveCount(0);
  await expect(page.locator(".wiki-tree-row-section-dossier").filter({ hasText: "Research" })).toBeVisible();
  await expect(page.locator(".wiki-tree-row-section-dossier").filter({ hasText: "Implementation" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("@e2e wiki page find opens with Shift+F and searches the current page", async ({ page }) => {
  await seedSession(page, "admin");
  await page.goto("/projects/project-1/wiki/home", { waitUntil: "domcontentloaded" });
  await waitForAtlasiumRouteReady(page, "/projects/project-1/wiki/home");

  await page.keyboard.press("Shift+F");
  const pageFind = page.getByRole("search", { name: "Find in current wiki page" });
  await expect(pageFind).toBeVisible();

  const pageFindInput = page.getByLabel("Find in page");
  await pageFindInput.fill("modules");

  await expect(pageFind.getByText("1/1")).toBeVisible();
  await expect(page.locator(".wiki-page-find-highlight-target", { hasText: "modules" })).toHaveCount(1);

  await page.keyboard.press("Escape");

  await expect(pageFind).toHaveCount(0);
  await expect(page.locator(".wiki-page-find-highlight")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test("@e2e code repository sections render mocked repository lists", async ({ page }) => {
  await seedSession(page, "admin");
  await page.goto("/projects/project-1/code", { waitUntil: "domcontentloaded" });

  await page.getByRole("button", { name: "Commits" }).click();
  await expect(page.getByText("Initialize archive")).toBeVisible();
  await expect(page.getByText("a1b2c3d")).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.getByRole("button", { name: "Branches" }).click();
  await expect(page.getByText("main").first()).toBeVisible();
  await expect(page.getByText("Default").first()).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.getByRole("button", { name: "Merge requests" }).click();
  await expect(page.locator(".empty-state-title", { hasText: /^No merge requests$/ })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("@e2e account Git credential setup renders helper commands and reset examples", async ({ page }) => {
  await seedSession(page, "admin");
  await page.goto("/account", { waitUntil: "domcontentloaded" });

  await page.getByRole("button", { name: "Git access" }).click();
  await expect(page.getByRole("heading", { name: "HTTPS clone" })).toBeVisible();
  await expect(page.getByText("Store credentials on this computer")).toBeVisible();
  await expect(page.getByText("Windows / WSL")).toBeVisible();
  await expect(page.getByText("git config --global credential.helper manager").first()).toBeVisible();

  await page.getByRole("button", { name: "Reset or examples" }).click();
  await expect(page.getByText("Reset saved HTTPS credentials")).toBeVisible();
  await expect(page.getByText("git credential-manager erase")).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

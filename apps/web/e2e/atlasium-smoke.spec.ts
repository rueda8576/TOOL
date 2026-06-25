import { expect, test } from "@playwright/test";

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

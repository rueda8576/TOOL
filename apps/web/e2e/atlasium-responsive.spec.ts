import { expect, type Page, test } from "@playwright/test";

import { expectNoDecorativeBrandDrift, expectNoHorizontalOverflow, qaViewports, waitForAtlasiumRouteReady } from "./support/assertions";
import { installMockApi, seedSession } from "./support/mock-api";

const responsiveRoutes = [
  "/login",
  "/forgot-password",
  "/reset-password?token=qa-reset",
  "/accept-invite?token=qa-invite",
  "/projects",
  "/projects/project-1",
  "/projects/project-1/wiki",
  "/projects/project-1/documents",
  "/projects/project-1/documents/document-1",
  "/projects/project-1/code",
  "/projects/project-1/tasks",
  "/projects/project-1/meetings",
  "/account"
];

const snapshotViewports = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "mobile", width: 390, height: 844 }
];

const snapshotRoutes: Array<{ name: string; path: string; prepare?: (page: Page) => Promise<void> }> = [
  { name: "login", path: "/login" },
  { name: "forgot-password", path: "/forgot-password" },
  { name: "reset-password", path: "/reset-password?token=qa-reset" },
  { name: "accept-invite", path: "/accept-invite?token=qa-invite" },
  { name: "projects", path: "/projects" },
  {
    name: "projects-operations",
    path: "/projects",
    prepare: async (page) => {
      await page.getByRole("button", { name: "Operations" }).click();
      await expect(page.getByRole("heading", { name: "Operations ledger" })).toBeVisible();
    }
  },
  { name: "overview", path: "/projects/project-1" },
  { name: "wiki", path: "/projects/project-1/wiki" },
  { name: "documents", path: "/projects/project-1/documents" },
  { name: "code", path: "/projects/project-1/code" },
  { name: "tasks", path: "/projects/project-1/tasks" },
  { name: "meetings", path: "/projects/project-1/meetings" },
  { name: "account", path: "/account" }
];

async function freezeVisualMotion(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
      }
    `
  });
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-06-20T12:00:00.000Z"));
  await installMockApi(page);
  await seedSession(page, "admin");
});

test("@visual Atlasium routes fit core responsive viewports", async ({ page }) => {
  for (const viewport of qaViewports) {
    await page.setViewportSize(viewport);
    for (const route of responsiveRoutes) {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await waitForAtlasiumRouteReady(page, route);
      await expectNoDecorativeBrandDrift(page);
      await expectNoHorizontalOverflow(page);
      if (route === "/projects") {
        await page.getByRole("button", { name: "Operations" }).click();
        await expect(page.getByRole("heading", { name: "Operations ledger" })).toBeVisible();
        await expectNoDecorativeBrandDrift(page);
        await expectNoHorizontalOverflow(page);
      }
    }
  }
});

test("@visual Atlasium stable surfaces match deterministic snapshots", async ({ page }) => {
  for (const viewport of snapshotViewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    for (const route of snapshotRoutes) {
      await page.goto(route.path, { waitUntil: "domcontentloaded" });
      await waitForAtlasiumRouteReady(page, route.path);
      await route.prepare?.(page);
      await freezeVisualMotion(page);
      await expectNoDecorativeBrandDrift(page);
      await expectNoHorizontalOverflow(page);
      await expect(page).toHaveScreenshot(`${route.name}-${viewport.name}.png`, {
        animations: "disabled",
        caret: "hide",
        fullPage: true,
        maxDiffPixelRatio: 0.01
      });
    }
  }
});

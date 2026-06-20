import { test } from "@playwright/test";

import { expectA11yClean, waitForAtlasiumRouteReady } from "./support/assertions";
import { installMockApi, seedSession } from "./support/mock-api";

const a11yRoutes = [
  "/login",
  "/forgot-password",
  "/reset-password?token=qa-reset",
  "/accept-invite?token=qa-invite",
  "/projects",
  "/projects/project-1",
  "/projects/project-1/wiki",
  "/projects/project-1/code",
  "/projects/project-1/documents",
  "/projects/project-1/documents/document-1",
  "/projects/project-1/tasks",
  "/projects/project-1/meetings",
  "/account"
];

test.beforeEach(async ({ page }) => {
  await installMockApi(page);
});

test("@a11y critical and serious axe violations are blocked", async ({ page }) => {
  for (const route of a11yRoutes) {
    if (route.startsWith("/projects") || route === "/account") {
      await seedSession(page, "admin");
    }
    await page.goto(route, { waitUntil: "domcontentloaded" });
    await waitForAtlasiumRouteReady(page, route);
    await expectA11yClean(page);
  }
});

test("@a11y admin operations ledger is clean", async ({ page }) => {
  await seedSession(page, "admin");
  await page.goto("/projects", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Operations" }).click();
  await expectA11yClean(page);
});

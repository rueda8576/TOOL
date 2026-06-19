import { expect, test } from "@playwright/test";

import { expectNoDecorativeBrandDrift, expectNoHorizontalOverflow, qaViewports } from "./support/assertions";
import { installMockApi, seedSession } from "./support/mock-api";

const responsiveRoutes = [
  "/login",
  "/forgot-password",
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

test.beforeEach(async ({ page }) => {
  await installMockApi(page);
  await seedSession(page, "admin");
});

test("@visual Atlasium routes fit core responsive viewports", async ({ page }) => {
  for (const viewport of qaViewports) {
    await page.setViewportSize(viewport);
    for (const route of responsiveRoutes) {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await expect(page.locator("body")).toBeVisible();
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

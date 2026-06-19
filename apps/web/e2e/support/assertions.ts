import { expect, Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

export const qaViewports = [
  { width: 1440, height: 1000 },
  { width: 1280, height: 800 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 }
];

export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const documentElement = document.documentElement;
    const body = document.body;
    return Math.max(documentElement.scrollWidth, body.scrollWidth) - documentElement.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(2);
}

export async function expectAtlasiumBrand(page: Page): Promise<void> {
  await expect(page.getByText("Atlasium").first()).toBeVisible();
}

export async function expectNoDecorativeBrandDrift(page: Page): Promise<void> {
  const text = await page.locator("body").innerText();
  expect(text).not.toMatch(/Doctoral Platform|WorkMesh|Doctoral OS|Academic Slate/i);
  expect(text).not.toMatch(/\b(orbs?|bokeh|glassmorphism|frosted|sparkles?)\b/i);
  expect(text).not.toMatch(/🚀|✨|🎉|🔥|💜|🌈|⭐|⭐️/u);
}

export async function expectA11yClean(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).analyze();
  const blockingViolations = result.violations.filter((violation) => violation.impact === "critical" || violation.impact === "serious");
  expect(blockingViolations).toEqual([]);
}

export async function waitForAtlasiumRouteReady(page: Page, route: string): Promise<void> {
  const path = new URL(route, "http://atlasium.test").pathname;
  await expect(page.locator("body")).toBeVisible();

  if (path === "/") {
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
  } else if (path === "/login") {
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  } else if (path === "/forgot-password") {
    await expect(page.getByRole("heading", { name: "Reset workspace access" })).toBeVisible();
  } else if (path === "/reset-password") {
    await expect(page.getByRole("button", { name: "Update password" })).toBeVisible();
  } else if (path === "/accept-invite") {
    await expect(page.getByRole("button", { name: "Create account" })).toBeVisible();
  } else if (path === "/projects") {
    await expect(page.getByText("ATLS Atlasium Research Archive")).toBeVisible();
  } else if (path === "/projects/project-1") {
    await expect(page.getByText("Atlasium Research Archive").first()).toBeVisible();
    await expect(page.getByText("Protocol ready")).toBeVisible();
  } else if (path === "/projects/project-1/wiki" || path === "/projects/project-1/wiki/home") {
    await expect(page.getByRole("heading", { name: "Archive Home" }).first()).toBeVisible();
  } else if (path === "/projects/project-1/documents") {
    await expect(page.getByRole("heading", { name: "Field Study Protocol" })).toBeVisible();
  } else if (path === "/projects/project-1/documents/document-1") {
    await expect(page.getByText("Field Study Protocol").first()).toBeVisible();
    await expect(page.getByLabel("Collaborators in this document")).toBeVisible();
  } else if (path === "/projects/project-1/code") {
    await expect(page.getByText("atlasium-research-archive").first()).toBeVisible();
  } else if (path === "/projects/project-1/tasks") {
    await expect(page.getByText("Review literature extraction")).toBeVisible();
  } else if (path === "/projects/project-1/meetings") {
    await expect(page.getByText("Archive Review")).toBeVisible();
  } else if (path === "/account") {
    await expect(page.getByRole("heading", { name: "Atlasium identity" })).toBeVisible();
    await expect(page.getByText("admin@atlasium.test")).toBeVisible();
  }

  await page.evaluate(async () => {
    await document.fonts?.ready;
  });
}

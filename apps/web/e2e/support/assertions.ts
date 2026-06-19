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
  expect(text).not.toMatch(/Doctoral Platform/i);
  expect(text).not.toMatch(/🚀|✨|🎉|🔥/u);
}

export async function expectA11yClean(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).analyze();
  const blockingViolations = result.violations.filter((violation) => violation.impact === "critical" || violation.impact === "serious");
  expect(blockingViolations).toEqual([]);
}

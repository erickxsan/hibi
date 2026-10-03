import { expect, test } from "@playwright/test";
test("reviews only real conflicts, compares cloud values and resolves on desktop and mobile", async ({
  page,
}, testInfo) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/e2e/fixtures/pending-operations.html");
  await expect(page).toHaveTitle("Pending operations review");
  const panel = page.getByRole("region", { name: "2 changes need your review" });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("heading", { name: "Student: Student a" })).toBeVisible();
  const notes = panel.getByRole("row", { name: /Notes/ }).first();
  await expect(notes).toHaveClass(/is-conflict/);
  await expect(notes).toContainText("Local change");
  await expect(notes).toContainText("Cloud change");
  // The waiting operation is a quiet line, without keep/discard controls.
  await expect(panel.getByText("1 more change is safe on this device and will sync automatically.")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Keep this device's version" })).toHaveCount(2);
  await expect(panel).not.toContainText("2026-09-07T");
  await page.screenshot({ path: testInfo.outputPath("desktop.png"), fullPage: true });
  await panel.getByRole("button", { name: "Keep this device's version" }).first().click();
  await expect(page.locator("output")).toHaveText("a: local");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("region", { name: "1 change needs your review" })).toBeVisible();
  const overflow = await page.evaluate(() => globalThis.document.documentElement.scrollWidth - globalThis.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.screenshot({ path: testInfo.outputPath("mobile.png"), fullPage: true });
  await page.getByRole("button", { name: "Discard this device's change" }).click();
  await expect(page.locator("output")).toHaveText("b: discard");
  await expect(page.locator(".pending-operations")).toHaveCount(0);
  await expect(page.locator(".pending-operations-note")).toHaveText(
    "1 change is saved on this device and will sync when the connection returns.",
  );
  expect(errors).toEqual([]);
  await expect(page.locator("vite-error-overlay")).toHaveCount(0);
});

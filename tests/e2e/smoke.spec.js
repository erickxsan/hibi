import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  const welcomeDialog = page.getByRole("dialog", { name: "Welcome to Hibi!" });
  await expect(welcomeDialog).toBeVisible();
  await welcomeDialog.getByRole("button", { name: "Explore on my own" }).click();
  await expect(welcomeDialog).toBeHidden();
});

test("loads the local workspace and preserves a student interaction", async ({ page }) => {
  await expect(page.getByRole("heading", { name: /Good morning, Teacher/ })).toBeVisible();
  await page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", { name: "Community" }).click();
  await expect(page.getByRole("heading", { name: "Community" })).toBeVisible();

  await page.getByRole("button", { name: "Add student" }).click();
  await page.getByLabel("Student ID").fill("E2E-1");
  await page.getByLabel("Full name").fill("Playwright Student");
  await page.getByRole("button", { name: "Save student" }).click();

  await expect(page.getByRole("button", { name: "Open Playwright Student" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Open Playwright Student" })).toBeVisible();
});

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

test("updates the active student count after deactivation", async ({ page }) => {
  await page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", { name: "Community" }).click();
  await page.getByRole("button", { name: "Add student" }).click();
  await page.getByLabel("Student ID").fill("ACTIVE-1");
  await page.getByLabel("Full name").fill("Active Student");
  await page.getByRole("button", { name: "Save student" }).click();

  const counter = page.locator(".community-active-count strong");
  await expect(counter).toHaveText("1");

  await page.getByRole("button", { name: "Deactivate student" }).click();
  const dialog = page.getByRole("dialog", { name: /Deactivate .+\?/ });
  await dialog.getByRole("button", { name: "Deactivate student" }).click();

  await expect(counter).toHaveText("0");
  await page.reload();
  await expect(counter).toHaveText("0");

  await page.getByRole("button", { name: "Open Active Student", exact: true }).click();
  await page.getByRole("combobox", { name: "Status Inactive", exact: true }).click();
  await page.getByRole("option", { name: "Active", exact: true }).click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(counter).toHaveText("1");
  await page.reload();
  await expect(counter).toHaveText("1");
});

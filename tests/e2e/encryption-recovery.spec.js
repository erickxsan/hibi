import { expect, test } from "@playwright/test";

for (const viewport of [
  { width: 1280, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`recovers a remembered device after an API outage at ${viewport.width}px`, async ({ page }, testInfo) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (["error", "warning"].includes(message.type())) errors.push(message.text());
    });
    await page.setViewportSize(viewport);
    await page.addInitScript(() => localStorage.setItem("hibi:language:v1", "en"));
    await page.route("https://*.supabase.co/**", (route) => route.abort());
    await page.goto("/tests/e2e/fixtures/encryption-recovery.html");
    await expect(page).toHaveTitle("hibi — Teaching, day by day");
    await expect(page).toHaveURL(/\/tests\/e2e\/fixtures\/encryption-recovery\.html$/);
    await expect(page.getByRole("heading", { name: "Workspace temporarily unavailable" })).toBeVisible();
    await expect(page.getByLabel("Create encryption password")).toHaveCount(0);
    await expect(page.getByLabel("Encryption password", { exact: true })).toHaveCount(0);
    await expect(page.getByText(/Signing out also forgets/)).toBeVisible();
    await expect(page.locator("vite-error-overlay")).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("safe-outage.png"), fullPage: true });
    await page.getByRole("button", { name: "Check again" }).click();
    await expect(page.getByRole("heading", { name: "Workspace unlocked" })).toBeVisible();
    await expect(page.getByRole("status")).toHaveText("remembered-device");
    await expect(page.getByRole("alert")).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("remembered-device-recovered.png") });
    expect(errors).toEqual([]);
  });
}

import { expect, test } from "@playwright/test";

for (const width of [360, 390, 768, 1024, 1440]) {
  test.describe(`archived students at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 }, hasTouch: width < 1100 });
    test("keeps the archive compact, usable, and persistent", async ({ page }, testInfo) => {
      await page.goto("/");
      await page.evaluate(async () => {
        const modulePath = "/src/domain/index.js";
        const { createStarterState, createStudent } = await import(modulePath);
        const state = createStarterState({ settings: { onboardingVersion: 2 } });
        state.students = [
          createStudent({ id: "active", code: "ACT-1", fullName: "Ana Rivera", status: "Active" }),
          createStudent({
            id: "archived",
            code: "ARCHIVADO-123456789012345678901234567890",
            fullName: "María Fernanda de los Ángeles Rodríguez Hernández",
            status: "Inactive",
            notes: "Historial conservado",
          }),
        ];
        localStorage.clear();
        localStorage.setItem("minimal-class-manager:v1", JSON.stringify(state));
        localStorage.setItem("hibi:language:v1", "es");
      });
      await page.goto("/community");
      if (width <= 780) {
        await expect(page.locator(".hibi-sidebar")).toBeHidden();
        await expect(page.locator(".hibi-mobile-nav")).toBeVisible();
      } else {
        const sidebar = await page.locator(".hibi-sidebar").boundingBox();
        const content = await page.locator(".community-page").boundingBox();
        expect(content.x).toBeGreaterThanOrEqual(sidebar.x + sidebar.width);
      }
      const archive = page.locator(".community-archive-toggle");
      await expect(archive).toContainText("Archivados");
      await expect(archive).toHaveAttribute("aria-expanded", "false");
      await expect(page.locator(".community-archived-row")).toHaveCount(0);
      await archive.scrollIntoViewIfNeeded();
      const closedBox = await archive.boundingBox();
      expect(closedBox.height).toBeLessThanOrEqual(48);
      if (width < 1100) expect(closedBox.height).toBeGreaterThanOrEqual(44);
      await page.screenshot({ path: testInfo.outputPath("closed.png"), fullPage: true });
      await archive.click();
      const row = page.locator(".community-archived-row");
      await expect(row).toContainText("María Fernanda");
      const reactivate = row.getByRole("button", { name: "Reactivar", exact: true });
      await expect(reactivate).toBeVisible();
      const rowBox = await row.boundingBox();
      const buttonBox = await reactivate.boundingBox();
      expect(rowBox.x).toBeGreaterThanOrEqual(0);
      expect(rowBox.x + rowBox.width).toBeLessThanOrEqual(width);
      expect(buttonBox.x + buttonBox.width).toBeLessThanOrEqual(width);
      expect(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth)).toBe(
        true,
      );
      await page.screenshot({ path: testInfo.outputPath("open.png"), fullPage: true });
      await reactivate.click();
      await expect(archive).toContainText("0");
      await expect(page.locator(".community-student-table")).toContainText("María Fernanda");
      await page.reload();
      await expect(archive).toHaveAttribute("aria-expanded", "false");
      await expect(page.locator(".community-student-table")).toContainText("María Fernanda");
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("minimal-class-manager:v1")));
      expect(saved.students.find((student) => student.id === "archived")).toMatchObject({
        status: "Active",
        notes: "Historial conservado",
      });
    });
  });
}

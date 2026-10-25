import { expect, test } from "@playwright/test";

for (const width of [390, 1440]) {
  test.describe("group archive at " + width + "px", () => {
    test.use({ viewport: { width, height: 900 } });
    test("preserves history, restores groups and keeps statistics opt-in", async ({ page }, testInfo) => {
      const compact = width < 600;
      await page.goto("/");
      await page.evaluate(async () => {
        const path = "/src/test/groupArchiveFixture.js";
        const { createGroupArchiveFixture } = await import(path);
        localStorage.clear();
        localStorage.setItem("minimal-class-manager:v1", JSON.stringify(createGroupArchiveFixture()));
        localStorage.setItem("hibi:language:v1", "es");
      });
      await page.goto("/groups");
      const archive = page.getByRole("button", { name: "Grupos archivados · 2", exact: true });
      await expect(archive).toHaveAttribute("aria-expanded", "false");
      await page.getByRole("button", { name: "Abrir Álgebra · Grupo A", exact: true }).click();
      await page.getByRole("button", { name: "Archivar grupo", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "¿Archivar el grupo Álgebra · Grupo A?", exact: true });
      await expect(dialog).toContainText("Se conservan sus");
      await expect(dialog.getByRole("button", { name: "Archivar grupo", exact: true })).toBeInViewport();
      await page.screenshot({ path: testInfo.outputPath("confirm-group-archive.png") });
      await dialog.getByRole("button", { name: "Archivar grupo", exact: true }).click();
      await expect(page.getByRole("button", { name: "Abrir Álgebra · Grupo A", exact: true })).toHaveCount(0);
      // Archiving opens the archive list so the group is easy to find again.
      await expect(page.getByRole("button", { name: "Grupos archivados · 3", exact: true })).toHaveAttribute(
        "aria-expanded",
        "true",
      );
      await page
        .locator("#community-archived-groups")
        .getByRole("button", { name: /Álgebra · Grupo A Archivado el/ })
        .click();
      const detail = page.getByRole("region", { name: "Detalle del grupo archivado" });
      await expect(detail).toContainText("Ana Rivera");
      await detail.getByRole("button", { name: /^Ver historial/ }).click();
      await expect(detail.getByRole("heading", { name: "Clases y pagos", exact: true })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath("archived-group-history.png"), fullPage: true });
      expect(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth)).toBe(
        true,
      );
      await detail.getByRole("button", { name: "Reactivar grupo", exact: true }).click();
      if (compact) await page.keyboard.press("Escape");
      await expect(page.getByRole("button", { name: "Abrir Álgebra · Grupo A", exact: true })).toBeVisible();
      await page.locator('a[href="/progress"]:visible').click();
      await page.getByRole(compact ? "button" : "tab", { name: "Pagos", exact: true }).click();
      // The choice lives in a filter chip («2 grupos archivados fuera») that opens the switch.
      const chip = page.getByRole("button", { name: /grupos? archivados? fuera$/ });
      await chip.click();
      const scope = page.getByRole("switch", { name: "Incluir grupos archivados", exact: true });
      await expect(scope).toHaveAttribute("aria-checked", "false");
      await expect(page.getByText("$350", { exact: true }).first()).toBeVisible();
      await scope.click();
      await expect(scope).toHaveAttribute("aria-checked", "true");
      await expect(page.getByText(/sesión/).first()).toBeVisible();
      await expect(page.getByText("$600", { exact: true }).first()).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath("included-statistics.png"), fullPage: true });
      await page.reload();
      await page.getByRole("button", { name: /grupos? archivados? fuera$/ }).click();
      await expect(page.getByRole("switch", { name: "Incluir grupos archivados", exact: true })).toHaveAttribute(
        "aria-checked",
        "false",
      );
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("minimal-class-manager:v1")));
      expect(saved.classLog).toHaveLength(7);
      expect(saved.grades).toHaveLength(7);
      expect(saved.students.find((student) => student.id === "preview-daniel").status).toBe("Inactive");
      expect(saved.groups.filter((group) => group.status === "Inactive")).toHaveLength(2);
    });
  });
}

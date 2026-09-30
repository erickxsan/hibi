import { expect, test } from "@playwright/test";

// The assertions use the Spanish copy; do not depend on the machine language.
test.use({ locale: "es-MX" });

async function checkTour(page, testInfo) {
  for (const [index, section] of ["home", "community", "classes", "tracking", "settings"].entries()) {
    const card = page.locator(".onboarding-context-callout");
    const next = card.locator(".onboarding-tour-next");
    await expect(next).toBeEnabled();
    await expect(page.locator('[data-onboarding-tour="' + section + '"]')).toBeVisible();
    await expect(card.getByRole("progressbar")).toHaveAttribute("aria-valuenow", String(index + 1));
    await expect(page.locator(".onboarding-tour-highlight")).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(page.locator(".onboarding-tour-controller")).toHaveCount(0);
    await expect(card.locator(".onboarding-tour-next")).toHaveCount(1);
    if (index === 1) await expect(card.locator(".onboarding-tour-focus")).toContainText("Tu grupo");
    const geometry = await page.evaluate(() => {
      const bounds = globalThis.document.querySelector(".onboarding-context-callout").getBoundingClientRect();
      const target = globalThis.document.querySelector(".onboarding-tour-highlight").getBoundingClientRect();
      return {
        x: bounds.x,
        y: bounds.y,
        right: bounds.right,
        bottom: bounds.bottom,
        separate:
          bounds.top >= target.bottom ||
          bounds.bottom <= target.top ||
          bounds.left >= target.right ||
          bounds.right <= target.left,
        width: globalThis.innerWidth,
        height: globalThis.innerHeight,
        documentWidth: globalThis.document.documentElement.scrollWidth,
      };
    });
    expect(geometry.x).toBeGreaterThanOrEqual(0);
    expect(geometry.y).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(geometry.width);
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.height);
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.width);
    expect(geometry.separate).toBe(true);
    await expect(card.locator("img")).toHaveJSProperty("complete", true);
    await expect(card.locator("img")).not.toHaveJSProperty("naturalWidth", 0);
    await page.screenshot({ path: testInfo.outputPath(section + ".png"), animations: "disabled" });
    if (index === 1) {
      await card.getByRole("button", { name: "Atrás" }).click();
      await expect(card.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");
      await expect(next).toBeEnabled();
      await next.click();
      await expect(card.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "2");
      await expect(next).toBeEnabled();
    }
    await next.click();
  }
  const done = page.getByRole("dialog", { name: "¡Todo listo!" });
  await expect(done).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("done.png"), animations: "disabled" });
  await done.getByRole("button", { name: "Cerrar" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

test("sets up, resumes, saves the schedule and students, and completes the guided tour", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page).toHaveTitle(/hibi/);
  await page.getByRole("button", { name: "Empezar", exact: true }).click();
  await page.getByLabel("Nombre del grupo").fill("Inglés B1");
  await page.getByLabel("Materia", { exact: true }).fill("Inglés");
  await page.getByRole("combobox", { name: "Duración" }).selectOption("1");
  await page.getByRole("button", { name: "Añadir otro día" }).click();
  await page.getByRole("combobox", { name: "Día", exact: true }).nth(1).selectOption("3");
  await page.getByRole("heading", { name: "Crea tu primer grupo" }).click();
  await page.screenshot({ path: testInfo.outputPath("group.png"), animations: "disabled" });
  await page.getByRole("button", { name: "Guardar y continuar" }).click();
  await expect(page.getByRole("heading", { name: "Añade a tus alumnos" })).toBeVisible();
  await page.getByRole("button", { name: "Continuar después" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Añade a tus alumnos" })).toBeVisible();
  await page.getByLabel("Alumno 1", { exact: true }).fill("Ada de prueba");
  await page.getByRole("button", { name: "Añadir otro alumno" }).click();
  await page.getByLabel("Alumno 2", { exact: true }).fill("Lin de prueba");
  await page.getByRole("button", { name: "Guardar y continuar" }).click();
  await expect(page.getByRole("heading", { name: "Tu agenda recurrente está lista" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("agenda.png"), animations: "disabled" });
  await page.getByRole("button", { name: "Conocer Hibi" }).click();
  await page.locator(".onboarding-tour-back").click();
  await expect(page.getByRole("heading", { name: "Tu agenda recurrente está lista" })).toBeVisible();
  await page.getByRole("button", { name: "Conocer Hibi" }).click();
  await checkTour(page, testInfo);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("minimal-class-manager:v1")));
  expect(saved.groups).toHaveLength(1);
  expect(saved.groups[0].weeklySchedule).toHaveLength(2);
  expect(saved.students).toHaveLength(2);
  expect(saved.settings.onboardingVersion).toBe(2);
  await page.reload();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Iniciar recorrido" }).click();
  const card = page.locator(".onboarding-context-callout");
  await expect(card.locator(".onboarding-tour-next")).toBeEnabled();
  await expect(card.getByRole("button", { name: "Atrás" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);
  await page.goto("/settings");
  await page.getByRole("button", { name: "Configuración guiada" }).click();
  await expect(page.getByRole("heading", { name: "Crea tu primer grupo" })).toBeVisible();
  await expect(page.getByLabel("Nombre del grupo")).toHaveValue("");
  await page.getByRole("button", { name: "Continuar después" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(errors).toEqual([]);
});

for (const viewport of [
  { width: 320, height: 740 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1046, height: 630 },
]) {
  test.describe("tutorial at " + viewport.width + "px", () => {
    test.use({ viewport });
    test("keeps setup and every tour step readable and reachable", async ({ page }, testInfo) => {
      test.setTimeout(60_000);
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto("/");
      await page.getByRole("button", { name: "Empezar", exact: true }).click();
      await page.getByLabel("Nombre del grupo").fill("Grupo de prueba");
      await page.getByLabel("Materia", { exact: true }).fill("Inglés");
      await page.getByRole("heading", { name: "Crea tu primer grupo" }).click();
      const dialogWidths = await page.getByRole("dialog").evaluate((dialog) => ({
        content: dialog.scrollWidth,
        available: dialog.clientWidth,
      }));
      expect(dialogWidths.content).toBeLessThanOrEqual(dialogWidths.available);
      await page.screenshot({ path: testInfo.outputPath("group.png"), animations: "disabled" });
      await page.getByRole("button", { name: "Guardar y continuar" }).click();
      await page.getByLabel("Alumno 1", { exact: true }).fill("Alumno de prueba");
      await page.getByRole("button", { name: "Guardar y continuar" }).click();
      await page.getByRole("button", { name: "Conocer Hibi" }).click();
      await checkTour(page, testInfo);
      expect(errors).toEqual([]);
    });
  });
}

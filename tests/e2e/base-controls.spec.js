import { expect, test } from "@playwright/test";

for (const width of [1440, 390]) {
  test.describe(`base controls at ${width}px`, () => {
    test.use({ viewport: { width, height: 950 }, locale: "es-MX" });
    test("uses the calendar, clock and repeat controls with real local schedules", async ({ page }, testInfo) => {
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto("/");
      await page.evaluate(async () => {
        const domainPath = "/src/domain/index.js";
        const datePath = "/src/domain/dates.js";
        const schedulePath = "/src/domain/schedule.js";
        const { createStarterState, createGroup, createStudent } = await import(domainPath);
        const { todayDateOnly } = await import(datePath);
        const { dayOfWeekForDate } = await import(schedulePath);
        const date = todayDateOnly();
        const state = createStarterState({ settings: { onboardingVersion: 2, asOfDate: date } });
        state.groups = [
          createGroup({
            id: "base-e2e-group",
            name: "Grupo de prueba E2E",
            weeklySchedule: [
              { id: "base-e2e-slot", dayOfWeek: dayOfWeekForDate(date), startTime: "17:00", durationHours: 1.5 },
            ],
          }),
        ];
        state.students = [
          createStudent({
            id: "base-e2e-student",
            code: "E2E-BASE",
            fullName: "Alumno de prueba E2E",
            groupIds: ["base-e2e-group"],
          }),
        ];
        localStorage.clear();
        localStorage.setItem("hibi:language:v1", "es");
        localStorage.setItem("minimal-class-manager:v1", JSON.stringify(state));
      });
      await page.goto("/classes");
      await page.getByRole("button", { name: "Nueva clase", exact: true }).click();
      const editor = page.getByRole("dialog", { name: "Nueva clase", exact: true });
      await editor.getByRole("combobox", { name: "Fecha de inicio" }).click();
      const calendar = page.getByRole("dialog", { name: "Elegir fecha" });
      await expect(calendar).toBeVisible();
      expect([35, 42]).toContain(await calendar.locator(".date-day").count());
      await expect(calendar.locator(".date-day.is-today")).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath("calendar.png"), animations: "disabled" });
      await calendar.getByRole("button", { name: "Hoy", exact: true }).click();
      await editor.getByRole("combobox", { name: "Hora", exact: true }).click();
      const clock = page.getByRole("dialog", { name: "Elegir hora" });
      await expect(clock.locator(".time-dial")).toBeVisible();
      await clock.getByRole("button", { name: "p. m.", exact: true }).click();
      await expect(clock.getByRole("button", { name: /5:00.*Ocupado/ })).toBeDisabled();
      await expect(clock.locator(".time-dial-busy").first()).toBeVisible();
      await expect(clock.locator(".time-foot")).toBeInViewport();
      await page.screenshot({ path: testInfo.outputPath("clock.png"), animations: "disabled" });
      await clock.getByRole("button", { name: /^7:00/ }).click();
      await clock.getByRole("button", { name: "00 minutos" }).click();
      await expect(editor.getByRole("combobox", { name: "Hora", exact: true })).toContainText("7:00");
      await editor.getByRole("combobox", { name: "Repetir", exact: true }).click();
      const repeat = page.getByRole("dialog", { name: "Repetir", exact: true });
      await repeat.getByRole("button", { name: "Aumentar intervalo" }).click();
      await expect(repeat.locator(".repeat-next")).toContainText("Próximas clases");
      if (width === 390) {
        await expect(repeat.getByRole("button", { name: "Atrás", exact: true })).toBeVisible();
        await page.goBack();
        await expect(repeat).toBeHidden();
        await expect(editor).toBeVisible();
      } else await page.keyboard.press("Escape");
      await expect(page.locator('select, input[type="date"], input[type="time"]')).toHaveCount(0);
      expect(await page.evaluate(() => globalThis.document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      expect(errors).toEqual([]);
    });
  });
}

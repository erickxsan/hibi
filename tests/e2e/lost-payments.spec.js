import { expect, test } from "@playwright/test";

const TODAY = "2026-11-05";

async function seed(page) {
  await page.clock.setFixedTime(new Date(`${TODAY}T12:00:00-06:00`));
  await page.goto("/");
  await page.evaluate(async (today) => {
    const modulePath = "/src/domain/index.js";
    const { createStarterState, createStudent, createGroup } = await import(modulePath);
    const state = createStarterState({
      settings: { onboardingVersion: 2, asOfDate: today, selectedMonth: "2026-11-01" },
    });
    state.groups = [
      createGroup({
        id: "g-month",
        name: "Prepa",
        status: "Active",
        billing: { mode: "monthly", monthlyFee: 800, due: { type: "dayOfMonth", day: 5 }, effectiveFrom: "2026-04" },
      }),
      createGroup({ id: "g-class", name: "Sec", status: "Active", hourlyRate: 125 }),
    ];
    state.students = [
      createStudent({ id: "luna", code: "L-1", fullName: "Luna Ortiz", status: "Active", groupIds: ["g-month"] }),
      createStudent({ id: "diego", code: "D-1", fullName: "Diego Mora", status: "Active", groupIds: ["g-class"] }),
    ];
    state.classLog = [
      {
        id: "old-class",
        classDate: "2026-02-12",
        studentId: "diego",
        groupId: "g-class",
        startTime: "17:00",
        classTitle: "",
        scheduleSlotId: "",
        scheduleOccurrenceDate: "2026-02-12",
        classStatus: "Completed",
        attendance: "P",
        hours: 2,
        appliedHourlyRate: 125,
        appliedCharge: 250,
        amountPaid: 0,
        paymentState: "Pending",
        paymentDate: null,
        paymentMethod: "",
        paymentReference: "",
        notes: "",
      },
    ];
    localStorage.clear();
    localStorage.setItem("minimal-class-manager:v1", JSON.stringify(state));
    localStorage.setItem("hibi:language:v1", "es");
  }, TODAY);
}

test.describe("pagos perdidos en escritorio", () => {
  test.use({ viewport: { width: 1440, height: 900 }, locale: "es-MX", timezoneId: "America/Mexico_City" });

  test("marca un mes, lo deshace, y los perdidos se recuperan uno por uno", async ({ page }) => {
    await seed(page);
    await page.goto("/progress");
    await page.getByRole("tab", { name: "Pagos" }).click();
    await page.locator(".tsr", { hasText: "Luna Ortiz" }).click();
    const debts = page.locator(".debts");
    await expect(debts.locator(".debt-row")).toHaveCount(8);

    // Lost does not count as owed; nothing is added to what was collected.
    await debts.getByRole("button", { name: "Dar por perdido: Mayo" }).click();
    await expect(page.locator(".tlist-foot", { hasText: "Perdidos" })).toContainText("$800");
    await expect(page.locator(".tsr", { hasText: "Luna Ortiz" })).toContainText("$5,600");
    await expect(page.locator(".stats")).toContainText("$0");

    await page.locator(".toast", { hasText: "Mayo perdida" }).getByRole("button", { name: "Deshacer" }).click();
    await expect(page.locator(".tlist-foot", { hasText: "Perdidos" })).toHaveCount(0);
    await expect(page.locator(".tsr", { hasText: "Luna Ortiz" })).toContainText("$6,400");

    await debts.getByRole("button", { name: "Dar por perdido: Abril" }).click();
    await expect(page.locator(".tlist-foot", { hasText: "Perdidos" })).toContainText("$800");
    await debts.getByRole("button", { name: "Dar por perdido: Mayo" }).click();
    await expect(page.locator(".tlist-foot", { hasText: "Perdidos" })).toContainText("$1,600");

    // Marks survive a reload.
    await page.reload();
    await page.getByRole("tab", { name: "Pagos" }).click();
    await page.locator(".tlist-foot", { hasText: "Perdidos" }).getByRole("button", { name: "Ver" }).click();

    const panel = page.getByRole("dialog");
    await panel.locator(".lost-toggle").click();
    await panel.getByRole("button", { name: /Recuperar: Abril/ }).click();
    await expect(panel.getByRole("heading", { name: "Perdidos · $800" })).toBeVisible();
    await panel.getByRole("button", { name: /Recuperar: Mayo/ }).click();
    await expect(panel).toHaveCount(0);
    await expect(page.locator(".tsr", { hasText: "Luna Ortiz" })).toContainText("$6,400");
  });

  test("un reporte anterior muestra la deuda como adeudada y Comunidad conserva lo escrito", async ({ page }) => {
    await seed(page);
    await page.goto("/progress");
    await page.getByRole("tab", { name: "Pagos" }).click();
    await page.locator(".tsr", { hasText: "Diego Mora" }).click();
    await page
      .locator(".debts")
      .getByRole("button", { name: /^Dar por perdido/ })
      .click();
    await expect(page.locator(".tlist-foot", { hasText: "Perdidos" })).toContainText("$250");

    await page.getByRole("button", { name: "Fecha de consulta", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Fecha de consulta" });
    await dialog.getByRole("combobox", { name: "Fecha de consulta" }).click();
    await page.getByRole("dialog", { name: "Elegir fecha" }).locator(".date-day", { hasText: /^3$/ }).first().click();
    await dialog.getByRole("button", { name: "Aplicar" }).click();
    await expect(page.locator(".tlist-foot", { hasText: "Perdidos" })).toHaveCount(0);
    await expect(page.locator(".debts .is-lost")).toHaveCount(0);
    await expect(page.locator(".debts").getByRole("button", { name: /^Recuperar/ })).toHaveCount(0);

    await page.goto("/community");
    await page.getByRole("button", { name: "Abrir Luna Ortiz" }).click();
    await page.getByLabel("Notas breves").fill("Paga en efectivo");
    await page.locator(".debts").getByRole("button", { name: "Dar por perdido: Abril" }).click();
    await expect(page.locator(".debt-row.is-lost")).toHaveCount(1);
    await expect(page.getByLabel("Notas breves")).toHaveValue("Paga en efectivo");
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await page.reload();
    await page.getByRole("button", { name: "Abrir Luna Ortiz" }).click();
    await expect(page.getByLabel("Notas breves")).toHaveValue("Paga en efectivo");
    await expect(page.locator(".debt-row.is-lost")).toHaveCount(1);
  });

  test("el aviso de Inicio junta lo viejo y nada viene marcado", async ({ page }) => {
    await seed(page);
    await page.goto("/");
    await page.locator("button.al", { hasText: "con más de 3 meses" }).click();
    const panel = page.getByRole("dialog");
    await expect(panel.getByRole("button", { name: "Dar por perdido" })).toBeDisabled();
    await panel.getByRole("checkbox", { name: "Diego Mora" }).check();
    await expect(panel.locator(".lost-total")).toContainText("$250");
    await panel.getByRole("button", { name: "Dar por perdido" }).click();
    await expect(page.locator(".toast", { hasText: "$250 dados por perdidos" })).toBeVisible();
    await expect(page.locator(".dnote", { hasText: "Diego" })).toHaveCount(0);
  });
});

test.describe("pagos perdidos en tableta", () => {
  test.use({
    viewport: { width: 820, height: 1180 },
    hasTouch: true,
    locale: "es-MX",
    timezoneId: "America/Mexico_City",
  });

  test("el control táctil mide 40 px y marca sin salirse de la pantalla", async ({ page }) => {
    await seed(page);
    await page.goto("/progress");
    await page.getByRole("tab", { name: "Pagos" }).click();
    await page.locator(".tsr", { hasText: "Luna Ortiz" }).click();
    const button = page.locator(".debts").getByRole("button", { name: "Dar por perdido: Mayo" });
    const box = await button.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(40);
    expect(box.x + box.width).toBeLessThanOrEqual(820);
    await button.click();
    await expect(page.locator(".debt-row.is-lost")).toHaveCount(1);
    const overflow = await page.evaluate(() => globalThis.document.documentElement.scrollWidth - globalThis.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe("pagos perdidos en teléfono", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    locale: "es-MX",
    timezoneId: "America/Mexico_City",
  });

  test("la hoja del alumno usa el ícono y Perdidos abre por mes", async ({ page }) => {
    await seed(page);
    await page.goto("/progress");
    await page.getByText("Pagos", { exact: true }).first().click();
    await page.getByText("Luna Ortiz", { exact: true }).first().click();
    await page.locator('.ssh-stamp[aria-label^="Mayo"]').click();
    await page.locator(".ssh-fee-foot .lost-icon").click();
    await expect(page.locator(".ssh-chip")).toContainText("Perdida · hoy");
    await expect(page.locator(".ssh-pay")).toHaveCount(0);
    await expect(page.locator('.ssh-stamp[aria-label^="Mayo"]')).toHaveClass(/is-lost/);
    await page.locator(".ssh-fee-foot .lost-icon").click();
    await expect(page.locator(".ssh-chip")).toContainText("Vencida");
    await page.locator(".ssh-fee-foot .lost-icon").click();
    await page.locator('.ssh-stamp[aria-label^="Junio"]').click();
    await page.locator(".ssh-fee-foot .lost-icon").click();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /^Perdidos/ }).click();
    await page.locator(".lost-toggle").click();
    await expect(page.locator(".lost-sub")).toHaveCount(2);
    // The notice stays out of the way of the next row to recover.
    const toast = await page.locator(".toast").last().boundingBox();
    const row = await page.locator(".lost-sub").last().boundingBox();
    expect(toast.y + toast.height).toBeLessThanOrEqual(row.y);
  });
});

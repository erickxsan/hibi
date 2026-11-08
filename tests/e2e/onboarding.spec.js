import { expect, test } from "@playwright/test";

// The assertions use the Spanish copy; do not depend on the machine language.
test.use({ locale: "es-MX" });

const DAY_TITLES = [
  "Tu día, de un vistazo",
  "Un grupo arma tu agenda",
  "Pasa lista en segundos",
  "Cobra sin llevar la cuenta",
  "Ve quién necesita ayuda",
  "Y descansa",
];

async function expectNoSideScroll(page) {
  const overflow = await page.evaluate(() => globalThis.document.documentElement.scrollWidth - globalThis.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

/** Walks the six moments of the day; each one waits for the click, and its button is always in reach. */
async function walkTheDay(tutorial, page, testInfo) {
  for (const [index, title] of DAY_TITLES.entries()) {
    await expect(tutorial.getByRole("heading", { level: 1, name: title })).toBeVisible();
    const next = tutorial.getByRole("button", { name: index === DAY_TITLES.length - 1 ? "Ahora tú" : "Siguiente" });
    await expect(next).toBeInViewport();
    await expectNoSideScroll(page);
    await page.screenshot({ path: testInfo.outputPath(`day-${index}.png`), animations: "disabled" });
    await next.click();
  }
}

/** The practice class: open it, take the roll, record a payment, save it, then Tracking and Community. */
async function practiceAClass(tutorial, page, testInfo) {
  const guide = tutorial.getByRole("region", { name: "Guía" });
  const step = async (name) => {
    await expect(guide).toBeInViewport();
    await expectNoSideScroll(page);
    await page.screenshot({ path: testInfo.outputPath(`practice-${name}.png`), animations: "disabled" });
  };
  await expect(guide).toContainText("Te toca: abre tu clase");
  await step("home");
  await tutorial.getByRole("button", { name: "Registrar clase" }).click();
  await expect(guide).toContainText("0 de 4 alumnos");
  await step("roll");
  const marks = {
    "Emilio Castro": "Presente",
    "Iker Morales": "Presente",
    "Renata Ortiz": "Ausente",
    "Ximena Flores": "Presente",
  };
  for (const [student, mark] of Object.entries(marks)) {
    await tutorial
      .getByRole("group", { name: `Asistencia de ${student}` })
      .getByRole("button", { name: mark })
      .click();
  }
  await expect(guide).toContainText("Registra un pago");
  await tutorial
    .getByRole("group", { name: "Pago de Emilio Castro" })
    .getByRole("button", { name: "Pagado", exact: true })
    .click();
  await expect(guide).toContainText("Guárdala");
  await step("save");
  await tutorial.getByRole("button", { name: "Guardar clase" }).click();
  await expect(guide).toContainText("Ya quedó en Inicio");
  await expect(tutorial.getByText("3 presentes y $280 cobrados.")).toBeVisible();
  await tutorial.getByRole("button", { name: "Seguimiento" }).click();
  await expect(guide).toContainText("Todo se acomodó solo");
  await step("tracking");
  await tutorial.getByRole("button", { name: "Comunidad" }).click();
  await expect(guide).toContainText("Cada grupo, en una ficha");
  await step("community");
  await tutorial.getByRole("button", { name: "Ahora lo mío" }).click();
}

test("watches a day, practices a class, creates the first group and lands in Home", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page).toHaveTitle(/hibi/);
  const tutorial = page.getByRole("dialog", { name: "Tutorial de bienvenida" });
  await expect(tutorial.getByRole("heading", { level: 1, name: DAY_TITLES[0] })).toBeVisible();
  // Nothing moves on by itself: the moment plays its example and waits for the click.
  await page.waitForTimeout(7000);
  await expect(tutorial.getByRole("heading", { level: 1, name: DAY_TITLES[0] })).toBeVisible();
  await walkTheDay(tutorial, page, testInfo);
  await tutorial.getByRole("button", { name: "Dar mi clase de práctica" }).click();
  await practiceAClass(tutorial, page, testInfo);

  await expect(tutorial.getByRole("heading", { name: "Tu primer grupo" })).toBeVisible();
  await tutorial.getByLabel("Nombre del grupo").fill("Inglés B1");
  await page.screenshot({ path: testInfo.outputPath("group.png"), animations: "disabled" });
  await tutorial.getByRole("button", { name: "Crear mi agenda" }).click();
  await expect(tutorial.getByRole("heading", { name: "Ya sabes dar clase en Hibi" })).toBeVisible();
  await tutorial.getByRole("button", { name: "Entrar a mi Hibi" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(/\/$/);

  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("minimal-class-manager:v1")));
  expect(saved.groups).toHaveLength(1);
  expect(saved.groups[0].name).toBe("Inglés B1");
  expect(saved.groups[0].weeklySchedule.map((slot) => [slot.dayOfWeek, slot.startTime])).toEqual([
    [2, "17:30"],
    [4, "17:30"],
  ]);
  expect(saved.students).toHaveLength(0);
  expect(saved.settings.onboardingVersion).toBe(2);
  // The new group's schedule starts today, so earlier weekdays never show up as unrecorded classes.
  const now = new Date();
  const today = [now.getFullYear(), now.getMonth() + 1, now.getDate()].map((part) => String(part).padStart(2, "0"));
  expect(saved.groups[0].scheduleResumeDate).toBe(today.join("-"));

  await page.reload();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goto("/settings");
  await page.getByRole("button", { name: /^Tutorial de bienvenida/ }).click();
  await page.getByRole("button", { name: "Iniciar recorrido" }).click();
  await expect(tutorial.getByRole("heading", { level: 1, name: DAY_TITLES[0] })).toBeVisible();
  await tutorial.getByRole("button", { name: "Saltar" }).click();
  await tutorial.getByRole("button", { name: "Saltar a crear mi grupo" }).click();
  await tutorial.getByRole("button", { name: "Ahora no" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const replayed = await page.evaluate(() => JSON.parse(localStorage.getItem("minimal-class-manager:v1")));
  expect(replayed.groups).toHaveLength(1);
  expect(errors).toEqual([]);
});

test("a tutorial that cannot load keeps the app usable and offers a reload", async ({ page }) => {
  // A tab left open across a deploy asks for a chunk that no longer exists; Pages answers with index.html.
  await page.route(/OnboardingTutorial/, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><html></html>" }),
  );
  await page.goto("/");
  const prompt = page.getByRole("alertdialog", { name: "No se pudo abrir el tutorial" });
  await expect(prompt).toBeVisible();
  await expect(page.locator(".hibi-shell")).toBeVisible();
  await prompt.getByRole("button", { name: "Ahora no" }).click();
  await expect(prompt).toHaveCount(0);
  await page.getByRole("link", { name: "Configuración" }).first().click();
  await expect(page).toHaveURL(/\/settings$/);
});

for (const viewport of [
  { width: 320, height: 740 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1046, height: 630 },
]) {
  test.describe("tutorial at " + viewport.width + "px", () => {
    test.use({ viewport });
    test("keeps every moment, practice step and the group form readable and reachable", async ({ page }, testInfo) => {
      test.setTimeout(90_000);
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto("/");
      const tutorial = page.getByRole("dialog", { name: "Tutorial de bienvenida" });
      await walkTheDay(tutorial, page, testInfo);
      await tutorial.getByRole("button", { name: "Dar mi clase de práctica" }).click();
      await practiceAClass(tutorial, page, testInfo);
      const form = tutorial.locator("form");
      await form.getByLabel("Nombre del grupo").fill("Grupo de prueba");
      const widths = await form.evaluate((node) => ({ content: node.scrollWidth, available: node.clientWidth }));
      expect(widths.content).toBeLessThanOrEqual(widths.available);
      await expect(form.getByRole("button", { name: "Crear mi agenda" })).toBeInViewport();
      await page.screenshot({ path: testInfo.outputPath("group.png"), animations: "disabled" });
      await form.getByRole("button", { name: "Crear mi agenda" }).click();
      await expect(tutorial.getByRole("button", { name: "Entrar a mi Hibi" })).toBeInViewport();
      await tutorial.getByRole("button", { name: "Entrar a mi Hibi" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  });
}

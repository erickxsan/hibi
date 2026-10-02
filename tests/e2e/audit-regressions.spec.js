import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";

test("keeps real names and live counts correct after switching Spanish to English", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(async () => {
    const modulePath = "/src/domain/index.js";
    const { createStarterState, createStudent } = await import(modulePath);
    const state = createStarterState({ settings: { onboardingVersion: 2 } });
    state.students = ["Home", "Tracking"].map((fullName, i) => createStudent({ id: `s${i}`, code: `S${i}`, fullName }));
    localStorage.clear();
    localStorage.setItem("minimal-class-manager:v1", JSON.stringify(state));
    localStorage.setItem("hibi:language:v1", "en");
  });
  await page.goto("/community");
  await expect(page.locator(".community-active-count strong")).toHaveText("2");
  await page.locator(".hibi-sidebar").getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "ES", exact: true }).click();
  await page.locator(".hibi-sidebar").getByRole("link", { name: "Comunidad", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Comunidad", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Abrir Home", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Todos", exact: true })).toBeVisible();
  await page.locator(".hibi-sidebar").getByRole("link", { name: "Configuración", exact: true }).click();
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await page.locator(".hibi-sidebar").getByRole("link", { name: "Community", exact: true }).click();
  await page.getByRole("button", { name: "Add student", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Add student", exact: true });
  await editor.getByLabel(/Student ID/).fill("S3");
  await editor.getByLabel(/Full name/).fill("Settings");
  await editor.getByRole("button", { name: "Save student", exact: true }).click();
  await expect(page.locator(".community-active-count strong")).toHaveText("3");
  await expect(page.getByRole("button", { name: "Open Settings", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Home", exact: true })).toBeVisible();
});

test("records mobile timing with 1000 students and exercises the paged directory and tracking", async ({
  page,
}, testInfo) => {
  test.setTimeout(90000);
  const slowExpect = expect.configure({ timeout: 30000 });
  await page.setViewportSize({ width: 390, height: 844 });
  const protocol = await page.context().newCDPSession(page);
  await protocol.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.addInitScript(() => {
    const stats = { lcp: 0, cls: 0, maxInteractionDuration: 0, longTasks: 0, longTaskDuration: 0 };
    globalThis["hibiMetrics"] = stats;
    for (const type of ["largest-contentful-paint", "layout-shift", "event", "longtask"]) {
      if (!PerformanceObserver.supportedEntryTypes.includes(type)) continue;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const data = entry;
          if (type === "largest-contentful-paint") stats.lcp = entry.startTime;
          if (type === "layout-shift" && !data["hadRecentInput"]) stats.cls += data["value"];
          if (type === "event" && data["interactionId"])
            stats.maxInteractionDuration = Math.max(stats.maxInteractionDuration, entry.duration);
          if (type === "longtask") {
            stats.longTasks++;
            stats.longTaskDuration += entry.duration;
          }
        }
      }).observe(Object.assign({ type, buffered: true }, { durationThreshold: 16 }));
    }
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(async () => {
    const modulePath = "/src/domain/index.js";
    const { createStarterState, createStudent, createGroup, createGrade, createClassLogRow } = await import(modulePath);
    const state = createStarterState({ settings: { onboardingVersion: 2 } });
    state.groups = Array.from({ length: 50 }, (_, i) => createGroup({ id: `g${i}`, name: `Group ${i}` }));
    state.students = Array.from({ length: 1000 }, (_, i) =>
      createStudent({
        id: `s${i}`,
        code: `S${i}`,
        fullName: `Person ${String(i).padStart(4, "0")}`,
        groupIds: [`g${i % 50}`],
      }),
    );
    state.grades = state.students.map((student, i) =>
      createGrade({
        id: `grade${i}`,
        studentId: student.id,
        date: state.settings.asOfDate,
        assessment: "Synthetic quiz",
        score: 8,
        maxScore: 10,
      }),
    );
    state.classLog = state.students.map((student, i) =>
      createClassLogRow({
        id: `class${i}`,
        studentId: student.id,
        groupId: student.groupIds[0],
        classDate: state.settings.asOfDate,
        hours: 1,
        attendance: "P",
        appliedCharge: 100,
        appliedHourlyRate: 100,
        amountPaid: 25,
        paymentDate: state.settings.asOfDate,
      }),
    );
    localStorage.clear();
    localStorage.setItem("minimal-class-manager:v1", JSON.stringify(state));
    localStorage.setItem("hibi:language:v1", "en");
  });
  await page.goto("/community");
  await slowExpect(page.getByRole("button", { name: "Open Person 0000", exact: true })).toBeVisible();
  await slowExpect(page.getByRole("table", { name: "Students", exact: true }).getByRole("row")).toHaveCount(26);
  await page.getByRole("button", { name: "Next page", exact: true }).first().click();
  await slowExpect(page.getByRole("button", { name: "Open Person 0025", exact: true })).toBeVisible();
  await slowExpect(page.getByRole("table", { name: "Students", exact: true }).getByRole("row")).toHaveCount(26);
  await page.locator(".hibi-mobile-nav").getByRole("link", { name: "Tracking", exact: true }).click();
  await slowExpect(page.getByRole("tab", { name: "Grades", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Payments", exact: true }).click();
  await slowExpect(page.getByRole("tabpanel")).toBeVisible();
  await slowExpect(page.locator(".tracking-table-payments tbody tr")).toHaveCount(25);
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await slowExpect(page.locator(".tracking-table-payments tbody tr")).toHaveCount(25);
  await page.evaluate(
    () => new Promise((resolve) => globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve))),
  );
  const metrics = await page.evaluate(() => globalThis["hibiMetrics"]);
  const result = {
    fixture: { students: 1000, groups: 50, grades: 1000, classes: 1000 },
    viewport: { width: 390, height: 844 },
    cpuThrottle: 4,
    metrics,
    scope: "Local dev build, synthetic fixture; event duration is an INP proxy, not production Web Vitals.",
  };
  await writeFile(testInfo.outputPath("performance.json"), JSON.stringify(result, null, 2));
  await testInfo.attach("synthetic-mobile-performance", {
    body: JSON.stringify(result),
    contentType: "application/json",
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const base = read("./components/base-components.css");
const charts = read("./components/charts.css");
const tracking = read("./features/tracking.css");
const settings = read("./features/settings.css");
const auth = read("./auth/auth.css");
const onboarding = read("./onboarding/onboarding.css");
const ui = read("./components/Drawer.jsx");

describe("mobile responsive layout contracts", () => {
  it("keeps primary tab bars on one axis without visible mobile scrollbars", () => {
    expect(base).toMatch(/\.tabs\s*\{[^}]*overflow-x:\s*auto;[^}]*overflow-y:\s*hidden;[^}]*scrollbar-width:\s*none/);
    expect(base).toMatch(/\.tab\s*\{\s*flex:\s*none/);
  });

  it("scopes shared chart marks to .hibi-chart and honours reduced motion", () => {
    const rules = charts.match(/^[^@\s}][^{]*\{/gm) || [];
    expect(rules.length).toBeGreaterThan(10);
    for (const rule of rules) expect(rule).toMatch(/\.hibi-chart|^@keyframes|^from|^to|^\d+%/);
    expect(charts).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(charts).toMatch(/\.hibi-chart svg\.ln\s*\{[^}]*width:\s*100%/);
  });

  it("collapses tracking, settings, sign-in and the tutorial at phone width", () => {
    expect(tracking).toMatch(/@media \(max-width: 980px\)/);
    expect(settings).toMatch(/@media \(max-width: 780px\)[\s\S]*\.settings-detail\s*\{\s*padding-left:\s*0/);
    expect(auth).toMatch(/@media \(max-width: 700px\)[\s\S]*\.auth-mascot\s*\{\s*display:\s*none/);
    expect(onboarding).toMatch(
      /@media \(max-width: 600px\)[\s\S]*\.onboarding-field-grid\s*\{\s*grid-template-columns:\s*1fr/,
    );
  });

  it("locks the root scroller for drawers", () => {
    expect(ui).toContain('document.documentElement.classList.add("drawer-open")');
    expect(ui).toContain('document.documentElement.classList.remove("drawer-open")');
  });
});

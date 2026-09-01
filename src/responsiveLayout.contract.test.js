import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const designSystem = readFileSync(new URL("./design-system.css", import.meta.url), "utf8");
const appShell = readFileSync(new URL("./components/AppShell.jsx", import.meta.url), "utf8");
const ui = readFileSync(new URL("./components/ui.jsx", import.meta.url), "utf8");

describe("mobile responsive layout contracts", () => {
  it("keeps primary tab bars on one axis without visible mobile scrollbars", () => {
    expect(designSystem).toMatch(/overflow-y:\s*hidden/);
    expect(designSystem).toMatch(/scrollbar-width:\s*none/);
    expect(designSystem).toMatch(/flex:\s*1 1 0/);
  });

  it("scopes tracking chart dimensions to the chart svg itself", () => {
    expect(styles).toMatch(/\.tracking-chart\s*>\s*svg\s*\{/);
    expect(styles).not.toMatch(/\.tracking-chart svg\s*\{\s*width:\s*100%/);
    expect(styles).toMatch(/\.tracking-chart\s*>\s*svg\s*\{\s*min-width:\s*0/);
  });

  it("keeps payment analytics responsive and empty tables compact", () => {
    expect(styles).toMatch(/\.payment-analytics\s*\{\s*overflow:\s*hidden/);
    expect(styles).toMatch(/\.payment-projection-chart\s*\{\s*min-width:\s*0/);
    expect(styles).toMatch(/\.tracking-table-shell:has\(tbody:empty\) table\s*\{\s*display:\s*none/);
    expect(styles).toMatch(/\.tracking-table-shell table\s*\{\s*min-width:\s*100%;\s*table-layout:\s*fixed/);
    expect(styles).toMatch(
      /\.tracking-table-shell \.tracking-col-date\s*,\s*\.tracking-table-shell \.tracking-col-secondary\s*\{\s*display:\s*none/,
    );
  });

  it("locks the root scroller for drawers and the mobile More menu", () => {
    expect(ui).toContain('document.documentElement.classList.add("drawer-open")');
    expect(ui).toContain('document.documentElement.classList.remove("drawer-open")');
    expect(appShell).toContain('document.documentElement.classList.add("mobile-more-open")');
    expect(appShell).toContain('event.key !== "Tab"');
  });

  it("keeps the mobile Record action prominent above locked choice sheets", () => {
    expect(appShell).toContain("item.mobileIcon || item.icon");
    expect(appShell).toContain('item.id === "classes" ? "mobile-record-link"');
    expect(styles).toMatch(/body\.select-sheet-open \.hibi-mobile-nav\s*\{/);
    expect(styles).toMatch(/\.mobile-record-link\s*>\s*svg\s*\{/);
  });

  it("retains compact calendar, settings, and home overrides", () => {
    expect(styles).toMatch(/\.calendar-period-controls\s*>\s*button\s*\{\s*width:\s*34px/);
    expect(styles).toMatch(/\.sound-toggle\s*\{\s*width:\s*92px/);
    expect(styles).toMatch(/\.home-revenue-chart svg\s*\{\s*min-width:\s*0/);
    expect(designSystem).toMatch(/\.home-dashboard-header h1\s*\{\s*font-size:\s*25px/);
  });
});

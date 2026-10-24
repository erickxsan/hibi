// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { AccountMenu, accountPanelPosition } from "./AccountMenu";

function rect(left, top, width = 118, height = 30) {
  return { left, top, right: left + width, bottom: top + height };
}

function inside(position, viewportWidth, viewportHeight) {
  const top = position.top ?? viewportHeight - position.bottom - position.maxHeight;
  return (
    position.left >= 12 &&
    position.left + position.width <= viewportWidth - 12 &&
    top >= 12 &&
    top + position.maxHeight <= viewportHeight - 12
  );
}

describe("account menu panel position", () => {
  it("opens above the sidebar pill and stays inside a desktop window", () => {
    const position = accountPanelPosition(rect(22, 666), "up", 1280, 720);
    expect(position).toMatchObject({ position: "fixed", left: 22, bottom: 62, width: 280 });
    expect(inside(position, 1280, 720)).toBe(true);
  });

  it("never runs past a short window or a narrow phone", () => {
    expect(inside(accountPanelPosition(rect(22, 420), "up", 1024, 480), 1024, 480)).toBe(true);
    const phone = accountPanelPosition(rect(196, 12), "down", 320, 568);
    expect(phone.width).toBe(280);
    expect(inside(phone, 320, 568)).toBe(true);
    const tiny = accountPanelPosition(rect(150, 12), "down", 280, 500);
    expect(tiny.width).toBe(256);
    expect(inside(tiny, 280, 500)).toBe(true);
  });
});

describe("account menu trigger", () => {
  it("starts its accessible name with the visible status and leaves out the email", () => {
    localStorage.setItem("hibi:language:v1", "es");
    try {
      render(
        <I18nProvider>
          <AccountMenu email="teacher@example.test" syncStatus="synced" onSignOut={vi.fn()} />
        </I18nProvider>,
      );
      const trigger = screen.getByRole("button", { name: "Sincronizado · Menú de la cuenta" });
      expect(trigger).toHaveTextContent("Sincronizado");
      expect(trigger.getAttribute("aria-label")).not.toContain("teacher@example.test");
      fireEvent.click(trigger);
      const panel = screen.getByRole("region", { name: "Opciones de la cuenta" });
      expect(panel).toHaveTextContent("teacher@example.test");
      expect(panel.style.position).toBe("fixed");
      expect(panel.style.maxHeight).not.toBe("");
    } finally {
      localStorage.removeItem("hibi:language:v1");
    }
  });
});

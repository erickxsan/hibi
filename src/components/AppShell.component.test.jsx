// @vitest-environment jsdom

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { AppShell } from "./AppShell";

function testIcon(name) {
  return function TestIcon({ size, ...props }) {
    return <svg data-icon={name} data-size={size} {...props} />;
  };
}

describe("AppShell mobile navigation", () => {
  it("uses the same five destinations, labels, and icons as desktop", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    const navItems = [
      { id: "home", label: "Home", href: "/", icon: testIcon("home") },
      { id: "community", label: "Community", href: "/community", icon: testIcon("community") },
      {
        id: "classes",
        label: "Classes",
        href: "/classes",
        icon: testIcon("classes"),
      },
      { id: "grades", label: "Tracking", href: "/progress", icon: testIcon("tracking") },
      { id: "settings", label: "Settings", href: "/settings", icon: testIcon("settings") },
    ];

    render(
      <AppShell navItems={navItems} activePage="classes" onNavigate={onNavigate}>
        <p>Class workspace</p>
      </AppShell>,
    );

    const mobileNav = screen.getByRole("navigation", { name: "Mobile navigation" });
    const desktopNav = screen.getByRole("navigation", { name: "Primary navigation" });
    const mobileLinks = within(mobileNav).getAllByRole("link");
    const desktopLinks = within(desktopNav).getAllByRole("link");
    expect(mobileLinks).toHaveLength(5);
    expect(mobileLinks.map((link) => link.textContent)).toEqual(desktopLinks.map((link) => link.textContent));
    for (const [index, link] of mobileLinks.entries()) {
      expect(link).toHaveAttribute("href", desktopLinks[index].getAttribute("href"));
      expect(link.querySelector("svg").dataset.icon).toBe(desktopLinks[index].querySelector("svg").dataset.icon);
      await user.click(link);
      expect(onNavigate).toHaveBeenLastCalledWith(navItems[index].id);
    }
    expect(within(mobileNav).getByRole("link", { name: "Classes" })).toHaveAttribute("aria-current", "page");
    expect(
      within(mobileNav).getByRole("link", { name: "Settings" }).querySelector('[data-icon="settings"]'),
    ).toBeInTheDocument();
    expect(within(mobileNav).queryByRole("button")).not.toBeInTheDocument();
    expect(within(mobileNav).queryByText("Record")).not.toBeInTheDocument();
  });

  it("names the Spanish settings tab with the same word it shows", () => {
    localStorage.setItem("hibi:language:v1", "es");
    try {
      render(
        <I18nProvider>
          <AppShell
            navItems={[
              { id: "home", label: "Home", href: "/", icon: testIcon("home") },
              {
                id: "settings",
                label: "Settings",
                mobileLabel: "Adjustments",
                href: "/settings",
                icon: testIcon("settings"),
              },
            ]}
            activePage="home"
            onNavigate={vi.fn()}
          >
            <p>Inicio</p>
          </AppShell>
        </I18nProvider>,
      );
      const mobileNav = screen.getByRole("navigation", { name: "Navegación móvil" });
      const settings = within(mobileNav).getByRole("link", { name: "Ajustes" });
      expect(settings).toHaveTextContent("Ajustes");
      expect(settings).not.toHaveAttribute("aria-label");
      expect(within(mobileNav).queryByRole("link", { name: "Configuración" })).not.toBeInTheDocument();
    } finally {
      localStorage.removeItem("hibi:language:v1");
    }
  });
});

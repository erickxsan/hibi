// @vitest-environment jsdom

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";

function testIcon(name) {
  return function TestIcon({ size, ...props }) {
    return <svg data-icon={name} data-size={size} {...props} />;
  };
}

describe("AppShell mobile navigation", () => {
  it("keeps Tracking visible and presents Classes as the primary Record action", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    const navItems = [
      { id: "home", label: "Home", href: "/", icon: testIcon("home") },
      { id: "community", label: "Community", href: "/community", icon: testIcon("community") },
      {
        id: "classes",
        label: "Classes",
        mobileLabel: "Record",
        href: "/classes",
        icon: testIcon("classes"),
        mobileIcon: testIcon("record"),
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
    const recordLink = within(mobileNav).getByRole("link", { name: "Record" });
    expect(recordLink).toHaveClass("mobile-record-link", "active");
    expect(recordLink.querySelector('[data-icon="record"]')).toHaveAttribute("data-size", "24");
    expect(within(mobileNav).getByRole("link", { name: "Tracking" })).toBeInTheDocument();
    expect(within(mobileNav).getByRole("button", { name: "More" })).toBeInTheDocument();

    await user.click(recordLink);
    expect(onNavigate).toHaveBeenCalledWith("classes");
  });
});

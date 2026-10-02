// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { I18nProvider, LanguageToggle, useI18n, uiText, translateMessage } from "./index.jsx";
import { LANGUAGE_STORAGE_KEY } from "./translations.js";
import { Field, Input, MultiSelect } from "../components/ui.jsx";
import { AppShell } from "../components/AppShell.jsx";
function Counter() {
  const { t } = useI18n();
  const [count, setCount] = useState(2);
  return (
    <>
      <LanguageToggle />
      <span>{t("{count} students", { count })}</span>
      <button aria-label={t("Delete {name}", { name: `Home ${count}` })} onClick={() => setCount(count + 1)}>
        Update
      </button>
      <b>Home</b>
    </>
  );
}
describe("render-time localization and primitive contracts", () => {
  it("translates explicit UI plural choices while preserving opaque user parameters", () => {
    expect(translateMessage("{p0} {p1} today", { p0: 2, p1: uiText("classes") }, "es")).toBe("2 clases hoy");
    expect(translateMessage("{p0} {p1} today", { p0: 1, p1: uiText("class") }, "es")).toBe("1 clase hoy");
    expect(translateMessage("Delete {name}", { name: "Home" }, "es")).toBe("Eliminar Home");
  });
  it("updates state and accessible names after ES to EN without translating user names", () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, "en");
    render(
      <I18nProvider>
        <Counter />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "ES" }));
    expect(screen.getByText("Home")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "EN" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete Home 2" }));
    expect(screen.getByText("3 students")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete Home 3" })).toBeInTheDocument();
  });
  it("localizes real shell navigation while retaining its data", () => {
    render(
      <I18nProvider>
        <LanguageToggle />
        <AppShell
          navItems={[{ id: "home", label: "Home", href: "/", icon: () => null }]}
          activePage="home"
          onNavigate={() => {}}
        >
          <p>Home</p>
        </AppShell>
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "ES" }));
    expect(screen.getAllByRole("link", { name: "Inicio" }).length).toBeGreaterThan(0);
    expect(screen.getByText("Home")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "EN" }));
  });
  it("links a nested control when a field also contains a suffix", () => {
    render(
      <Field label="Amount" hint="In pesos" required>
        <span>
          <Input />
          <span>$</span>
        </span>
      </Field>,
    );
    const input = screen.getByRole("textbox", { name: "Amount" });
    expect(input).toBeRequired();
    expect(input).toHaveAccessibleDescription("In pesos");
  });
  it("links errors and required state even with an existing accessible name", () => {
    render(
      <Field label="Name" hint="Hint" error="Invalid name" required>
        <Input aria-label="Already named" />
      </Field>,
    );
    const input = screen.getByRole("textbox", { name: "Already named" });
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-required", "true");
    expect(input).toBeRequired();
    expect(document.getElementById(input.getAttribute("aria-describedby"))).toHaveTextContent("Invalid name");
  });
  it("prevents chips, Clear, options and keyboard changes after becoming disabled", () => {
    const onChange = () => {
      throw new Error("Disabled control changed");
    };
    const props = { ariaLabel: "People", options: [{ value: "a", label: "Home" }], value: ["a"], onChange };
    const view = render(<MultiSelect {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "People" }));
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    view.rerender(<MultiSelect {...props} disabled />);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove Home" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Clear" })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole("button", { name: "People" }), { key: "ArrowDown" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});

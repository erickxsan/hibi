// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ClassManagerApplication from "../ClassManagerApplication.jsx";
import { NewVersionDialog } from "./NewVersionDialog.jsx";
import { createStarterState, DATA_VERSION, STORAGE_KEY } from "../domain/index.js";
import { I18nProvider } from "../i18n/index.jsx";

function renderInLanguage(language, element) {
  localStorage.setItem("hibi:language:v1", language);
  return render(<I18nProvider>{element}</I18nProvider>);
}

beforeEach(() => {
  localStorage.clear();
});

describe("new version dialog", () => {
  it("offers only a reload and cannot be dismissed", async () => {
    const user = userEvent.setup();
    const onReload = vi.fn();
    renderInLanguage(
      "en",
      <>
        <div className="app-shell">
          <button type="button">Behind</button>
        </div>
        <NewVersionDialog onReload={onReload} />
      </>,
    );
    const dialog = screen.getByRole("alertdialog", { name: "A new version of Hibi is available" });
    expect(dialog).toHaveAccessibleDescription("Reload to keep saving your changes.");
    expect(document.querySelector(".app-shell")).toHaveAttribute("inert");
    const reload = screen.getByRole("button", { name: "Reload" });
    expect(reload).toHaveFocus();
    expect(dialog.querySelectorAll("button")).toHaveLength(1);
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.mouseDown(dialog.parentElement);
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    await user.click(reload);
    expect(onReload).toHaveBeenCalledOnce();
  });

  it("speaks Spanish", () => {
    renderInLanguage("es", <NewVersionDialog onReload={() => {}} />);
    expect(screen.getByRole("alertdialog", { name: "Hay una versión nueva de Hibi" })).toHaveAccessibleDescription(
      "Recarga para seguir guardando tus cambios.",
    );
    expect(screen.getByRole("button", { name: "Recargar" })).toBeInTheDocument();
  });

  it("covers the app when the saved records come from a newer Hibi", async () => {
    const state = createStarterState({ settings: { onboardingVersion: 2 } });
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...state, settings: { ...state.settings, dataVersion: DATA_VERSION + 1 } }),
    );
    renderInLanguage("en", <ClassManagerApplication />);
    expect(await screen.findByRole("alertdialog", { name: "A new version of Hibi is available" })).toBeInTheDocument();
    expect(document.querySelector(".app-shell, .hibi-shell")).toHaveAttribute("inert");
  });

  it("stays away while the records are this build's", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(createStarterState({ settings: { onboardingVersion: 2 } })));
    renderInLanguage("en", <ClassManagerApplication />);
    await screen.findByRole("navigation", { name: "Primary navigation" });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});

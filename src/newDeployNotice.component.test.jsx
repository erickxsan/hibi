// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ClassManagerApplication from "./ClassManagerApplication.jsx";
import { reloadPage } from "./components/NewVersionDialog.jsx";
import { createStarterState, STORAGE_KEY } from "./domain/index.js";
import { I18nProvider } from "./i18n/index.jsx";

vi.mock("./navigation/deployedVersion", () => ({ useNewDeployAvailable: () => true }));
vi.mock("./components/NewVersionDialog.jsx", async (importOriginal) => ({
  ...(await importOriginal()),
  reloadPage: vi.fn(),
}));

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(createStarterState({ settings: { onboardingVersion: 2 } })));
});

function renderApp(language = "en") {
  localStorage.setItem("hibi:language:v1", language);
  return render(
    <I18nProvider>
      <ClassManagerApplication />
    </I18nProvider>,
  );
}

describe("new deploy notice", () => {
  it("offers to reload without blocking the app, until dismissed", async () => {
    const user = userEvent.setup();
    renderApp();
    const notices = document.querySelector(".toast-region");
    const notice = await within(notices).findByText("A new version of Hibi is available");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(document.querySelector(".app-shell, .hibi-shell")).not.toHaveAttribute("inert");
    await user.click(within(notice.parentElement).getByRole("button", { name: "Reload" }));
    expect(reloadPage).toHaveBeenCalledOnce();
    expect(within(notices).queryByText("A new version of Hibi is available")).not.toBeInTheDocument();
  });

  it("can be dismissed and speaks Spanish", async () => {
    const user = userEvent.setup();
    renderApp("es");
    const notices = document.querySelector(".toast-region");
    const notice = await within(notices).findByText("Hay una versión nueva de Hibi");
    expect(within(notice.parentElement).getByRole("button", { name: "Recargar" })).toBeInTheDocument();
    await user.click(within(notice.parentElement).getByRole("button", { name: "Descartar notificación" }));
    expect(within(notices).queryByText("Hay una versión nueva de Hibi")).not.toBeInTheDocument();
    expect(reloadPage).not.toHaveBeenCalled();
  });
});

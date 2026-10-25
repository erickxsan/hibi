// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import ClassManagerApplication from "./ClassManagerApplication";
import { STORAGE_KEY, serializeState } from "./domain";
import { I18nProvider } from "./i18n";
import { createGroupArchiveFixture } from "./test/groupArchiveFixture";

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("hibi:language:v1", "es");
  localStorage.setItem(STORAGE_KEY, serializeState(createGroupArchiveFixture()));
  window.history.replaceState({}, "", "/groups");
});
const mount = () =>
  render(
    <I18nProvider>
      <ClassManagerApplication />
    </I18nProvider>,
  );
const go = async (user, name) => {
  await user.click(
    within(screen.getByRole("navigation", { name: "Navegación principal" })).getByRole("link", { name, exact: true }),
  );
};

describe("routed group archive flow", () => {
  it("archives, preserves the roster and history, then restores without reactivating inactive students", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByRole("button", { name: "Abrir Álgebra · Grupo A" });
    const archiveToggle = screen.getByRole("button", { name: "Grupos archivados · 2" });
    expect(archiveToggle).toHaveAttribute("aria-expanded", "false");
    await user.click(
      within(await screen.findByRole("region", { name: "Álgebra · Grupo A", exact: true })).getByRole("button", {
        name: "Archivar grupo",
        exact: true,
      }),
    );
    const dialog = await screen.findByRole("dialog", { name: "¿Archivar el grupo Álgebra · Grupo A?" });
    await user.click(within(dialog).getByRole("button", { name: "Archivar grupo", exact: true }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Abrir Álgebra · Grupo A" })).not.toBeInTheDocument(),
    );
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    expect(saved.groups[0].status).toBe("Inactive");
    expect(saved.classLog).toHaveLength(7);
    expect(saved.grades).toHaveLength(7);
    expect(saved.students[0].groupIds).toEqual(["preview-algebra", "preview-geometria"]);
    // Archiving opens the archive list so the group is easy to find again.
    expect(screen.getByRole("button", { name: "Grupos archivados · 3" })).toHaveAttribute("aria-expanded", "true");
    const archive = document.getElementById("community-archived-groups");
    await user.click(within(archive).getByRole("button", { name: /Álgebra · Grupo A Archivado el/ }));
    expect(await screen.findByRole("region", { name: "Detalle del grupo archivado" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reactivar grupo" }));
    expect(await screen.findByRole("button", { name: "Abrir Álgebra · Grupo A" })).toBeInTheDocument();
    const restored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    expect(restored.groups[0].status).toBe("Active");
    expect(restored.students.find((student) => student.id === "preview-daniel").status).toBe("Inactive");
    expect(restored.classLog).toHaveLength(7);
  }, 30000);

  it("shares an explicit inclusion filter across Home and Tracking and resets it on remount", async () => {
    const user = userEvent.setup();
    const view = mount();
    await screen.findByRole("heading", { name: "Comunidad", exact: true });
    // Inicio leaves archived groups out without a word; the choice lives in Seguimiento's filter chip.
    await go(user, "Inicio");
    expect(screen.queryByRole("button", { name: /grupos archivados/ })).not.toBeInTheDocument();
    await go(user, "Seguimiento");
    await user.click(await screen.findByRole("button", { name: "2 grupos archivados fuera" }));
    const toggle = screen.getByRole("switch", { name: "Incluir grupos archivados" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("2 grupos archivados quedan fuera de estas cifras.")).toBeInTheDocument();
    await user.click(toggle);
    expect(screen.getByText(/^Incluye los grupos archivados .+ solo durante esta sesión\.$/)).toBeInTheDocument();
    // Once included, Inicio shows the chip so its figures never mix archived groups in silently.
    await go(user, "Inicio");
    await user.click(await screen.findByRole("button", { name: "Incluye grupos archivados" }));
    expect(screen.getByRole("switch", { name: "Incluir grupos archivados" })).toHaveAttribute("aria-checked", "true");
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    expect(saved.groups.filter((group) => group.status === "Inactive")).toHaveLength(2);
    view.unmount();
    mount();
    await go(user, "Seguimiento");
    await user.click(await screen.findByRole("button", { name: "2 grupos archivados fuera" }));
    expect(screen.getByRole("switch", { name: "Incluir grupos archivados" })).toHaveAttribute("aria-checked", "false");
  }, 30000);
});

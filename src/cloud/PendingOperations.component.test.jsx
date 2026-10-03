// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/index.jsx";
import { LANGUAGE_STORAGE_KEY } from "../i18n/translations.js";
import { createStarterState, createStudent } from "../domain/index.js";
import { describeOperation } from "./workspaceMerge.js";
import { PendingOperations } from "./PendingOperations.jsx";

const base = {
  ...createStarterState(),
  students: [createStudent({ id: "a", code: "A-1", fullName: "Ana López", notes: "", phone: "" })],
};
const local = { ...base, students: [{ ...base.students[0], notes: "Pagó en efectivo", phone: "5551112222" }] };
const cloud = { ...base, students: [{ ...base.students[0], notes: "Pagó por transferencia" }] };
const mutation = { operationId: "op-1", previousState: base, state: local };

function renderPanel(persistence, language = "en") {
  localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  return render(
    <I18nProvider>
      <PendingOperations persistence={persistence} />
    </I18nProvider>,
  );
}

afterEach(() => localStorage.clear());

describe("pending operation review", () => {
  it("keeps ordinary waiting quiet: nothing online, one status line offline, never review controls", () => {
    const pending = [{ id: "op-1", status: "pending", createdAt: "2026-10-03T10:00:00.000Z", mutation }];
    const { container, rerender } = renderPanel({ pendingOperations: pending, connectionStatus: "connected" });
    expect(container).toBeEmptyDOMElement();
    rerender(
      <I18nProvider>
        <PendingOperations persistence={{ pendingOperations: pending, connectionStatus: "reconnecting" }} />
      </I18nProvider>,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "1 change is saved on this device and will sync when the connection returns.",
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("compares before, this device and the cloud in Spanish and resolves only the chosen operation", async () => {
    const resolvePendingOperation = vi.fn(async () => ({ status: "saved" }));
    const retrySync = vi.fn();
    renderPanel(
      {
        connectionStatus: "connected",
        resolvePendingOperation,
        retrySync,
        pendingOperations: [
          {
            id: "op-1",
            status: "conflict",
            createdAt: "2026-10-03T10:00:00.000Z",
            mutation,
            review: describeOperation(mutation, cloud),
          },
          { id: "op-2", status: "pending", blocked: true, createdAt: "2026-10-03T10:01:00.000Z", mutation },
        ],
      },
      "es",
    );
    const panel = screen.getByRole("region", { name: "1 cambio necesita tu revisión" });
    expect(within(panel).getByRole("heading", { name: "Alumno: Ana López" })).toBeInTheDocument();
    expect(within(panel).queryByText(/2026-10-03T/)).not.toBeInTheDocument();
    for (const header of ["Campo", "Antes", "Este dispositivo", "Nube ahora"]) {
      expect(within(panel).getByRole("columnheader", { name: header })).toBeInTheDocument();
    }
    const notes = within(panel).getByRole("row", { name: /Notas/ });
    expect(notes).toHaveClass("is-conflict");
    expect(within(notes).getByText("Pagó en efectivo")).toBeInTheDocument();
    expect(within(notes).getByText("Pagó por transferencia")).toBeInTheDocument();
    expect(within(panel).getByRole("row", { name: /Teléfono/ })).not.toHaveClass("is-conflict");
    expect(
      within(panel).getByText("1 cambio más está seguro en este dispositivo y se sincronizará automáticamente."),
    ).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("button", { name: "Conservar la versión de este dispositivo" }));
    await waitFor(() => expect(resolvePendingOperation).toHaveBeenCalledWith("op-1", "local"));
    fireEvent.click(within(panel).getByRole("button", { name: "Descartar el cambio de este dispositivo" }));
    await waitFor(() => expect(resolvePendingOperation).toHaveBeenLastCalledWith("op-1", "discard"));
    fireEvent.click(within(panel).getByRole("button", { name: "Reintentar sincronización" }));
    expect(retrySync).toHaveBeenCalledOnce();
  });

  it("explains a deletion that collides with a remote edit and shows resolution errors", async () => {
    const deletion = { operationId: "op-3", previousState: base, state: { ...base, students: [] } };
    renderPanel({
      connectionStatus: "connected",
      resolvePendingOperation: vi.fn(async () => {
        throw new Error(
          "This change cannot be kept because it no longer fits the current cloud records. Discard it or edit the record again.",
        );
      }),
      retrySync: vi.fn(),
      pendingOperations: [
        {
          id: "op-3",
          status: "conflict",
          createdAt: "2026-10-03T10:00:00.000Z",
          mutation: deletion,
          review: describeOperation(deletion, cloud),
        },
      ],
    });
    expect(screen.getByText("This device deleted this record, but another device edited it.")).toBeInTheDocument();
    const row = screen.getByRole("row", { name: /Notes/ });
    expect(within(row).getByText("Deleted")).toBeInTheDocument();
    expect(within(row).getByText("Pagó por transferencia")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keep this device's version" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("no longer fits the current cloud records");
  });
});

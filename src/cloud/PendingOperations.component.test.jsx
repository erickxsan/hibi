// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/index.jsx";
import { LANGUAGE_STORAGE_KEY } from "../i18n/translations.js";
// The review renders inside ClassManagerApplication, which registers the screens' Spanish copy.
import "../i18n/screenTranslations.js";
import { createClassLogRow, createGroup, createStarterState, createStudent } from "../domain/index.js";
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

  it("compares a class saved on two devices with the cloud's row of that class", () => {
    const row = (id, marks) =>
      createClassLogRow({
        id,
        studentId: "a",
        classDate: "2026-11-12",
        startTime: "16:00",
        attendance: "P",
        appliedCharge: 200,
        amountPaid: 0,
        paymentState: "Pending",
        ...marks,
      });
    const tablet = { operationId: "op-4", previousState: base, state: { ...base, classLog: [row("tab", {})] } };
    const phone = { ...base, classLog: [row("pho", { amountPaid: 200, paymentState: "Paid" })] };
    renderPanel(
      {
        connectionStatus: "connected",
        resolvePendingOperation: vi.fn(),
        retrySync: vi.fn(),
        pendingOperations: [
          {
            id: "op-4",
            status: "conflict",
            createdAt: "2026-11-12T22:00:00.000Z",
            mutation: tablet,
            review: describeOperation(tablet, phone),
          },
        ],
      },
      "es",
    );
    expect(
      screen.getByText(
        "Otro dispositivo guardó esta misma clase para este alumno. Conserva los valores de este dispositivo o los de la nube: solo queda un registro.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Este dispositivo agregó este registro.")).not.toBeInTheDocument();
    const paid = screen.getByRole("row", { name: /Monto pagado/ });
    expect(paid).toHaveClass("is-conflict");
    expect(within(paid).getByText("0")).toBeInTheDocument();
    expect(within(paid).getByText("200")).toBeInTheDocument();
    expect(screen.queryByRole("row", { name: /Asistencia/ })).not.toBeInTheDocument();
  });

  it("names the month both devices paid, one receipt per line, and leaves the other months out", () => {
    const receipt = (id, period, paidAt) => ({ id, groupId: "g", period, amount: 1000, paidAt, settledTotal: 1000 });
    const start = { ...base, groups: [createGroup({ id: "g", name: "Inglés" })] };
    const withReceipts = (...receipts) => ({
      ...start,
      students: [{ ...start.students[0], monthlyPayments: receipts }],
    });
    const tablet = {
      operationId: "op-5",
      previousState: start,
      state: withReceipts(receipt("tab", "2026-10", "2026-11-13")),
    };
    const phone = withReceipts(receipt("sep", "2026-09", "2026-11-12"), receipt("pho", "2026-10", "2026-11-12"));
    renderPanel(
      {
        connectionStatus: "connected",
        resolvePendingOperation: vi.fn(),
        retrySync: vi.fn(),
        pendingOperations: [
          {
            id: "op-5",
            status: "conflict",
            createdAt: "2026-11-13T22:00:00.000Z",
            mutation: tablet,
            review: describeOperation(tablet, phone),
          },
        ],
      },
      "es",
    );
    const row = screen.getByRole("row", { name: /Pagos de mensualidad/ });
    expect(row).toHaveClass("is-conflict");
    const [, local, cloud] = within(row).getAllByRole("cell");
    expect(local).toHaveTextContent(/^Octubre 2026 · Inglés · \$1,000 · 13 nov 2026$/);
    expect(cloud).toHaveTextContent(/^Octubre 2026 · Inglés · \$1,000 · 12 nov 2026$/);
    expect(row).not.toHaveTextContent("Septiembre");
    expect(row).not.toHaveTextContent("[object Object]");
  });

  it("reads lost marks and a group's billing in words", () => {
    const start = {
      ...base,
      groups: [createGroup({ id: "g", name: "Inglés" })],
      classLog: [createClassLogRow({ id: "c1", studentId: "a", classDate: "2026-11-12", startTime: "16:00" })],
    };
    const ana = (changes) => ({ ...start, students: [{ ...start.students[0], ...changes }] });
    const tablet = {
      operationId: "op-6",
      previousState: start,
      state: ana({
        lostPayments: [
          { kind: "class", classId: "c1", lostAt: "2026-11-13" },
          { kind: "monthly", groupId: "g", period: "2026-10", lostAt: "2026-11-13" },
        ],
        billingByGroup: { g: { mode: "customFee", fee: 800, effectiveFrom: "2026-11" } },
      }),
    };
    const phone = ana({ billingByGroup: { g: { mode: "perClass", effectiveFrom: "2026-11", leftOn: "2026-11-10" } } });
    renderPanel(
      {
        connectionStatus: "connected",
        resolvePendingOperation: vi.fn(),
        retrySync: vi.fn(),
        pendingOperations: [
          {
            id: "op-6",
            status: "conflict",
            createdAt: "2026-11-13T22:00:00.000Z",
            mutation: tablet,
            review: describeOperation(tablet, phone),
          },
        ],
      },
      "es",
    );
    const [, marks] = within(screen.getByRole("row", { name: /Pagos perdidos/ })).getAllByRole("cell");
    expect(marks.textContent).toBe("Clase · 12 nov 2026\nOctubre 2026 · Inglés");
    const billing = screen.getByRole("row", { name: /Forma de cobro/ });
    expect(billing).toHaveClass("is-conflict");
    const [, local, cloud] = within(billing).getAllByRole("cell");
    expect(local).toHaveTextContent("Inglés: Otra cuota $800 · desde noviembre 2026");
    expect(cloud).toHaveTextContent("Inglés: Por clase · desde noviembre 2026 · salió el 10 nov 2026");
  });
});

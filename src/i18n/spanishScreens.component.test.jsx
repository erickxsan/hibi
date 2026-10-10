// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider, translateMessage, uiText } from "./index.jsx";
import { LANGUAGE_STORAGE_KEY } from "./translations.js";
import { AuthScreen } from "../auth/AuthScreen.jsx";
import { AccountDeletionPending } from "../cloud/CloudStates.jsx";
import { WorkspaceEncryptionGate } from "../cloud/WorkspaceEncryptionGate.jsx";
import { AttendancePanel } from "../features/Home.jsx";

function renderSpanish(component) {
  localStorage.setItem(LANGUAGE_STORAGE_KEY, "es");
  return render(<I18nProvider>{component}</I18nProvider>);
}

describe("Spanish screens and opaque user content", () => {
  it("translates authentication headings, actions and service errors", () => {
    renderSpanish(<AuthScreen error="Invalid login credentials" />);
    expect(screen.getByRole("heading", { name: "Te damos la bienvenida" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Iniciar sesión" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("El correo o la contraseña no son correctos");
  });

  it("translates encryption progress and errors and responds to language changes", () => {
    renderSpanish(
      <WorkspaceEncryptionGate
        accountEmail="Home@example.test"
        bootstrap={{ profile: null, wrappers: [] }}
        busy
        progress="Encrypting and staging records 2/8…"
        error={new Error("That encryption password is incorrect.")}
        onSignOut={vi.fn()}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Cifrando y preparando registros 2/8…");
    expect(screen.getByRole("alert")).toHaveTextContent("Esa contraseña de cifrado es incorrecta.");
    expect(screen.getByText("Home@example.test")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "EN" }));
    expect(screen.getByRole("status")).toHaveTextContent("Encrypting and staging records 2/8…");
  });

  it("requires the full Spanish confirmation and sends the backend's canonical phrase", () => {
    const onResume = vi.fn();
    renderSpanish(<AccountDeletionPending onResume={onResume} onSignOut={vi.fn()} />);
    const button = screen.getByRole("button", { name: "Reanudar eliminación permanente" });
    const input = screen.getByLabelText("Escribe ELIMINAR MI CUENTA para retomar la eliminación");
    fireEvent.change(input, { target: { value: "ELIMINAR" } });
    expect(button).toBeDisabled();
    fireEvent.change(input, { target: { value: "ELIMINAR MI CUENTA" } });
    fireEvent.click(button);
    expect(onResume).toHaveBeenCalledWith({ confirmation: "DELETE MY ACCOUNT" });
  });

  it("translates dashboard quantities while retaining an English group name", () => {
    renderSpanish(
      <AttendancePanel
        title="Average attendance this week"
        sessions={[
          { key: "one", scopeId: "group:a", groupId: "a", title: "Home", attended: 1, expected: 1, attendance: 1 },
        ]}
        previousSessions={[]}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Home · 1 alumno");
    expect(screen.getByText("Asistencia de 1 clase")).toBeInTheDocument();
    expect(translateMessage("Collection period: {p0}", { p0: uiText("Weekly") }, "es")).toBe(
      "Periodo de cobros: Semanal",
    );
    expect(translateMessage("Today, {p0}", { p0: "9 de octubre" }, "es")).toBe("Hoy, 9 de octubre");
    expect(translateMessage("{p0} score for {p1}", { p0: "Homework", p1: "Home" }, "es")).toBe(
      "Puntuación de Homework para Home",
    );
  });
});

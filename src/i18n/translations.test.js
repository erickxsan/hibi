import { describe, expect, it } from "vitest";
import { SUPPORTED_LANGUAGES, translateToSpanish, translateUiText } from "./translations";

describe("hibi translations", () => {
  it("translates core navigation and authentication copy", () => {
    expect(translateToSpanish("Home")).toBe("Inicio");
    expect(translateToSpanish("Welcome back")).toBe("Te damos la bienvenida");
    expect(translateToSpanish("Class Log")).toBe("Registro de clases");
  });

  it("translates dynamic counts and accessibility labels", () => {
    expect(translateToSpanish("1 students")).toBe("1 alumno");
    expect(translateToSpanish("3 students")).toBe("3 alumnos");
    expect(translateToSpanish("Payment method for Ana")).toBe("Método de pago de Ana");
    expect(translateToSpanish("2 hr")).toBe("2 h");
  });

  it("covers the redesigned dashboard, payments, and enrollment copy", () => {
    expect(translateToSpanish("Good morning, Teacher!")).toBe("¡Buenos días, profe!");
    expect(translateToSpanish("Payments & Revenue")).toBe("Pagos e ingresos");
    expect(translateToSpanish("Individual + group")).toBe("Individual y grupal");
    expect(translateToSpanish("3 paid class records")).toBe("3 registros de clases pagados");
    expect(translateToSpanish("You have a wonderful day ahead. Balances are calculated through July 14, 2026.")).toBe(
      "Te espera un gran día. Los saldos se calculan hasta July 14, 2026.",
    );
    expect(translateToSpanish("Today’s Classes")).toBe("Clases de hoy");
    expect(translateToSpanish("Record a group or individual class when you’re ready.")).toBe(
      "Registra una clase grupal o individual cuando quieras.",
    );
  });

  it("keeps English unchanged when English is selected", () => {
    expect(translateUiText("Setup", SUPPORTED_LANGUAGES.ENGLISH)).toBe("Setup");
    expect(translateUiText("Setup", SUPPORTED_LANGUAGES.SPANISH)).toBe("Configuración");
  });
});

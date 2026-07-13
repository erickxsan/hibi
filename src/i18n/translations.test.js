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

  it("keeps English unchanged when English is selected", () => {
    expect(translateUiText("Setup", SUPPORTED_LANGUAGES.ENGLISH)).toBe("Setup");
    expect(translateUiText("Setup", SUPPORTED_LANGUAGES.SPANISH)).toBe("Configuración");
  });
});

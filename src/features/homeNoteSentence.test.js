import { describe, expect, it } from "vitest";
import "../i18n/screenTranslations.js";
import { translateMessage } from "../i18n/index.jsx";
import { noteSentence } from "./HomeToday";

const owes = (count) => ({ kind: "owes", tone: "pend", amount: 1125, count, date: "2026-10-01" });

describe("Home «Antes de empezar» debt sentence", () => {
  const english = (key, parameters) => translateMessage(key, parameters, "en");
  const spanish = (key, parameters) => translateMessage(key, parameters, "es");

  it("names how many classes the amount spans, and keeps the singular wording for one", () => {
    expect(noteSentence(owes(5), english, "en-MX")).toBe("owes $1,125 from 5 classes since 1 Oct.");
    expect(noteSentence(owes(1), english, "en-MX")).toBe("owes $1,125 from the class on 1 Oct.");
    expect(noteSentence(owes(5), spanish, "es-MX")).toBe("debe $1,125 de 5 clases desde el 1 oct.");
    expect(noteSentence(owes(1), spanish, "es-MX")).toBe("debe $1,125 de la clase del 1 oct.");
  });
});

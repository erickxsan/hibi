import { describe, expect, it } from "vitest";
import { REAL_ROSTER_BACKUP_KEY, STORAGE_KEY } from "../domain/constants.js";
import { createStarterState } from "../domain";
import { translateMessage } from "../i18n";
import "../i18n/screenTranslations.js";
import {
  encryptionAccess,
  formatKeyDate,
  hasLegacyBrowserCopy,
  nameList,
  ownRateSentences,
  revokeBlockedReason,
  unlockMethodCopy,
} from "./settingsModel";

function spanish(sentences) {
  return sentences.map((sentence) => translateMessage(sentence.key, sentence.values, "es")).join(" ");
}

function memoryStorage(values = {}) {
  const map = new Map(Object.entries(values));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

describe("own-rate sentence", () => {
  it("names one group with a grammatical singular sentence", () => {
    const sentences = ownRateSentences({ ownRateGroups: ["Inglés"], ownRateStudents: [] }, "es-MX");
    expect(spanish(sentences)).toBe("El grupo Inglés conserva su tarifa.");
    expect(sentences.map((sentence) => translateMessage(sentence.key, sentence.values, "en")).join(" ")).toBe(
      "The Inglés group keeps its own rate.",
    );
  });

  it("uses the plural for several groups and keeps whole group names", () => {
    const sentences = ownRateSentences({ ownRateGroups: ["Inglés avanzado", "Francés"], ownRateStudents: [] });
    expect(spanish(sentences)).toBe("Los grupos Inglés avanzado y Francés conservan su tarifa.");
  });

  it("adds a separate sentence for students, singular or plural", () => {
    expect(spanish(ownRateSentences({ ownRateGroups: ["Inglés"], ownRateStudents: ["Ana"] }))).toBe(
      "El grupo Inglés conserva su tarifa. Ana conserva su tarifa propia.",
    );
    expect(spanish(ownRateSentences({ ownRateGroups: [], ownRateStudents: ["Ana", "Luis"] }))).toBe(
      "Ana y Luis conservan su tarifa propia.",
    );
    expect(ownRateSentences({ ownRateGroups: [], ownRateStudents: [] })).toEqual([]);
  });

  it("caps long lists", () => {
    expect(nameList(["A", "B", "C", "D", "E"], "es-MX")).toBe("A, B y C +2");
  });
});

describe("encryption copy", () => {
  it("describes every unlock method in plain words, never with its internal id", () => {
    for (const method of ["remembered-device", "password", "rotated-password", "recovery-key", null, "passkey"]) {
      const copy = unlockMethodCopy(method);
      expect(copy).not.toMatch(/remembered-device|rotated-password|recovery-key|protocol/u);
      expect(translateMessage(copy, {}, "es")).not.toBe(copy);
    }
    expect(translateMessage(unlockMethodCopy("remembered-device"), {}, "es")).toBe(
      "Este navegador recuerda tu clave, así que Hibi abrió sin pedirte la contraseña.",
    );
  });

  it("formats key dates as day, short month and year", () => {
    expect(formatKeyDate("2026-08-26T12:00:00", "es-MX")).toBe("26 ago 2026");
    expect(formatKeyDate("2026-08-26T12:00:00", "en-MX")).toMatch(/^26 Aug 2026$/u);
    expect(formatKeyDate(null)).toBe("");
    expect(formatKeyDate("not a date")).toBe("");
  });

  it("knows whether a recovery key exists and why a key cannot be revoked", () => {
    const password = { wrapperId: "p", type: "password", revokedAt: null };
    const recovery = { wrapperId: "r", type: "recovery", revokedAt: null };
    const revoked = { wrapperId: "old", type: "recovery", revokedAt: "2026-09-01T00:00:00Z" };
    expect(encryptionAccess({ wrappers: [password, revoked] })).toEqual({ active: [password], hasRecoveryKey: false });
    expect(encryptionAccess({ wrappers: [password, recovery] }).hasRecoveryKey).toBe(true);
    expect(revokeBlockedReason(password, 2)).toMatch(/password can't be revoked/u);
    expect(revokeBlockedReason(recovery, 1)).toMatch(/only way to unlock/u);
    expect(revokeBlockedReason(recovery, 2)).toBe("");
  });
});

describe("readable copy from before the account", () => {
  it("counts only a copy that still holds records", () => {
    const withRecords = { ...createStarterState(), students: [{ id: "s1" }] };
    expect(hasLegacyBrowserCopy(memoryStorage())).toBe(false);
    expect(hasLegacyBrowserCopy(memoryStorage({ [STORAGE_KEY]: JSON.stringify(createStarterState()) }))).toBe(false);
    expect(hasLegacyBrowserCopy(memoryStorage({ [REAL_ROSTER_BACKUP_KEY]: "{}" }))).toBe(true);
    expect(hasLegacyBrowserCopy(memoryStorage({ [STORAGE_KEY]: "not json" }))).toBe(true);
    expect(hasLegacyBrowserCopy(memoryStorage({ [STORAGE_KEY]: JSON.stringify(withRecords) }))).toBe(true);
    expect(hasLegacyBrowserCopy(null)).toBe(false);
  });
});

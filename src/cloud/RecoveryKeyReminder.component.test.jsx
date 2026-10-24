// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { purgeLocalAccountData } from "./accountDeletion.js";
import { RecoveryKeyReminder, needsRecoveryKeyReminder, recoveryReminderStorageKey } from "./RecoveryKeyReminder";

const password = { wrapperId: "p", type: "password", revokedAt: null };
const recovery = { wrapperId: "r", type: "recovery", revokedAt: null };

function encryption(overrides = {}) {
  return { enabled: true, profile: { ownerId: "owner-1" }, wrappers: [password], ...overrides };
}

function renderReminder(values, openPage = vi.fn()) {
  render(
    <I18nProvider>
      <RecoveryKeyReminder encryption={values} openPage={openPage} />
    </I18nProvider>,
  );
  return openPage;
}

afterEach(() => localStorage.clear());

describe("recovery key reminder on Inicio", () => {
  it("shows only for an encrypted workspace without an active recovery key", () => {
    expect(needsRecoveryKeyReminder(encryption())).toBe(true);
    expect(needsRecoveryKeyReminder(encryption({ wrappers: [password, recovery] }))).toBe(false);
    expect(needsRecoveryKeyReminder(encryption({ wrappers: [password, { ...recovery, revokedAt: "x" }] }))).toBe(true);
    expect(needsRecoveryKeyReminder(encryption({ enabled: false }))).toBe(false);
    expect(needsRecoveryKeyReminder(encryption({ writesEnabled: false }))).toBe(false);
    expect(needsRecoveryKeyReminder(null)).toBe(false);
  });

  it("leads to the recovery key action in Settings", async () => {
    const user = userEvent.setup();
    const openPage = renderReminder(encryption());
    expect(screen.getByRole("complementary", { name: "You don't have a recovery key yet" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create recovery key" }));
    expect(openPage).toHaveBeenCalledWith("settings", { type: "create-recovery-key" });
  });

  it("remembers «Not now» for this account on this device only", async () => {
    const user = userEvent.setup();
    renderReminder(encryption());
    await user.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByText("You don't have a recovery key yet")).not.toBeInTheDocument();
    expect(localStorage.getItem(recoveryReminderStorageKey(encryption()))).not.toBeNull();

    renderReminder(encryption());
    expect(screen.queryByText("You don't have a recovery key yet")).not.toBeInTheDocument();
    renderReminder(encryption({ profile: { ownerId: "owner-2" } }));
    expect(screen.getByText("You don't have a recovery key yet")).toBeInTheDocument();
  });

  it("still renders and hides for the visit when storage is blocked", async () => {
    const user = userEvent.setup();
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    try {
      renderReminder(encryption());
      await user.click(screen.getByRole("button", { name: "Not now" }));
      expect(screen.queryByText("You don't have a recovery key yet")).not.toBeInTheDocument();
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
    }
  });

  it("is erased with the account's other local data", async () => {
    const key = recoveryReminderStorageKey(encryption());
    localStorage.setItem(key, "2026-10-23T00:00:00.000Z");
    await purgeLocalAccountData("owner-1", {
      storage: localStorage,
      recoveryStore: { purgeAccount: vi.fn(async () => undefined) },
      workspaceKeyStore: { forget: vi.fn(async () => undefined) },
    });
    expect(localStorage.getItem(key)).toBeNull();
  });
});

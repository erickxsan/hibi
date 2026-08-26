// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { WorkspaceEncryptionGate } from "./WorkspaceEncryptionGate.jsx";

function renderGate(values) {
  localStorage.setItem("hibi:language:v1", "en");
  return render(
    <I18nProvider>
      <WorkspaceEncryptionGate {...values} />
    </I18nProvider>,
  );
}

function props(overrides = {}) {
  return {
    accountEmail: "teacher@example.test",
    bootstrap: { profile: null, wrappers: [] },
    loading: false,
    busy: false,
    error: null,
    progress: "",
    onActivate: vi.fn(),
    onUnlockPassword: vi.fn(),
    onUnlockRecovery: vi.fn(),
    onRetry: vi.fn(),
    onSignOut: vi.fn(),
    ...overrides,
  };
}

describe("workspace encryption gate", () => {
  it("requires password confirmation for first-time activation and honors the remembered-device choice", async () => {
    const user = userEvent.setup();
    const values = props();
    renderGate(values);
    expect(screen.getByText(/encrypt every record/iu)).toBeInTheDocument();
    await user.type(screen.getByLabelText("Create encryption password"), "a password");
    await user.type(screen.getByLabelText("Confirm encryption password"), "a password");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: /set password and encrypt workspace/iu }));
    expect(values.onActivate).toHaveBeenCalledWith({ password: "a password", rememberDevice: false });
  });

  it("unlocks an active profile with either its password or recovery key", async () => {
    const user = userEvent.setup();
    const values = props({
      bootstrap: {
        profile: { migrationStatus: "active" },
        wrappers: [
          { wrapperId: "password-1", type: "password", label: "Encryption password", revokedAt: null },
          { wrapperId: "recovery-1", type: "recovery", label: "Recovery key", revokedAt: null },
        ],
      },
    });
    renderGate(values);
    await user.type(screen.getByLabelText("Encryption password"), "a password");
    await user.click(screen.getByRole("button", { name: /^unlock workspace$/iu }));
    expect(values.onUnlockPassword).toHaveBeenCalledWith("a password", { rememberDevice: true });
    await user.type(screen.getByLabelText("Recovery key"), "HIBI1-TEST");
    await user.click(screen.getByRole("button", { name: /unlock with recovery key/iu }));
    expect(values.onUnlockRecovery).toHaveBeenCalledWith("HIBI1-TEST", { rememberDevice: true });
  });

  it("restarts an interrupted passkey migration with a newly confirmed password", async () => {
    const user = userEvent.setup();
    const values = props({
      bootstrap: {
        profile: { migrationStatus: "migration_started" },
        wrappers: [{ wrapperId: "legacy-passkey", type: "passkey", revokedAt: null }],
      },
    });
    renderGate(values);
    expect(screen.getByRole("heading", { name: /restart encryption with a password/iu })).toBeInTheDocument();
    await user.type(screen.getByLabelText("Create encryption password"), "replacement password");
    await user.type(screen.getByLabelText("Confirm encryption password"), "replacement password");
    await user.click(screen.getByRole("button", { name: /restart and encrypt workspace/iu }));
    expect(values.onActivate).toHaveBeenCalledWith({ password: "replacement password", rememberDevice: true });
  });

  it("exposes safe retry and sign-out actions after an unlock error", async () => {
    const user = userEvent.setup();
    const values = props({ error: new Error("Integrity verification failed") });
    renderGate(values);
    expect(screen.getByRole("alert")).toHaveTextContent("Integrity verification failed");
    await user.click(screen.getByRole("button", { name: /check again/iu }));
    await user.click(screen.getByRole("button", { name: /sign out/iu }));
    expect(values.onRetry).toHaveBeenCalledTimes(1);
    expect(values.onSignOut).toHaveBeenCalledTimes(1);
  });
});

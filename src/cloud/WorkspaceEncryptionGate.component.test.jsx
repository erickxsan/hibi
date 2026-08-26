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
    passkeyPrfAvailable: true,
    onActivate: vi.fn(),
    onUnlockPasskey: vi.fn(),
    onUnlockRecovery: vi.fn(),
    onRetry: vi.fn(),
    onSignOut: vi.fn(),
    ...overrides,
  };
}

describe("workspace encryption gate", () => {
  it("requires first-time passkey activation and honors the remembered-device choice", async () => {
    const user = userEvent.setup();
    const values = props();
    renderGate(values);
    expect(screen.getByText(/encrypt every record/iu)).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: /create passkey and encrypt workspace/iu }));
    expect(values.onActivate).toHaveBeenCalledWith({ rememberDevice: false });
  });

  it("unlocks an active profile with either its passkey or recovery key", async () => {
    const user = userEvent.setup();
    const values = props({
      bootstrap: {
        profile: { migrationStatus: "active" },
        wrappers: [
          { wrapperId: "passkey-1", type: "passkey", label: "Laptop", revokedAt: null },
          { wrapperId: "recovery-1", type: "recovery", label: "Recovery key", revokedAt: null },
        ],
      },
    });
    renderGate(values);
    await user.click(screen.getByRole("button", { name: /unlock with laptop/iu }));
    expect(values.onUnlockPasskey).toHaveBeenCalledWith({ wrapperId: "passkey-1", rememberDevice: true });
    await user.type(screen.getByLabelText("Recovery key"), "HIBI1-TEST");
    await user.click(screen.getByRole("button", { name: /unlock with recovery key/iu }));
    expect(values.onUnlockRecovery).toHaveBeenCalledWith("HIBI1-TEST", { rememberDevice: true });
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

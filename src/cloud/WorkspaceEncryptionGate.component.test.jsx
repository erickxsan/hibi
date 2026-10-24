// @vitest-environment jsdom

import { act, render, screen } from "@testing-library/react";
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
  it("never offers new encryption after an unavailable bootstrap and permits a safe retry", async () => {
    const user = userEvent.setup();
    const values = props({
      bootstrap: null,
      error: new Error("Could not query the database for the schema cache. Retrying."),
    });
    renderGate(values);
    expect(screen.getByRole("heading", { name: "Workspace temporarily unavailable" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Create encryption password")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Encryption password")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByText(/Do not create a new password/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out and forget this device" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Check again" }));
    expect(values.onRetry).toHaveBeenCalledOnce();
    expect(values.onActivate).not.toHaveBeenCalled();
  });

  it("hides setup and shows only progress while a fresh profile check is running", () => {
    renderGate(props({ bootstrap: null, loading: true, error: new Error("Unavailable") }));
    expect(screen.getByRole("heading", { name: "Checking workspace protection…" })).toBeInTheDocument();
    expect(screen.getByText(/Opening your encrypted workspace/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Check again" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /sign out/iu })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Create encryption password")).not.toBeInTheDocument();
  });

  it("offers a retry and a quiet sign-out that forgets the device only after a slow check", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const values = props({ bootstrap: null, loading: true, slowCheckDelay: 8000 });
      renderGate(values);
      expect(screen.queryByRole("button", { name: /retry|sign out|check again/iu })).toBeNull();
      act(() => vi.advanceTimersByTime(7999));
      expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
      act(() => vi.advanceTimersByTime(1));
      expect(screen.getByText("This is taking longer than usual.")).toBeInTheDocument();
      const signOut = screen.getByRole("button", { name: "Sign out and forget this device" });
      expect(signOut).not.toHaveClass("button-primary");
      expect(screen.getByText("Next time you will need your encryption password.")).toBeInTheDocument();
      act(() => screen.getByRole("button", { name: "Retry" }).click());
      expect(values.onRetry).toHaveBeenCalledOnce();
      // A new attempt starts quiet again.
      expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
      act(() => vi.advanceTimersByTime(8000));
      act(() => screen.getByRole("button", { name: "Sign out and forget this device" }).click());
      expect(values.onSignOut).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(["a", "passwordpassword", "12345678901234567890"])(
    "blocks weak passwords before activation: %s",
    async (password) => {
      const user = userEvent.setup();
      const values = props();
      renderGate(values);
      await user.type(screen.getByLabelText("Create encryption password"), password);
      await user.type(screen.getByLabelText("Confirm encryption password"), password);
      expect(screen.getByRole("status")).toHaveTextContent(/easy to guess/);
      expect(values.onActivate).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Create encryption password" })).toBeDisabled();
      expect(values.onActivate).not.toHaveBeenCalled();
    },
  );
  it("requires password confirmation for first-time activation and honors the remembered-device choice", async () => {
    const user = userEvent.setup();
    const values = props();
    renderGate(values);
    expect(screen.getByText(/encrypt every record/iu)).toBeInTheDocument();
    await user.type(screen.getByLabelText("Create encryption password"), "violet canyon paper lantern");
    await user.type(screen.getByLabelText("Confirm encryption password"), "violet canyon paper lantern");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: /set password and encrypt workspace/iu }));
    expect(values.onActivate).toHaveBeenCalledWith({ password: "violet canyon paper lantern", rememberDevice: false });
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
    await user.type(screen.getByLabelText("Encryption password"), "a");
    expect(screen.queryByText(/easy to guess/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^unlock workspace$/iu }));
    expect(values.onUnlockPassword).toHaveBeenCalledWith("a", { rememberDevice: true });
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

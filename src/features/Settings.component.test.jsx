// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createStarterState } from "../domain";
import { I18nProvider } from "../i18n";
import Settings from "./Settings";

function renderSettings(overrides = {}) {
  const actions = {
    updateSettings: vi.fn(async () => true),
    notify: vi.fn(),
    exportJson: vi.fn(),
    previewImportRecords: vi.fn(),
    importRecords: vi.fn(),
    importJson: vi.fn(),
    clearLegacyLocalData: vi.fn(() => true),
    listRecoveryPoints: vi.fn(async () => []),
    exportRecoveryPoint: vi.fn(),
    restoreRecoveryPoint: vi.fn(),
    resetWorkspace: vi.fn(async () => true),
    ...overrides.actions,
  };
  const onDeleteAccount = overrides.onDeleteAccount || vi.fn(async () => undefined);
  const view = render(
    <I18nProvider>
      <Settings
        state={createStarterState()}
        actions={actions}
        persistenceMode={overrides.persistenceMode || "cloud"}
        encryption={overrides.encryption}
        registerNavigationBlocker={() => () => {}}
        onDeleteAccount={onDeleteAccount}
        intent={overrides.intent}
        clearIntent={overrides.clearIntent}
      />
    </I18nProvider>,
  );
  return { ...view, actions, onDeleteAccount };
}

function openSection(name) {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${name}`) }));
}

describe("Settings privacy actions", () => {
  it("offers source password recovery for an old backup after rotation in the same workspace", async () => {
    const state = createStarterState();
    const previewEncryptedBackup = vi.fn(async () => {
      throw Object.assign(new Error("old key"), { code: "backup_recovery_required" });
    });
    const previewEncryptedBackupWithPassword = vi.fn(async () => state);
    const { container } = renderSettings({
      encryption: { enabled: true, profile: { workspaceCryptoId: "same" }, wrappers: [] },
      actions: { previewEncryptedBackup, previewEncryptedBackupWithPassword },
    });
    const text = JSON.stringify({
      format: "hibi-encrypted-backup",
      workspaceCryptoId: "same",
      wrappers: [{ type: "password", keyVersion: 1 }],
    });
    const file = new File([text], "old.hibi", { type: "application/json" });
    file.text = async () => text;
    openSection("Records and backups");
    fireEvent.change(container.querySelector('input[type="file"][accept*=".hibi"]'), { target: { files: [file] } });
    const dialog = await screen.findByRole("dialog", { name: "Unlock the source backup" });
    fireEvent.change(within(dialog).getByLabelText("Source workspace encryption password"), {
      target: { value: "legacy source password" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Unlock source with password" }));
    await waitFor(() =>
      expect(previewEncryptedBackupWithPassword).toHaveBeenCalledWith(text, "legacy source password"),
    );
    expect(await screen.findByRole("dialog", { name: /Restore/ })).toBeInTheDocument();
  });
  it("disables server security mutations in a read-only preview", () => {
    renderSettings({ encryption: { enabled: true, writesEnabled: false, wrappers: [] } });
    openSection("Data & privacy");
    expect(screen.getByRole("button", { name: "Change encryption password" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Create recovery key" })).toBeDisabled();
  });
  it("blocks weak replacements while allowing legacy current passwords", async () => {
    const user = userEvent.setup();
    const changePassword = vi.fn(async () => undefined);
    renderSettings({ encryption: { enabled: true, wrappers: [], changePassword } });
    openSection("Data & privacy");
    await user.click(screen.getByRole("button", { name: "Change encryption password" }));
    fireEvent.change(screen.getByLabelText("Current encryption password"), { target: { value: "a" } });
    expect(screen.queryByText(/easy to guess/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("New encryption password"), { target: { value: "passwordpassword" } });
    fireEvent.change(screen.getByLabelText("Confirm new encryption password"), {
      target: { value: "passwordpassword" },
    });
    expect(screen.getByText(/easy to guess/)).toBeInTheDocument();
    expect(changePassword).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Save new password" })).toBeDisabled();
    await user.clear(screen.getByLabelText("New encryption password"));
    await user.clear(screen.getByLabelText("Confirm new encryption password"));
    fireEvent.change(screen.getByLabelText("New encryption password"), { target: { value: "luna bosque mar faro" } });
    fireEvent.change(screen.getByLabelText("Confirm new encryption password"), {
      target: { value: "luna bosque mar faro" },
    });
    await user.click(screen.getByRole("button", { name: "Save new password" }));
    expect(changePassword).toHaveBeenCalledWith("a", "luna bosque mar faro");
  });
  it("keeps failed cloud saves dirty so encrypted changes can be retried", async () => {
    const user = userEvent.setup();
    const { actions } = renderSettings({ actions: { updateSettings: vi.fn(async () => false) } });
    const duration = screen.getByRole("spinbutton", { name: /Default duration/ });
    const save = screen.getByRole("button", { name: "Save values" });

    await user.clear(duration);
    await user.type(duration, "3");
    expect(save).toBeEnabled();
    await user.click(save);

    expect(actions.updateSettings).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(save).toBeEnabled());
  });

  it("can reopen the welcome tutorial", async () => {
    const user = userEvent.setup();
    const onOpenOnboarding = vi.fn();
    const actions = {
      updateSettings: vi.fn(async () => true),
      notify: vi.fn(),
      exportJson: vi.fn(),
      previewImportRecords: vi.fn(),
      importRecords: vi.fn(),
      importJson: vi.fn(),
      clearLegacyLocalData: vi.fn(() => true),
      listRecoveryPoints: vi.fn(async () => []),
      exportRecoveryPoint: vi.fn(),
      restoreRecoveryPoint: vi.fn(),
      resetWorkspace: vi.fn(async () => true),
    };
    render(
      <I18nProvider>
        <Settings
          state={createStarterState()}
          actions={actions}
          persistenceMode="cloud"
          registerNavigationBlocker={() => () => {}}
          onDeleteAccount={vi.fn()}
          onOpenOnboarding={onOpenOnboarding}
        />
      </I18nProvider>,
    );

    openSection("Welcome tutorial");
    await user.click(screen.getByRole("button", { name: "Start tour" }));
    expect(onOpenOnboarding).toHaveBeenLastCalledWith("tour");
    await user.click(screen.getByRole("button", { name: "Guided setup" }));
    expect(onOpenOnboarding).toHaveBeenLastCalledWith("setup");
  });

  it("labels reset as recoverable and requires the RESET phrase", async () => {
    const user = userEvent.setup();
    const { actions } = renderSettings();
    openSection("Data & privacy");
    expect(screen.getByText(/not permanent deletion/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reset workspace" }));
    const dialog = screen.getByRole("dialog", { name: "Reset this workspace?" });
    const confirm = within(dialog).getByRole("button", { name: "Reset workspace" });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByLabelText("Type RESET to confirm"), "RESET");
    await user.click(confirm);
    expect(actions.resetWorkspace).toHaveBeenCalledTimes(1);
  });

  it("requires the permanent deletion phrase before invoking the account flow", async () => {
    const user = userEvent.setup();
    const { onDeleteAccount } = renderSettings();
    openSection("Data & privacy");
    await user.click(screen.getByRole("button", { name: "Delete account and data" }));
    const dialog = screen.getByRole("dialog", { name: "Permanently delete account and data?" });
    const confirm = within(dialog).getByRole("button", { name: "Delete permanently" });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByLabelText("Type DELETE MY ACCOUNT to confirm"), "DELETE MY ACCOUNT");
    await user.click(confirm);
    expect(onDeleteAccount).toHaveBeenCalledWith({ confirmation: "DELETE MY ACCOUNT" });
  });

  it("previews what the class values change before saving them", async () => {
    const user = userEvent.setup();
    const { actions } = renderSettings();
    expect(screen.getByText("No changes to save")).toBeInTheDocument();
    const rate = screen.getByRole("spinbutton", { name: /Hourly rate/ });
    await user.clear(rate);
    await user.type(rate, "120");
    expect(screen.getByText(/A new 2 h class costs \$240 per student/)).toBeInTheDocument();
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save values" }));
    expect(actions.updateSettings).toHaveBeenCalledWith(expect.objectContaining({ hourlyRateMxn: 120 }));
  });

  it("changes one value from a sheet on mobile", async () => {
    window.matchMedia.mockImplementation((query) => ({
      matches: true,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    const user = userEvent.setup();
    const { actions } = renderSettings();
    await user.click(screen.getByRole("button", { name: /Hourly rate/ }));
    const sheet = await screen.findByRole("dialog", { name: "Hourly rate" });
    await user.click(within(sheet).getByRole("button", { name: "More" }));
    await user.click(within(sheet).getByRole("button", { name: "Save" }));
    expect(actions.updateSettings).toHaveBeenCalledWith(expect.objectContaining({ hourlyRateMxn: 60 }));
    window.matchMedia.mockImplementation((query) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  });
});

function encryptionWith(overrides = {}) {
  return {
    enabled: true,
    method: "remembered-device",
    profile: { ownerId: "owner-1", protocolVersion: 1 },
    wrappers: [
      {
        wrapperId: "password-1",
        type: "password",
        label: "Encryption password",
        createdAt: "2026-08-26T12:00:00",
        lastUsedAt: null,
        revokedAt: null,
      },
    ],
    rememberedDevices: [{ deviceId: "device-1", createdAt: "2026-08-26T12:00:00", lastUsedAt: "2026-10-03T12:00:00" }],
    createRecoveryKey: vi.fn(async () => "HIBI1-AAAA-BBBB"),
    revokeWrapper: vi.fn(async () => undefined),
    rememberDevice: vi.fn(async () => true),
    forgetDevice: vi.fn(async () => undefined),
    clearLocalCopies: vi.fn(async () => undefined),
    ...overrides,
  };
}

const recoveryWrapper = {
  wrapperId: "recovery-1",
  type: "recovery",
  label: "Recovery key",
  createdAt: "2026-09-01T12:00:00",
  lastUsedAt: null,
  revokedAt: null,
};

describe("Settings data and privacy", () => {
  it("warns when no recovery key exists and creates one from the warning", async () => {
    const user = userEvent.setup();
    const encryption = encryptionWith();
    renderSettings({ encryption });
    const privacyNav = screen.getByRole("button", { name: /^Data & privacy/ });
    expect(privacyNav).toHaveTextContent("No recovery key");
    expect(privacyNav).not.toHaveTextContent("Active");
    openSection("Data & privacy");
    expect(screen.getByText("You don't have a recovery key yet")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create recovery key" }));
    expect(encryption.createRecoveryKey).toHaveBeenCalledOnce();
    expect(await screen.findByText("HIBI1-AAAA-BBBB")).toBeInTheDocument();
  });

  it("shows the encryption as active, without the warning, once a recovery key exists", () => {
    const encryption = encryptionWith();
    encryption.wrappers = [...encryption.wrappers, recoveryWrapper];
    renderSettings({ encryption });
    expect(screen.getByRole("button", { name: /^Data & privacy/ })).toHaveTextContent("Active");
    openSection("Data & privacy");
    expect(screen.queryByText("You don't have a recovery key yet")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create another recovery key" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Revoke" })).toBeEnabled();
  });

  it("explains why the password cannot be revoked and never offers to remember a remembered device", () => {
    renderSettings({ encryption: encryptionWith() });
    openSection("Data & privacy");
    expect(screen.queryByRole("button", { name: "Revoke" })).not.toBeInTheDocument();
    expect(screen.getByText("Your password can't be revoked. You can change it instead.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remember this device" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Forget this device" })).toBeInTheDocument();
    expect(screen.getByText("Created 26 Aug 2026 · not used yet")).toBeInTheDocument();
    expect(screen.getByText(/Since 26 Aug 2026 · last used 3 Oct 2026/)).toBeInTheDocument();
  });

  it("offers to remember the device only when it is not remembered", async () => {
    const user = userEvent.setup();
    const encryption = encryptionWith({ rememberedDevices: [] });
    renderSettings({ encryption });
    openSection("Data & privacy");
    expect(screen.queryByRole("button", { name: "Forget this device" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remember this device" }));
    expect(encryption.rememberDevice).toHaveBeenCalledOnce();
  });

  it("groups encryption first, then copies on this browser, then the danger zone with deletion last", () => {
    renderSettings({ encryption: encryptionWith() });
    openSection("Data & privacy");
    const headings = screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent);
    expect(headings).toEqual(["Encryption and devices", "Copies on this browser", "Danger zone"]);
    const buttons = screen.getAllByRole("button");
    const position = (name) => buttons.indexOf(screen.getByRole("button", { name }));
    expect(position("Change encryption password")).toBeLessThan(position("Erase copies on this browser"));
    expect(position("Erase copies on this browser")).toBeLessThan(position("Reset workspace"));
    expect(position("Reset workspace")).toBeLessThan(position("Delete account and data"));
    // No readable pre-account copy in this browser, so its action stays hidden.
    expect(screen.queryByRole("button", { name: "Delete readable copy" })).not.toBeInTheDocument();
  });

  it("names the readable pre-account copy and hides it once deleted", async () => {
    const user = userEvent.setup();
    localStorage.setItem("minimal-class-manager:backup:before-real-roster-2026-07-11:v1", "{}");
    try {
      const { actions } = renderSettings({ encryption: encryptionWith() });
      openSection("Data & privacy");
      expect(screen.getByText("Readable copy from before your account")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Delete readable copy" }));
      const dialog = screen.getByRole("dialog", { name: "Delete the readable copy?" });
      await user.click(within(dialog).getByRole("button", { name: "Delete readable copy" }));
      expect(actions.clearLegacyLocalData).toHaveBeenCalledOnce();
      expect(screen.queryByText("Readable copy from before your account")).not.toBeInTheDocument();
    } finally {
      localStorage.removeItem("minimal-class-manager:backup:before-real-roster-2026-07-11:v1");
    }
  });

  it("keeps the encrypted-copies action wired to clearing local copies", async () => {
    const user = userEvent.setup();
    const encryption = encryptionWith();
    renderSettings({ encryption });
    openSection("Data & privacy");
    await user.click(screen.getByRole("button", { name: "Erase copies on this browser" }));
    expect(encryption.clearLocalCopies).toHaveBeenCalledOnce();
    expect(encryption.forgetDevice).not.toHaveBeenCalled();
  });

  it("opens the encryption controls when Inicio asks to create a recovery key", async () => {
    const clearIntent = vi.fn();
    renderSettings({ encryption: encryptionWith(), intent: { type: "create-recovery-key" }, clearIntent });
    expect(screen.getByRole("heading", { level: 3, name: "Encryption and devices" })).toBeInTheDocument();
    await waitFor(() => expect(clearIntent).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Create recovery key" })).toHaveFocus();
  });

  it("makes the backup download the only primary action in cloud and local records", () => {
    const { unmount } = renderSettings({ encryption: encryptionWith() });
    openSection("Records and backups");
    expect(screen.getByRole("button", { name: "Download encrypted .hibi" })).toHaveClass("button-primary");
    expect(screen.getByRole("button", { name: "Import records" })).not.toHaveClass("button-primary");
    expect(document.querySelectorAll(".settings-detail .button-primary")).toHaveLength(1);
    unmount();
    renderSettings({ persistenceMode: "local" });
    openSection("Records and backups");
    expect(screen.getByRole("button", { name: "Download backup" })).toHaveClass("button-primary");
    expect(screen.getByRole("button", { name: "Import records" })).not.toHaveClass("button-primary");
  });
});

describe("Settings in Spanish", () => {
  it("explains the unlock method in plain words and formats dates for display", () => {
    localStorage.setItem("hibi:language:v1", "es");
    try {
      renderSettings({ encryption: encryptionWith() });
      fireEvent.click(screen.getByRole("button", { name: /^Datos y privacidad/ }));
      expect(
        screen.getByText("Este navegador recuerda tu clave, así que Hibi abrió sin pedirte la contraseña."),
      ).toBeInTheDocument();
      expect(document.body).not.toHaveTextContent(/remembered-device|protocolo/u);
      expect(screen.getByText("Creada el 26 ago 2026 · sin usar todavía")).toBeInTheDocument();
      expect(document.body).not.toHaveTextContent("26/8/2026");
    } finally {
      localStorage.removeItem("hibi:language:v1");
    }
  });
});

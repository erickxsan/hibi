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
        persistenceMode="cloud"
        encryption={overrides.encryption}
        registerNavigationBlocker={() => () => {}}
        onDeleteAccount={onDeleteAccount}
      />
    </I18nProvider>,
  );
  return { ...view, actions, onDeleteAccount };
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
    expect(screen.getByRole("button", { name: "Change encryption password" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Create recovery key" })).toBeDisabled();
  });
  it("blocks weak replacements while allowing legacy current passwords", async () => {
    const user = userEvent.setup();
    const changePassword = vi.fn(async () => undefined);
    renderSettings({ encryption: { enabled: true, wrappers: [], changePassword } });
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
    const save = screen.getByRole("button", { name: "Save defaults" });

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

    await user.click(screen.getByRole("button", { name: "Start tour" }));
    expect(onOpenOnboarding).toHaveBeenLastCalledWith("tour");
    await user.click(screen.getByRole("button", { name: "Guided setup" }));
    expect(onOpenOnboarding).toHaveBeenLastCalledWith("setup");
  });

  it("labels reset as recoverable and requires the RESET phrase", async () => {
    const user = userEvent.setup();
    const { actions } = renderSettings();
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
    await user.click(screen.getByRole("button", { name: "Delete account and data" }));
    const dialog = screen.getByRole("dialog", { name: "Permanently delete account and data?" });
    const confirm = within(dialog).getByRole("button", { name: "Delete permanently" });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByLabelText("Type DELETE MY ACCOUNT to confirm"), "DELETE MY ACCOUNT");
    await user.click(confirm);
    expect(onDeleteAccount).toHaveBeenCalledWith({ confirmation: "DELETE MY ACCOUNT" });
  });
});

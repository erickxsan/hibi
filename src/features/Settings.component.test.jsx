// @vitest-environment jsdom

import { render, screen, waitFor, within } from "@testing-library/react";
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
  render(
    <I18nProvider>
      <Settings
        state={createStarterState()}
        actions={actions}
        persistenceMode="cloud"
        registerNavigationBlocker={() => () => {}}
        onDeleteAccount={onDeleteAccount}
      />
    </I18nProvider>,
  );
  return { actions, onDeleteAccount };
}

describe("Settings privacy actions", () => {
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
    expect(onOpenOnboarding).toHaveBeenCalledTimes(1);
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

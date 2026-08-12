// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { createStarterState } from "../domain";
import {
  AccountDeletionComplete,
  AccountDeletionPending,
  CloudConfigurationRequired,
  CloudError,
  CloudLoading,
  LocalDataMigration,
} from "./CloudStates";

function renderWithLanguage(component) {
  localStorage.setItem("hibi:language:v1", "en");
  return render(<I18nProvider>{component}</I18nProvider>);
}

describe("account deletion cloud states", () => {
  it("requires explicit confirmation before resuming a tombstoned deletion", async () => {
    const user = userEvent.setup();
    const onResume = vi.fn(async () => undefined);
    renderWithLanguage(<AccountDeletionPending onResume={onResume} onSignOut={vi.fn()} />);

    const resume = screen.getByRole("button", { name: "Resume permanent deletion" });
    expect(resume).toBeDisabled();
    await user.type(screen.getByLabelText("Type DELETE MY ACCOUNT to resume"), "DELETE MY ACCOUNT");
    await user.click(resume);

    expect(onResume).toHaveBeenCalledWith({ confirmation: "DELETE MY ACCOUNT" });
  });

  it("shows a minimal verification receipt and continues to sign in", async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn();
    renderWithLanguage(
      <AccountDeletionComplete
        receipt={{
          requestId: "11111111-1111-4111-8111-111111111111",
          receiptSecret: "22222222-2222-4222-8222-222222222222",
          completedAt: "2026-08-12T12:00:00Z",
          localPurgeComplete: true,
        }}
        onContinue={onContinue}
      />,
    );

    expect(screen.getByText("11111111-1111-4111-8111-111111111111")).toBeInTheDocument();
    expect(screen.getByText("22222222-2222-4222-8222-222222222222")).toBeInTheDocument();
    expect(screen.queryByText(/@/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue to sign in" }));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it("lets the user retry a device purge that could not be verified", async () => {
    const user = userEvent.setup();
    const onRetryLocalPurge = vi.fn(async () => undefined);
    renderWithLanguage(
      <AccountDeletionComplete
        receipt={{
          requestId: "11111111-1111-4111-8111-111111111111",
          receiptSecret: "22222222-2222-4222-8222-222222222222",
          completedAt: "2026-08-12T12:00:00Z",
          localPurgeComplete: false,
        }}
        onRetryLocalPurge={onRetryLocalPurge}
        onContinue={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Retry device cleanup" }));
    expect(onRetryLocalPurge).toHaveBeenCalledTimes(1);
  });

  it("renders and exercises the existing cloud-state actions", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const onSignOut = vi.fn();
    const { rerender } = renderWithLanguage(
      <CloudError error={new Error("Offline")} onRetry={onRetry} onSignOut={onSignOut} />,
    );
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onSignOut).toHaveBeenCalledTimes(1);

    rerender(
      <I18nProvider>
        <CloudLoading message="Loading test" />
      </I18nProvider>,
    );
    expect(screen.getByText("Loading test")).toBeInTheDocument();

    rerender(
      <I18nProvider>
        <CloudConfigurationRequired />
      </I18nProvider>,
    );
    expect(screen.getByRole("heading", { name: "Cloud setup required" })).toBeInTheDocument();

    const onImport = vi.fn();
    const onSkip = vi.fn();
    rerender(
      <I18nProvider>
        <LocalDataMigration
          state={createStarterState()}
          accountEmail="teacher@example.com"
          onImport={onImport}
          onSkip={onSkip}
        />
      </I18nProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Move records online" }));
    await user.click(screen.getByRole("button", { name: "Start with an empty cloud workspace" }));
    expect(onImport).toHaveBeenCalledTimes(1);
    expect(onSkip).toHaveBeenCalledTimes(1);
  });
});

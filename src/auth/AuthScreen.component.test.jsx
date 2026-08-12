// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { AuthScreen } from "./AuthScreen";

describe("AuthScreen", () => {
  it("normalizes credentials and submits sign in", async () => {
    const user = userEvent.setup();
    const onSignIn = vi.fn().mockResolvedValue({ message: "Signed in" });
    render(
      <I18nProvider>
        <AuthScreen onSignIn={onSignIn} />
      </I18nProvider>,
    );

    await user.type(screen.getByLabelText("Email address"), "  Teacher@Example.COM ");
    await user.type(screen.getByLabelText("Password"), "secret-value");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(onSignIn).toHaveBeenCalledWith({
      email: "teacher@example.com",
      password: "secret-value",
      captchaToken: "",
    });
    expect(await screen.findByRole("status")).toHaveTextContent("Signed in");
  });

  it("blocks weak account passwords before invoking the API", async () => {
    const user = userEvent.setup();
    const onSignUp = vi.fn();
    render(
      <I18nProvider>
        <AuthScreen onSignIn={vi.fn()} onSignUp={onSignUp} />
      </I18nProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Create an account" }));
    await user.type(screen.getByLabelText("Email address"), "teacher@example.com");
    await user.type(screen.getByLabelText("Password"), "weak");
    await user.type(screen.getByLabelText("Confirm password"), "weak");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(onSignUp).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("doesn’t meet all the requirements");
  });
});

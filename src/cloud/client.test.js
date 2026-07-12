import { describe, expect, it, vi } from "vitest";
import {
  CloudAuthenticationError,
  CloudConfigurationError,
  createAuthService,
} from "./client.js";

describe("cloud auth service", () => {
  it("fails clearly when cloud environment variables are absent", async () => {
    await expect(createAuthService(null).getSession()).rejects.toBeInstanceOf(CloudConfigurationError);
  });

  it("normalizes sign-up identity and keeps profile metadata optional", async () => {
    const signUp = vi.fn(async () => ({ data: { user: { id: "user-1" } }, error: null }));
    const service = createAuthService({ auth: { signUp } });

    await service.signUp({
      email: "  teacher@example.com ",
      password: "safe-password",
      displayName: " Teacher ",
    });

    expect(signUp).toHaveBeenCalledWith({
      email: "teacher@example.com",
      password: "safe-password",
      options: { data: { display_name: "Teacher" } },
    });
  });

  it("wraps provider errors without hiding the cause", async () => {
    const providerError = { message: "Invalid login credentials" };
    const service = createAuthService({
      auth: {
        signInWithPassword: vi.fn(async () => ({ data: null, error: providerError })),
      },
    });

    const error = await service.signIn({ email: "a@b.test", password: "wrong" }).catch((caught) => caught);

    expect(error).toBeInstanceOf(CloudAuthenticationError);
    expect(error.message).toBe("Invalid login credentials");
    expect(error.cause).toBe(providerError);
  });

  it("passes one-time CAPTCHA tokens to protected auth endpoints", async () => {
    const signUp = vi.fn(async () => ({ data: { user: null }, error: null }));
    const signInWithPassword = vi.fn(async () => ({ data: { session: null }, error: null }));
    const resetPasswordForEmail = vi.fn(async () => ({ data: {}, error: null }));
    const service = createAuthService({
      auth: { signUp, signInWithPassword, resetPasswordForEmail },
    });

    await service.signUp({ email: "teacher@example.com", password: "Password1", captchaToken: "signup-token" });
    await service.signIn({ email: "teacher@example.com", password: "Password1", captchaToken: "signin-token" });
    await service.sendPasswordReset("teacher@example.com", {
      redirectTo: "https://classes.example/reset",
      captchaToken: "reset-token",
    });

    expect(signUp).toHaveBeenCalledWith(expect.objectContaining({
      options: { captchaToken: "signup-token" },
    }));
    expect(signInWithPassword).toHaveBeenCalledWith(expect.objectContaining({
      options: { captchaToken: "signin-token" },
    }));
    expect(resetPasswordForEmail).toHaveBeenCalledWith("teacher@example.com", {
      redirectTo: "https://classes.example/reset",
      captchaToken: "reset-token",
    });
  });

  it("starts Google OAuth with an explicit allow-listed return URL", async () => {
    const signInWithOAuth = vi.fn(async () => ({
      data: { provider: "google", url: "https://accounts.google.test" },
      error: null,
    }));
    const service = createAuthService({ auth: { signInWithOAuth } });

    const result = await service.signInWithGoogle({ redirectTo: "https://usehibi.pages.dev/" });

    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: "https://usehibi.pages.dev/" },
    });
    expect(result.provider).toBe("google");
  });

  it("returns an unsubscribe function for auth state listeners", () => {
    const unsubscribe = vi.fn();
    let providerCallback;
    const service = createAuthService({
      auth: {
        onAuthStateChange: vi.fn((callback) => {
          providerCallback = callback;
          return { data: { subscription: { unsubscribe } } };
        }),
      },
    });
    const listener = vi.fn();

    const stop = service.onAuthStateChange(listener);
    providerCallback("SIGNED_IN", { user: { id: "user-1" } });
    stop();

    expect(listener).toHaveBeenCalledWith("SIGNED_IN", { user: { id: "user-1" } });
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});

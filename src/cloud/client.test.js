import { describe, expect, it, vi } from "vitest";
import {
  CloudAuthenticationError,
  CloudConfigurationError,
  createAuthService,
  isJwtIssuedAtFutureError,
  isCloudWriteLocationAllowed,
  retryJwtClockSkew,
} from "./client.js";

describe("cloud write origin guard", () => {
  it("allows the canonical production origin and blocks Cloudflare previews", () => {
    expect(
      isCloudWriteLocationAllowed({
        isDevelopment: false,
        origin: "https://usehibi.pages.dev",
      }),
    ).toBe(true);
    expect(
      isCloudWriteLocationAllowed({
        isDevelopment: false,
        origin: "https://feature-branch.usehibi.pages.dev",
      }),
    ).toBe(false);
  });

  it("requires an explicit opt-in for local writes", () => {
    expect(
      isCloudWriteLocationAllowed({
        isDevelopment: true,
        enableDevelopmentWrites: false,
        origin: "http://127.0.0.1:4173",
      }),
    ).toBe(false);
    expect(
      isCloudWriteLocationAllowed({
        isDevelopment: true,
        enableDevelopmentWrites: true,
        origin: "http://127.0.0.1:4173",
      }),
    ).toBe(true);
  });

  it("supports an explicit future custom-domain allow-list", () => {
    expect(
      isCloudWriteLocationAllowed({
        isDevelopment: false,
        allowedOrigins: "https://usehibi.pages.dev, https://hibi.example/",
        origin: "https://hibi.example",
      }),
    ).toBe(true);
  });
});

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

    expect(signUp).toHaveBeenCalledWith(
      expect.objectContaining({
        options: { captchaToken: "signup-token" },
      }),
    );
    expect(signInWithPassword).toHaveBeenCalledWith(
      expect.objectContaining({
        options: { captchaToken: "signin-token" },
      }),
    );
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

describe("Supabase JWT clock-skew recovery", () => {
  it("recognizes the PostgREST future-issued JWT error through wrapped causes", () => {
    const providerError = { code: "PGRST303", message: "JWT issued at future" };
    const wrapped = new CloudAuthenticationError("Encryption status could not be loaded.", { cause: providerError });

    expect(isJwtIssuedAtFutureError(wrapped)).toBe(true);
    expect(isJwtIssuedAtFutureError(new Error("Network unavailable"))).toBe(false);
  });

  it("refreshes the session, waits briefly, and retries exactly once", async () => {
    const operation = vi.fn().mockRejectedValueOnce(new Error("JWT issued at future")).mockResolvedValueOnce("ready");
    const refreshSession = vi.fn(async () => {});
    const wait = vi.fn(async () => {});

    await expect(retryJwtClockSkew(operation, { refreshSession, wait })).resolves.toBe("ready");

    expect(refreshSession).toHaveBeenCalledOnce();
    expect(wait).toHaveBeenCalledWith(2_000);
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("does not refresh or retry unrelated failures", async () => {
    const failure = new Error("Network unavailable");
    const operation = vi.fn(async () => {
      throw failure;
    });
    const refreshSession = vi.fn(async () => {});
    const wait = vi.fn(async () => {});

    await expect(retryJwtClockSkew(operation, { refreshSession, wait })).rejects.toBe(failure);
    expect(refreshSession).not.toHaveBeenCalled();
    expect(wait).not.toHaveBeenCalled();
    expect(operation).toHaveBeenCalledOnce();
  });
});

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() ?? "";
const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() || import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() || "";
const forceLocalDevelopment = import.meta.env.DEV && import.meta.env.VITE_FORCE_LOCAL_MODE === "true";
const DEFAULT_CLOUD_WRITE_ORIGIN = "https://usehibi.pages.dev";

export function isCloudWriteLocationAllowed({
  isDevelopment = import.meta.env.DEV,
  enableDevelopmentWrites = import.meta.env.VITE_ENABLE_CLOUD_WRITES_IN_DEV === "true",
  allowedOrigins = import.meta.env.VITE_CLOUD_WRITE_ORIGINS || DEFAULT_CLOUD_WRITE_ORIGIN,
  origin = globalThis.location?.origin ?? "",
} = {}) {
  if (isDevelopment) return enableDevelopmentWrites;
  const normalizedOrigin = String(origin).trim().replace(/\/$/, "");
  if (!normalizedOrigin) return false;
  return String(allowedOrigins)
    .split(",")
    .map((entry) => entry.trim().replace(/\/$/, ""))
    .filter(Boolean)
    .includes(normalizedOrigin);
}

// A Cloudflare preview is a production Vite build, so import.meta.env.PROD is
// not sufficient protection. Only the explicitly approved public origin may
// mutate the production Supabase project. Preview and staging URLs are
// read-only unless a maintainer deliberately allow-lists their origin.
export const cloudWritesEnabled = isCloudWriteLocationAllowed();

export const isCloudConfigured = !forceLocalDevelopment && Boolean(supabaseUrl && supabaseAnonKey);
export const isLocalModeAllowed =
  forceLocalDevelopment || import.meta.env.DEV || import.meta.env.VITE_ALLOW_LOCAL_MODE === "true";
export const hCaptchaSiteKey = import.meta.env.VITE_HCAPTCHA_SITE_KEY?.trim() ?? "";

/**
 * The public anon key is intentionally read from Vite's public environment. It
 * is not a secret; database safety comes from Auth plus Row-Level Security.
 */
export const supabase = isCloudConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

export class CloudConfigurationError extends Error {
  constructor(message = "Cloud sync is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.") {
    super(message);
    this.name = "CloudConfigurationError";
  }
}

export class CloudAuthenticationError extends Error {
  constructor(message = "Sign in to access cloud records.", options) {
    super(message, options);
    this.name = "CloudAuthenticationError";
  }
}

export function requireCloudClient(client = supabase) {
  if (!client) throw new CloudConfigurationError();
  return client;
}

function throwAuthError(error, fallback) {
  if (error) throw new CloudAuthenticationError(error.message || fallback, { cause: error });
}

/** Create an injectable Auth facade so repository tests never need live credentials. */
export function createAuthService(client = supabase) {
  const cloud = () => requireCloudClient(client);

  return {
    async getSession() {
      const { data, error } = await cloud().auth.getSession();
      throwAuthError(error, "The current session could not be loaded.");
      return data.session ?? null;
    },

    async getUser() {
      const { data, error } = await cloud().auth.getUser();
      throwAuthError(error, "The current account could not be loaded.");
      return data.user ?? null;
    },

    async signUp({ email, password, displayName = "", captchaToken = "" }) {
      const options = {
        ...(displayName ? { data: { display_name: displayName.trim() } } : {}),
        ...(captchaToken ? { captchaToken } : {}),
      };
      const { data, error } = await cloud().auth.signUp({
        email: email.trim(),
        password,
        ...(Object.keys(options).length ? { options } : {}),
      });
      throwAuthError(error, "The account could not be created.");
      return data;
    },

    async signIn({ email, password, captchaToken = "" }) {
      const { data, error } = await cloud().auth.signInWithPassword({
        email: email.trim(),
        password,
        ...(captchaToken ? { options: { captchaToken } } : {}),
      });
      throwAuthError(error, "The account could not be signed in.");
      return data;
    },

    async signInWithGoogle({ redirectTo = `${globalThis.location?.origin ?? ""}/` } = {}) {
      const { data, error } = await cloud().auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo },
      });
      throwAuthError(error, "Google sign-in could not be started.");
      return data;
    },

    async signOut() {
      const { error } = await cloud().auth.signOut();
      throwAuthError(error, "The account could not be signed out.");
    },

    async sendPasswordReset(email, { redirectTo = `${globalThis.location?.origin ?? ""}/`, captchaToken = "" } = {}) {
      const { error } = await cloud().auth.resetPasswordForEmail(email.trim(), {
        redirectTo,
        ...(captchaToken ? { captchaToken } : {}),
      });
      throwAuthError(error, "The password-reset email could not be sent.");
    },

    async updatePassword(password) {
      const { data, error } = await cloud().auth.updateUser({ password });
      throwAuthError(error, "The password could not be updated.");
      return data.user ?? null;
    },

    onAuthStateChange(callback) {
      const { data } = cloud().auth.onAuthStateChange((event, session) => callback(event, session));
      return () => data.subscription.unsubscribe();
    },
  };
}

export const cloudAuth = createAuthService();

import { useEffect, useId, useRef, useState } from "react";
import HCaptcha from "@hcaptcha/react-hcaptcha";
import {
  ArrowLeft,
  Check,
  Eye,
  EyeOff,
  LockKeyhole,
  Mail,
} from "lucide-react";
import { BrandMark } from "../components/BrandMark";
import "./auth.css";

function GoogleMark() {
  return (
    <svg className="auth-google-mark" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285f4" d="M21.6 12.2c0-.7-.1-1.4-.2-2.1H12v4h5.4a4.6 4.6 0 0 1-2 3v2.6h3.3c1.9-1.8 2.9-4.4 2.9-7.5Z" />
      <path fill="#34a853" d="M12 22c2.7 0 5-.9 6.7-2.3l-3.3-2.6c-.9.6-2.1 1-3.4 1a5.9 5.9 0 0 1-5.6-4.1H3v2.7A10 10 0 0 0 12 22Z" />
      <path fill="#fbbc05" d="M6.4 14a6 6 0 0 1 0-3.9V7.4H3a10 10 0 0 0 0 9.3L6.4 14Z" />
      <path fill="#ea4335" d="M12 6a5.4 5.4 0 0 1 3.8 1.5l2.9-2.9A9.7 9.7 0 0 0 12 2a10 10 0 0 0-9 5.4l3.4 2.7A5.9 5.9 0 0 1 12 6Z" />
    </svg>
  );
}

export const AUTH_MODES = Object.freeze({
  SIGN_IN: "sign-in",
  SIGN_UP: "sign-up",
  FORGOT_PASSWORD: "forgot-password",
  RESET_PASSWORD: "reset-password",
});

const MODE_COPY = {
  [AUTH_MODES.SIGN_IN]: {
    title: "Welcome back",
    description: "Sign in to continue managing your classes.",
    action: "Sign in",
  },
  [AUTH_MODES.SIGN_UP]: {
    title: "Create your account",
    description: "Your students, classes, and payments stay private to you.",
    action: "Create account",
  },
  [AUTH_MODES.FORGOT_PASSWORD]: {
    title: "Reset your password",
    description: "We’ll email you a secure link to choose a new password.",
    action: "Send reset link",
  },
  [AUTH_MODES.RESET_PASSWORD]: {
    title: "Choose a new password",
    description: "Use a strong password you haven’t used for this account before.",
    action: "Update password",
  },
};

const PASSWORD_RULES = [
  { id: "length", label: "At least 8 characters", test: (value) => value.length >= 8 },
  { id: "lowercase", label: "One lowercase letter", test: (value) => /[a-z]/.test(value) },
  { id: "uppercase", label: "One uppercase letter", test: (value) => /[A-Z]/.test(value) },
  { id: "number", label: "One number", test: (value) => /\d/.test(value) },
];

function readableMessage(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message;
  return "Something went wrong. Please try again.";
}

function AuthField({
  autoComplete,
  describedBy,
  icon: Icon,
  id,
  label,
  onChange,
  required = true,
  type = "text",
  value,
  children,
}) {
  return (
    <div className="auth-field">
      <label className="auth-field-label" htmlFor={id}>{label}</label>
      <span className="auth-control-wrap">
        <Icon aria-hidden="true" size={18} strokeWidth={1.9} />
        <input
          id={id}
          className="auth-control"
          type={type}
          value={value}
          onChange={onChange}
          autoComplete={autoComplete}
          aria-describedby={describedBy || undefined}
          required={required}
        />
        {children}
      </span>
    </div>
  );
}

function PasswordField({
  autoComplete,
  describedBy,
  id,
  label,
  onChange,
  value,
}) {
  const [visible, setVisible] = useState(false);

  return (
    <AuthField
      id={id}
      label={label}
      icon={LockKeyhole}
      type={visible ? "text" : "password"}
      value={value}
      onChange={onChange}
      autoComplete={autoComplete}
      describedBy={describedBy}
    >
      <button
        className="auth-reveal-button"
        type="button"
        onClick={() => setVisible((current) => !current)}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
      >
        {visible ? <EyeOff aria-hidden="true" size={18} /> : <Eye aria-hidden="true" size={18} />}
      </button>
    </AuthField>
  );
}

function PasswordRequirements({ password, id }) {
  return (
    <div id={id} className="auth-password-rules" aria-label="Password requirements">
      {PASSWORD_RULES.map((rule) => {
        const met = rule.test(password);
        return (
          <span key={rule.id} className={met ? "is-met" : undefined}>
            <Check aria-hidden="true" size={13} strokeWidth={2.4} />
            {rule.label}
          </span>
        );
      })}
    </div>
  );
}

/**
 * Provider-agnostic authentication screen.
 *
 * Async callbacks receive:
 * - onGoogleSignIn()
 * - onSignIn({ email, password, captchaToken })
 * - onSignUp({ email, password, captchaToken })
 * - onForgotPassword({ email, captchaToken })
 * - onResetPassword({ password })
 *
 * A callback may throw, or return { error } / { message } for inline feedback.
 */
export function AuthScreen({
  mode: controlledMode,
  initialMode = AUTH_MODES.SIGN_IN,
  defaultEmail = "",
  captchaSiteKey = "",
  loading = false,
  error = "",
  success = "",
  onModeChange,
  onGoogleSignIn,
  onSignIn,
  onSignUp,
  onForgotPassword,
  onResetPassword,
}) {
  const [internalMode, setInternalMode] = useState(initialMode);
  const [email, setEmail] = useState(defaultEmail);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState("");
  const [localSuccess, setLocalSuccess] = useState("");
  const [captchaToken, setCaptchaToken] = useState("");
  const captchaRef = useRef(null);
  const formId = useId();
  const mode = controlledMode ?? internalMode;
  const copy = MODE_COPY[mode] ?? MODE_COPY[AUTH_MODES.SIGN_IN];
  const busy = loading || submitting;
  const needsEmail = mode !== AUTH_MODES.RESET_PASSWORD;
  const needsPassword = mode !== AUTH_MODES.FORGOT_PASSWORD;
  const needsStrongPassword = mode === AUTH_MODES.SIGN_UP || mode === AUTH_MODES.RESET_PASSWORD;
  const needsCaptcha = Boolean(captchaSiteKey) && mode !== AUTH_MODES.RESET_PASSWORD;
  const messageError = readableMessage(error) || localError;
  const messageSuccess = readableMessage(success) || localSuccess;
  const passwordRulesMet = PASSWORD_RULES.every((rule) => rule.test(password));

  useEffect(() => {
    setPassword("");
    setConfirmation("");
    setLocalError("");
    setLocalSuccess("");
    setCaptchaToken("");
    captchaRef.current?.resetCaptcha();
  }, [mode]);

  useEffect(() => {
    if (defaultEmail) setEmail(defaultEmail);
  }, [defaultEmail]);

  const changeMode = (nextMode) => {
    setInternalMode(nextMode);
    setPassword("");
    setConfirmation("");
    setLocalError("");
    setLocalSuccess("");
    onModeChange?.(nextMode);
  };

  const handleGoogleSignIn = async () => {
    if (busy || !onGoogleSignIn) return;
    setLocalError("");
    setLocalSuccess("");
    setSubmitting(true);
    try {
      const result = await onGoogleSignIn();
      if (result?.error) setLocalError(readableMessage(result.error));
    } catch (submitError) {
      setLocalError(readableMessage(submitError));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (busy) return;

    setLocalError("");
    setLocalSuccess("");

    if (needsStrongPassword && !passwordRulesMet) {
      setLocalError("Your password doesn’t meet all the requirements yet.");
      return;
    }

    if (needsStrongPassword && password !== confirmation) {
      setLocalError("The passwords don’t match.");
      return;
    }

    if (needsCaptcha && !captchaToken) {
      setLocalError("Complete the security check before continuing.");
      return;
    }

    const handler = {
      [AUTH_MODES.SIGN_IN]: onSignIn,
      [AUTH_MODES.SIGN_UP]: onSignUp,
      [AUTH_MODES.FORGOT_PASSWORD]: onForgotPassword,
      [AUTH_MODES.RESET_PASSWORD]: onResetPassword,
    }[mode];

    if (!handler) {
      setLocalError("This action isn’t available right now.");
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    const payload = mode === AUTH_MODES.RESET_PASSWORD
      ? { password }
      : mode === AUTH_MODES.FORGOT_PASSWORD
        ? { email: normalizedEmail, captchaToken }
        : { email: normalizedEmail, password, captchaToken };

    setSubmitting(true);
    try {
      const result = await handler(payload);
      if (result?.error) {
        setLocalError(readableMessage(result.error));
      } else if (result?.message) {
        setLocalSuccess(readableMessage(result.message));
      }
    } catch (submitError) {
      setLocalError(readableMessage(submitError));
    } finally {
      setSubmitting(false);
      if (needsCaptcha) {
        setCaptchaToken("");
        captchaRef.current?.resetCaptcha();
      }
    }
  };

  const feedbackId = `${formId}-feedback`;
  const requirementsId = `${formId}-password-rules`;

  return (
    <main className="auth-screen">
      <section className="auth-frame" aria-labelledby={`${formId}-title`}>
        <aside className="auth-brand-panel" aria-label="hibi">
          <div className="auth-brand-lockup" aria-label="hibi, teaching day by day">
            <BrandMark />
            <span><strong>hibi</strong><small>Teaching, day by day.</small></span>
          </div>
          <div className="auth-brand-copy">
            <h2>Teaching organized.<br />Time reclaimed.</h2>
            <p>One calm place for your students, grades, classes, and payments.</p>
          </div>
          <img
            className="auth-brand-art"
            src="/hibi-logo.png"
            alt="hibi cat resting on a class planner"
            loading="lazy"
            decoding="async"
            fetchPriority="low"
          />
          <div className="auth-color-notes" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        </aside>

        <div className="auth-form-panel">
          {mode === AUTH_MODES.FORGOT_PASSWORD || mode === AUTH_MODES.RESET_PASSWORD ? (
            <button className="auth-back-button" type="button" onClick={() => changeMode(AUTH_MODES.SIGN_IN)}>
              <ArrowLeft aria-hidden="true" size={17} />
              Back to sign in
            </button>
          ) : null}

          <div className="auth-heading">
            <h1 id={`${formId}-title`}>{copy.title}</h1>
            <p>{copy.description}</p>
          </div>

          {messageError ? (
            <div id={feedbackId} className="auth-feedback auth-feedback-error" role="alert">
              {messageError}
            </div>
          ) : null}
          {!messageError && messageSuccess ? (
            <div id={feedbackId} className="auth-feedback auth-feedback-success" role="status">
              {messageSuccess}
            </div>
          ) : null}

          {mode === AUTH_MODES.SIGN_IN && onGoogleSignIn ? (
            <>
              <button className="auth-google-button" type="button" onClick={handleGoogleSignIn} disabled={busy}>
                <GoogleMark />
                Continue with Google
              </button>
              <div className="auth-divider"><span>or use an existing email account</span></div>
            </>
          ) : null}

          <form className="auth-form" onSubmit={handleSubmit} aria-busy={busy}>
            {needsEmail ? (
              <AuthField
                id={`${formId}-email`}
                label="Email address"
                icon={Mail}
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                describedBy={messageError || messageSuccess ? feedbackId : undefined}
              />
            ) : null}

            {needsPassword ? (
              <PasswordField
                id={`${formId}-password`}
                label={mode === AUTH_MODES.RESET_PASSWORD ? "New password" : "Password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={mode === AUTH_MODES.SIGN_IN ? "current-password" : "new-password"}
                describedBy={needsStrongPassword ? requirementsId : undefined}
              />
            ) : null}

            {mode === AUTH_MODES.SIGN_IN && onForgotPassword ? (
              <button
                className="auth-text-button auth-forgot-link"
                type="button"
                onClick={() => changeMode(AUTH_MODES.FORGOT_PASSWORD)}
              >
                Forgot password?
              </button>
            ) : null}

            {needsStrongPassword ? (
              <>
                <PasswordRequirements password={password} id={requirementsId} />
                <PasswordField
                  id={`${formId}-confirmation`}
                  label="Confirm password"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  autoComplete="new-password"
                />
              </>
            ) : null}

            {needsCaptcha ? (
              <div className="auth-captcha" aria-label="Security check">
                <HCaptcha
                  ref={captchaRef}
                  sitekey={captchaSiteKey}
                  size="compact"
                  reCaptchaCompat={false}
                  onVerify={(token) => {
                    setCaptchaToken(token);
                    setLocalError("");
                  }}
                  onExpire={() => setCaptchaToken("")}
                  onError={() => {
                    setCaptchaToken("");
                    setLocalError("The security check could not load. Check your connection and try again.");
                  }}
                />
              </div>
            ) : null}

            <button className="auth-submit-button" type="submit" disabled={busy}>
              {busy ? <span className="auth-spinner" aria-hidden="true" /> : null}
              {busy ? "Please wait…" : copy.action}
            </button>
          </form>

          {mode === AUTH_MODES.SIGN_IN && onSignUp ? (
            <p className="auth-switch-copy">
              New to hibi?{" "}
              <button className="auth-text-button" type="button" onClick={() => changeMode(AUTH_MODES.SIGN_UP)}>
                Create an account
              </button>
            </p>
          ) : null}
          {mode === AUTH_MODES.SIGN_UP ? (
            <p className="auth-switch-copy">
              Already have an account?{" "}
              <button className="auth-text-button" type="button" onClick={() => changeMode(AUTH_MODES.SIGN_IN)}>
                Sign in
              </button>
            </p>
          ) : null}

          <footer className="auth-legal-links" aria-label="Legal and support links">
            <a href="/privacy.html">Privacy</a>
            <a href="/terms.html">Terms</a>
            <a href="mailto:hibicontact.old339@passinbox.com">Support</a>
          </footer>
        </div>
      </section>
    </main>
  );
}

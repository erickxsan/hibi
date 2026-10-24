import { useI18n } from "../i18n/index.jsx";
import { useEffect, useState } from "react";
import { KeyRound, LockKeyhole, LogOut, RefreshCw, ShieldCheck } from "lucide-react";
import { BrandMark } from "../components/BrandMark";
import { Button, Field, Input } from "../components/ui";
import { LanguageToggle } from "../i18n";
import { NEW_PASSWORD_GUIDANCE, getNewPasswordWarning } from "../crypto/passwords.js";
import "./cloud.css";

/** How long the protection check may run before Hibi offers to retry or leave. */
export const SLOW_PROTECTION_CHECK_MS = 8000;

export function WorkspaceEncryptionGate({
  accountEmail,
  bootstrap,
  loading,
  busy,
  error,
  progress,
  onActivate,
  onUnlockPassword,
  onUnlockRecovery,
  onRetry,
  onSignOut,
  slowCheckDelay = SLOW_PROTECTION_CHECK_MS,
}) {
  const { t: uiT } = useI18n();
  // While the check runs, only progress is shown: an early «Sign out» would forget this device for nothing.
  const [checkAttempt, setCheckAttempt] = useState(0);
  const [slowCheck, setSlowCheck] = useState(false);
  useEffect(() => {
    setSlowCheck(false);
    if (!loading) return undefined;
    const timer = globalThis.setTimeout(() => setSlowCheck(true), slowCheckDelay);
    return () => globalThis.clearTimeout(timer);
  }, [checkAttempt, loading, slowCheckDelay]);
  const retryCheck = () => {
    setCheckAttempt((attempt) => attempt + 1);
    onRetry?.();
  };
  const [rememberDevice, setRememberDevice] = useState(true);
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [formError, setFormError] = useState("");
  const [recoveryKey, setRecoveryKey] = useState("");
  const profile = bootstrap?.profile;
  const bootstrapKnown = bootstrap != null;
  const passwordWrapper = (bootstrap?.wrappers || []).find(
    (wrapper) => wrapper.type === "password" && !wrapper.revokedAt,
  );
  const needsPasswordCreation =
    bootstrapKnown && (!profile || (profile.migrationStatus === "migration_started" && !passwordWrapper));
  const passwordWarning = needsPasswordCreation ? getNewPasswordWarning(password) : "";
  const recoveryAvailable = (bootstrap?.wrappers || []).some(
    (wrapper) => wrapper.type === "recovery" && !wrapper.revokedAt,
  );

  const submitPassword = async (event) => {
    event.preventDefault();
    if (loading || busy || !bootstrapKnown) return;
    setFormError("");
    if (!password) {
      setFormError("Enter your encryption password.");
      return;
    }
    if (needsPasswordCreation) {
      if (passwordWarning) {
        setFormError(passwordWarning);
        return;
      }
      if (password !== passwordConfirmation) {
        setFormError("The password confirmation does not match.");
        return;
      }
      await onActivate({ password, rememberDevice });
      return;
    }
    await onUnlockPassword(password, { rememberDevice });
  };

  return (
    <main className="cloud-state-screen encryption-gate-screen" aria-busy={busy || loading}>
      <LanguageToggle className="cloud-language-toggle" />
      <section className="cloud-state-card encryption-gate-card" aria-labelledby="encryption-gate-title">
        <BrandMark />
        <span className="cloud-state-icon encryption-gate-icon">
          {profile ? <LockKeyhole aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}
        </span>
        <p className="cloud-eyebrow">{uiT("End-to-end encrypted workspace")}</p>
        <h1 id="encryption-gate-title">
          {loading
            ? uiT("Checking workspace protection…")
            : !bootstrapKnown
              ? uiT("Workspace temporarily unavailable")
              : needsPasswordCreation && !profile
                ? uiT("Protect your workspace before continuing")
                : needsPasswordCreation
                  ? uiT("Restart encryption with a password")
                  : profile.migrationStatus === "migration_started"
                    ? uiT("Resume the encrypted migration")
                    : uiT("Unlock your private workspace")}
        </h1>

        {!loading && !bootstrapKnown ? (
          <p>
            {uiT(
              "Hibi could not check your encryption settings. Retry when the connection recovers. Do not create a new password or clear this browser's data; your remembered device key may still be available.",
            )}
          </p>
        ) : null}

        {!loading && needsPasswordCreation && !profile ? (
          <p>
            {uiT(
              "Choose a separate encryption password. Hibi will derive a wrapping key locally, encrypt every record and recovery snapshot, verify the result, and only then remove readable cloud records for",
            )}{" "}
            <strong>{accountEmail}</strong>.
          </p>
        ) : null}
        {!loading && needsPasswordCreation && profile?.migrationStatus === "migration_started" ? (
          <p>
            {uiT(
              "The previous passkey setup did not finish. Your original records are still intact. Hibi will remove only that incomplete encrypted staging and restart safely with the password you choose.",
            )}
          </p>
        ) : null}
        {!loading && !needsPasswordCreation && profile?.migrationStatus === "migration_started" ? (
          <p>
            {uiT(
              "The original records are still intact and legacy writes are paused. Enter the encryption password created for this migration so Hibi can verify and finish it safely.",
            )}
          </p>
        ) : null}
        {!loading && profile?.migrationStatus === "active" ? (
          <p>
            {uiT(
              "Signing in identifies your account. Your encryption password or recovery key separately unlocks the content on this device; Supabase never receives the password, decrypted key, or records.",
            )}
          </p>
        ) : null}

        {loading ? (
          <div className="encryption-progress encryption-boot-progress" role="status" aria-live="polite">
            <span className="cloud-state-spinner" aria-hidden="true" />
            <span>
              {slowCheck
                ? uiT("This is taking longer than usual.")
                : uiT("Opening your encrypted workspace. This usually takes a few seconds.")}
            </span>
          </div>
        ) : null}
        {loading && slowCheck ? <p>{uiT("Check your connection and try again. Your records are safe.")}</p> : null}

        {progress ? (
          <div className="encryption-progress" role="status" aria-live="polite">
            <span className="cloud-state-spinner" aria-hidden="true" />
            <span>{uiT(progress)}</span>
          </div>
        ) : null}
        {error || formError ? (
          <div className="encryption-error" role="alert">
            <strong>
              {bootstrapKnown ? uiT("Workspace remains safe.") : uiT("Encryption settings could not be checked.")}
            </strong>
            <span>{uiT(formError || error?.message || "The workspace could not be unlocked.")}</span>
          </div>
        ) : null}

        {!loading && bootstrapKnown ? (
          <label className="remember-device-choice">
            <input
              type="checkbox"
              checked={rememberDevice}
              onChange={(event) => setRememberDevice(event.target.checked)}
              disabled={busy}
            />
            <span>
              <strong>{uiT("Remember this device")}</strong>
              <small>
                {uiT("Store a non-extractable local device key so future openings do not require the password.")}
              </small>
            </span>
          </label>
        ) : null}

        {!loading && bootstrapKnown ? (
          <form className="recovery-unlock-form encryption-password-form" onSubmit={submitPassword}>
            {needsPasswordCreation ? <p>{uiT(NEW_PASSWORD_GUIDANCE)}</p> : null}
            <Field label={needsPasswordCreation ? uiT("Create encryption password") : uiT("Encryption password")}>
              <Input
                type="password"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setFormError("");
                }}
                autoComplete={needsPasswordCreation ? "new-password" : "current-password"}
                spellCheck="false"
                disabled={busy}
              />
            </Field>
            {needsPasswordCreation ? (
              <Field label={uiT("Confirm encryption password")}>
                <Input
                  type="password"
                  value={passwordConfirmation}
                  onChange={(event) => {
                    setPasswordConfirmation(event.target.value);
                    setFormError("");
                  }}
                  autoComplete="new-password"
                  spellCheck="false"
                  disabled={busy}
                />
              </Field>
            ) : null}
            {passwordWarning ? <p role="status">{uiT(passwordWarning)}</p> : null}
            <Button
              type="submit"
              variant="primary"
              icon={KeyRound}
              disabled={
                busy || !password || (needsPasswordCreation && (!passwordConfirmation || Boolean(passwordWarning)))
              }
            >
              {busy
                ? uiT("Protecting workspace…")
                : passwordWarning
                  ? uiT("Create encryption password")
                  : needsPasswordCreation
                    ? profile
                      ? uiT("Restart and encrypt workspace")
                      : uiT("Set password and encrypt workspace")
                    : profile?.migrationStatus === "migration_started"
                      ? uiT("Resume encrypted migration")
                      : uiT("Unlock workspace")}
            </Button>
            {needsPasswordCreation ? (
              <p className="encryption-compatibility-note">
                {uiT(
                  "This password is used only in this browser to unlock encryption. Hibi cannot recover it if it is lost.",
                )}
              </p>
            ) : null}
          </form>
        ) : null}

        {!loading && profile && recoveryAvailable ? (
          <div className="encryption-unlock-options">
            <div className="recovery-unlock-form">
              <Field label={uiT("Recovery key")}>
                <Input
                  value={recoveryKey}
                  onChange={(event) => setRecoveryKey(event.target.value)}
                  placeholder={uiT("HIBI1-…")}
                  autoComplete="off"
                  spellCheck="false"
                />
              </Field>
              <Button
                icon={KeyRound}
                disabled={busy || !recoveryKey.trim()}
                onClick={() => onUnlockRecovery(recoveryKey, { rememberDevice })}
              >
                {uiT("Unlock with recovery key")}
              </Button>
            </div>
          </div>
        ) : null}

        {loading && slowCheck ? (
          <div className="cloud-state-actions encryption-secondary-actions">
            <Button variant="primary" icon={RefreshCw} onClick={retryCheck} disabled={busy}>
              {uiT("Retry")}
            </Button>
          </div>
        ) : !loading && (error || formError || !bootstrapKnown) ? (
          <div className="cloud-state-actions encryption-secondary-actions">
            <Button icon={RefreshCw} onClick={retryCheck} disabled={busy}>
              {uiT("Check again")}
            </Button>
          </div>
        ) : null}
        {!loading || slowCheck ? (
          <div className="encryption-signout">
            {/* Same action as before (it also forgets this device), now named for what it does and kept quiet. */}
            <button type="button" className="encryption-signout-link" onClick={onSignOut} disabled={busy}>
              <LogOut aria-hidden="true" size={16} />
              {uiT("Sign out and forget this device")}
            </button>
            <p className="encryption-compatibility-note">{uiT("Next time you will need your encryption password.")}</p>
          </div>
        ) : null}
      </section>
    </main>
  );
}

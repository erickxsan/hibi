import { useState } from "react";
import { KeyRound, LockKeyhole, LogOut, RefreshCw, ShieldCheck } from "lucide-react";
import { BrandMark } from "../components/BrandMark";
import { Button, Field, Input } from "../components/ui";
import { LanguageToggle } from "../i18n";
import "./cloud.css";

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
}) {
  const [rememberDevice, setRememberDevice] = useState(true);
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [formError, setFormError] = useState("");
  const [recoveryKey, setRecoveryKey] = useState("");
  const profile = bootstrap?.profile;
  const passwordWrapper = (bootstrap?.wrappers || []).find(
    (wrapper) => wrapper.type === "password" && !wrapper.revokedAt,
  );
  const needsPasswordCreation = !profile || (profile.migrationStatus === "migration_started" && !passwordWrapper);
  const recoveryAvailable = (bootstrap?.wrappers || []).some(
    (wrapper) => wrapper.type === "recovery" && !wrapper.revokedAt,
  );

  const submitPassword = async (event) => {
    event.preventDefault();
    setFormError("");
    if (!password) {
      setFormError("Enter your encryption password.");
      return;
    }
    if (needsPasswordCreation) {
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
        <p className="cloud-eyebrow">End-to-end encrypted workspace</p>
        <h1 id="encryption-gate-title">
          {loading
            ? "Checking workspace protection…"
            : needsPasswordCreation && !profile
              ? "Protect your workspace before continuing"
              : needsPasswordCreation
                ? "Restart encryption with a password"
                : profile.migrationStatus === "migration_started"
                  ? "Resume the encrypted migration"
                  : "Unlock your private workspace"}
        </h1>

        {!loading && needsPasswordCreation && !profile ? (
          <p>
            Choose a separate encryption password. Hibi will derive a wrapping key locally, encrypt every record and
            recovery snapshot, verify the result, and only then remove readable cloud records for{" "}
            <strong>{accountEmail}</strong>.
          </p>
        ) : null}
        {!loading && needsPasswordCreation && profile?.migrationStatus === "migration_started" ? (
          <p>
            The previous passkey setup did not finish. Your original records are still intact. Hibi will remove only
            that incomplete encrypted staging and restart safely with the password you choose.
          </p>
        ) : null}
        {!loading && !needsPasswordCreation && profile?.migrationStatus === "migration_started" ? (
          <p>
            The original records are still intact and legacy writes are paused. Enter the encryption password created
            for this migration so Hibi can verify and finish it safely.
          </p>
        ) : null}
        {!loading && profile?.migrationStatus === "active" ? (
          <p>
            Signing in identifies your account. Your encryption password or recovery key separately unlocks the content
            on this device; Supabase never receives the password, decrypted key, or records.
          </p>
        ) : null}

        {progress ? (
          <div className="encryption-progress" role="status" aria-live="polite">
            <span className="cloud-state-spinner" aria-hidden="true" />
            <span>{progress}</span>
          </div>
        ) : null}
        {error || formError ? (
          <div className="encryption-error" role="alert">
            <strong>Workspace remains safe.</strong>
            <span>{formError || error?.message || "The workspace could not be unlocked."}</span>
          </div>
        ) : null}

        {!loading ? (
          <label className="remember-device-choice">
            <input
              type="checkbox"
              checked={rememberDevice}
              onChange={(event) => setRememberDevice(event.target.checked)}
              disabled={busy}
            />
            <span>
              <strong>Remember this device</strong>
              <small>Store a non-extractable local device key so future openings do not require the password.</small>
            </span>
          </label>
        ) : null}

        {!loading ? (
          <form className="recovery-unlock-form encryption-password-form" onSubmit={submitPassword}>
            <Field label={needsPasswordCreation ? "Create encryption password" : "Encryption password"}>
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
              <Field label="Confirm encryption password">
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
            <Button
              type="submit"
              variant="primary"
              icon={KeyRound}
              disabled={busy || !password || (needsPasswordCreation && !passwordConfirmation)}
            >
              {busy
                ? "Protecting workspace…"
                : needsPasswordCreation
                  ? profile
                    ? "Restart and encrypt workspace"
                    : "Set password and encrypt workspace"
                  : profile?.migrationStatus === "migration_started"
                    ? "Resume encrypted migration"
                    : "Unlock workspace"}
            </Button>
            {needsPasswordCreation ? (
              <p className="encryption-compatibility-note">
                This password is used only in this browser to unlock encryption. Hibi cannot recover it if it is lost.
              </p>
            ) : null}
          </form>
        ) : null}

        {!loading && profile && recoveryAvailable ? (
          <div className="encryption-unlock-options">
            <div className="recovery-unlock-form">
              <Field label="Recovery key">
                <Input
                  value={recoveryKey}
                  onChange={(event) => setRecoveryKey(event.target.value)}
                  placeholder="HIBI1-…"
                  autoComplete="off"
                  spellCheck="false"
                />
              </Field>
              <Button
                icon={KeyRound}
                disabled={busy || !recoveryKey.trim()}
                onClick={() => onUnlockRecovery(recoveryKey, { rememberDevice })}
              >
                Unlock with recovery key
              </Button>
            </div>
          </div>
        ) : null}

        <div className="cloud-state-actions encryption-secondary-actions">
          {error || formError ? (
            <Button icon={RefreshCw} onClick={onRetry} disabled={busy}>
              Check again
            </Button>
          ) : null}
          <Button icon={LogOut} onClick={onSignOut} disabled={busy}>
            Sign out
          </Button>
        </div>
      </section>
    </main>
  );
}

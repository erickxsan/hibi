import { useState } from "react";
import { Fingerprint, KeyRound, LockKeyhole, LogOut, RefreshCw, ShieldCheck } from "lucide-react";
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
  passkeyPrfAvailable,
  onActivate,
  onUnlockPasskey,
  onUnlockRecovery,
  onRetry,
  onSignOut,
}) {
  const [rememberDevice, setRememberDevice] = useState(true);
  const [recoveryKey, setRecoveryKey] = useState("");
  const profile = bootstrap?.profile;
  const passkeys = (bootstrap?.wrappers || []).filter((wrapper) => wrapper.type === "passkey" && !wrapper.revokedAt);
  const recoveryAvailable = (bootstrap?.wrappers || []).some(
    (wrapper) => wrapper.type === "recovery" && !wrapper.revokedAt,
  );

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
            : !profile
              ? "Protect your workspace before continuing"
              : profile.migrationStatus === "migration_started"
                ? "Resume the encrypted migration"
                : "Unlock your private workspace"}
        </h1>

        {!loading && !profile ? (
          <p>
            Hibi will create an account master key protected by your passkey, encrypt every record and recovery snapshot
            locally, verify the result, and only then remove readable cloud records for <strong>{accountEmail}</strong>.
          </p>
        ) : null}
        {!loading && profile?.migrationStatus === "migration_started" ? (
          <p>
            The original records are still intact and legacy writes are paused. Use the passkey created for this
            migration so Hibi can verify and finish it safely.
          </p>
        ) : null}
        {!loading && profile?.migrationStatus === "active" ? (
          <p>
            Signing in identifies your account. Your passkey or recovery key separately unlocks the content on this
            device; Supabase never receives the decrypted key or records.
          </p>
        ) : null}

        {progress ? (
          <div className="encryption-progress" role="status" aria-live="polite">
            <span className="cloud-state-spinner" aria-hidden="true" />
            <span>{progress}</span>
          </div>
        ) : null}
        {error ? (
          <div className="encryption-error" role="alert">
            <strong>Workspace remains safe.</strong>
            <span>{error.message || "The workspace could not be unlocked."}</span>
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
              <small>Store a non-extractable local device key so future openings do not require biometrics.</small>
            </span>
          </label>
        ) : null}

        {!loading && !profile ? (
          <div className="cloud-state-actions encryption-primary-actions">
            <Button
              variant="primary"
              icon={Fingerprint}
              disabled={busy || !passkeyPrfAvailable}
              onClick={() => onActivate({ rememberDevice })}
            >
              {busy ? "Protecting workspace…" : "Create passkey and encrypt workspace"}
            </Button>
            {!passkeyPrfAvailable ? (
              <p className="encryption-compatibility-note">
                This browser/origin cannot create the required WebAuthn PRF passkey. Open the official Hibi site in a
                compatible browser; no migration has started.
              </p>
            ) : null}
          </div>
        ) : null}

        {!loading && profile ? (
          <div className="encryption-unlock-options">
            {passkeys.map((wrapper) => (
              <Button
                key={wrapper.wrapperId}
                variant="primary"
                icon={Fingerprint}
                disabled={busy || !passkeyPrfAvailable}
                onClick={() => onUnlockPasskey({ wrapperId: wrapper.wrapperId, rememberDevice })}
              >
                Unlock with {wrapper.label || "passkey"}
              </Button>
            ))}
            {recoveryAvailable ? (
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
            ) : null}
          </div>
        ) : null}

        <div className="cloud-state-actions encryption-secondary-actions">
          {error ? (
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

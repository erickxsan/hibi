import { useState } from "react";
import { CheckCircle2, Cloud, DatabaseBackup, LogOut, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { BrandMark } from "../components/BrandMark";
import { Button, Field, Input } from "../components/ui";
import { LanguageToggle } from "../i18n";
import "./cloud.css";

export function CloudLoading({ message = "Loading your private workspace…" }) {
  return (
    <main className="cloud-state-screen" aria-busy="true">
      <LanguageToggle className="cloud-language-toggle" />
      <div className="cloud-state-card">
        <BrandMark />
        <span className="cloud-state-spinner" aria-hidden="true" />
        <h1>hibi</h1>
        <p>{message}</p>
      </div>
    </main>
  );
}

export function CloudError({ error, onRetry, onSignOut }) {
  return (
    <main className="cloud-state-screen">
      <LanguageToggle className="cloud-language-toggle" />
      <section className="cloud-state-card cloud-error-card" aria-labelledby="cloud-error-title">
        <span className="cloud-state-icon">
          <Cloud aria-hidden="true" />
        </span>
        <h1 id="cloud-error-title">Cloud workspace unavailable</h1>
        <p>{error?.message || "The secure workspace could not be loaded. Check your connection and try again."}</p>
        <p>
          Your saved records have not been replaced. Retry or sign out, then contact support if the problem continues.
        </p>
        <div className="cloud-state-actions">
          <Button variant="primary" icon={RefreshCw} onClick={onRetry}>
            Try again
          </Button>
          <Button icon={LogOut} onClick={onSignOut}>
            Sign out
          </Button>
        </div>
      </section>
    </main>
  );
}

export function CloudConfigurationRequired() {
  return (
    <main className="cloud-state-screen">
      <LanguageToggle className="cloud-language-toggle" />
      <section className="cloud-state-card cloud-error-card" aria-labelledby="cloud-config-title">
        <span className="cloud-state-icon">
          <Cloud aria-hidden="true" />
        </span>
        <h1 id="cloud-config-title">Cloud setup required</h1>
        <p>
          This production build is missing its Supabase URL or public publishable key. No records can be entered until
          the deployment is configured correctly.
        </p>
      </section>
    </main>
  );
}

export function AccountDeletionPending({ busy = false, error, onResume, onSignOut }) {
  const [confirmation, setConfirmation] = useState("");
  const [localError, setLocalError] = useState("");
  return (
    <main className="cloud-state-screen">
      <LanguageToggle className="cloud-language-toggle" />
      <section className="cloud-state-card cloud-deletion-card" aria-labelledby="deletion-pending-title">
        <span className="cloud-state-icon">
          <Trash2 aria-hidden="true" />
        </span>
        <h1 id="deletion-pending-title">Account deletion is pending</h1>
        <p>
          Hibi has blocked this account so an old device, JWT, or offline outbox cannot recreate records. Resume the
          verified deletion to finish removing Auth.
        </p>
        <Field label="Type DELETE MY ACCOUNT to resume" error={localError || error}>
          <Input
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            autoComplete="off"
            spellCheck="false"
          />
        </Field>
        <div className="cloud-state-actions">
          <Button
            variant="danger"
            icon={Trash2}
            disabled={busy || confirmation !== "DELETE MY ACCOUNT"}
            onClick={async () => {
              setLocalError("");
              try {
                await onResume({ confirmation });
              } catch (caught) {
                setLocalError(caught?.message || "Deletion could not be resumed.");
              }
            }}
          >
            {busy ? "Finishing deletion…" : "Resume permanent deletion"}
          </Button>
          <Button icon={LogOut} onClick={onSignOut} disabled={busy}>
            Sign out
          </Button>
        </div>
      </section>
    </main>
  );
}

export function AccountDeletionComplete({ receipt, onRetryLocalPurge, onContinue }) {
  const [purgeBusy, setPurgeBusy] = useState(false);
  const [purgeError, setPurgeError] = useState("");
  return (
    <main className="cloud-state-screen">
      <LanguageToggle className="cloud-language-toggle" />
      <section className="cloud-state-card cloud-deletion-complete" aria-labelledby="deletion-complete-title">
        <span className="cloud-state-icon">
          <CheckCircle2 aria-hidden="true" />
        </span>
        <h1 id="deletion-complete-title">Account and data deleted</h1>
        <p>
          Cloud records, recovery history, imports, synchronization data, and the Auth account were permanently removed.
          {receipt.localPurgeComplete
            ? " Hibi also purged this account's encrypted copies from the current device."
            : " Local browser purging could not be verified."}
        </p>
        {!receipt.localPurgeComplete ? (
          <div className="cloud-local-purge-warning" role="alert">
            <p>{purgeError || "Retry while this browser is still open to remove the remaining device copy."}</p>
            <Button
              icon={RefreshCw}
              disabled={purgeBusy}
              onClick={async () => {
                setPurgeBusy(true);
                setPurgeError("");
                try {
                  await onRetryLocalPurge?.();
                } catch {
                  setPurgeError("Device cleanup is still blocked. Close other Hibi tabs and retry.");
                } finally {
                  setPurgeBusy(false);
                }
              }}
            >
              {purgeBusy ? "Cleaning device…" : "Retry device cleanup"}
            </Button>
          </div>
        ) : null}
        <dl className="deletion-receipt">
          <div>
            <dt>Request</dt>
            <dd>{receipt.requestId}</dd>
          </div>
          <div>
            <dt>Verification code</dt>
            <dd>{receipt.receiptSecret}</dd>
          </div>
          <div>
            <dt>Completed</dt>
            <dd>{new Date(receipt.completedAt).toLocaleString()}</dd>
          </div>
        </dl>
        <div className="cloud-state-actions">
          <Button variant="primary" onClick={onContinue}>
            Continue to sign in
          </Button>
        </div>
      </section>
    </main>
  );
}

export function LocalDataMigration({ state, accountEmail, busy, error, recoveryMode = false, onImport, onSkip }) {
  const counts = {
    students: state.students.length,
    groups: state.groups.length,
    grades: state.grades.length,
    classes: state.classLog.length,
  };

  return (
    <main className="cloud-state-screen">
      <LanguageToggle className="cloud-language-toggle" />
      <section className="cloud-migration-card" aria-labelledby="migration-title">
        <div className="cloud-migration-heading">
          <span className="cloud-state-icon">
            <DatabaseBackup aria-hidden="true" />
          </span>
          <div>
            <p className="cloud-eyebrow">{recoveryMode ? "Recovery copy found" : "One-time migration"}</p>
            <h1 id="migration-title">
              {recoveryMode ? "Recover this browser’s saved records?" : "Move this browser’s records online?"}
            </h1>
            <p>
              We found local class data on this device. You can {recoveryMode ? "restore" : "copy"} it into the private
              workspace for <strong>{accountEmail}</strong>.
            </p>
          </div>
        </div>

        <div className="cloud-migration-counts" aria-label="Local record summary">
          <div>
            <strong>{counts.students}</strong>
            <span>Students</span>
          </div>
          <div>
            <strong>{counts.groups}</strong>
            <span>Groups</span>
          </div>
          <div>
            <strong>{counts.grades}</strong>
            <span>Grades</span>
          </div>
          <div>
            <strong>{counts.classes}</strong>
            <span>Classes</span>
          </div>
        </div>

        <div className="cloud-security-note">
          <ShieldCheck aria-hidden="true" />
          <p>
            The copy is written only to your authenticated workspace. The local version stays on this device until you
            clear it yourself.
          </p>
        </div>
        {error ? (
          <p className="cloud-migration-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="cloud-state-actions cloud-migration-actions">
          <Button variant="primary" icon={Cloud} onClick={onImport} disabled={busy}>
            {busy ? "Restoring records…" : recoveryMode ? "Restore records from this browser" : "Move records online"}
          </Button>
          <Button onClick={onSkip} disabled={busy}>
            Start with an empty cloud workspace
          </Button>
        </div>
      </section>
    </main>
  );
}

import { useI18n } from "../i18n/index.jsx";
import { useState } from "react";
import { CheckCircle2, Cloud, DatabaseBackup, LogOut, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { BrandMark } from "../components/BrandMark";
import { Button, Field, Input } from "../components/ui";
import { LanguageToggle } from "../i18n";
import "./cloud.css";

export function CloudLoading({ message = "Loading your private workspace…" }) {
  const { t: uiT } = useI18n();
  return (
    <main className="cloud-state-screen" aria-busy="true">
      <LanguageToggle className="cloud-language-toggle" />
      <div className="cloud-state-card">
        <BrandMark />
        <span className="cloud-state-spinner" aria-hidden="true" />
        <h1>{uiT("hibi")}</h1>
        <p>{uiT(message)}</p>
      </div>
    </main>
  );
}

export function CloudError({ error, onRetry, onSignOut }) {
  const { t: uiT } = useI18n();
  return (
    <main className="cloud-state-screen">
      <LanguageToggle className="cloud-language-toggle" />
      <section className="cloud-state-card cloud-error-card" aria-labelledby="cloud-error-title">
        <span className="cloud-state-icon">
          <Cloud aria-hidden="true" />
        </span>
        <h1 id="cloud-error-title">{uiT("Cloud workspace unavailable")}</h1>
        <p>{uiT(error?.message || "The secure workspace could not be loaded. Check your connection and try again.")}</p>
        <p>
          {uiT(
            "Your saved records have not been replaced. Retry or sign out, then contact support if the problem continues.",
          )}
        </p>
        <div className="cloud-state-actions">
          <Button variant="primary" icon={RefreshCw} onClick={onRetry}>
            {uiT("Try again")}
          </Button>
          <Button icon={LogOut} onClick={onSignOut}>
            {uiT("Sign out")}
          </Button>
        </div>
      </section>
    </main>
  );
}

export function CloudConfigurationRequired() {
  const { t: uiT } = useI18n();
  return (
    <main className="cloud-state-screen">
      <LanguageToggle className="cloud-language-toggle" />
      <section className="cloud-state-card cloud-error-card" aria-labelledby="cloud-config-title">
        <span className="cloud-state-icon">
          <Cloud aria-hidden="true" />
        </span>
        <h1 id="cloud-config-title">{uiT("Cloud setup required")}</h1>
        <p>
          {uiT(
            "This production build is missing its Supabase URL or public publishable key. No records can be entered until the deployment is configured correctly.",
          )}
        </p>
      </section>
    </main>
  );
}

export function AccountDeletionPending({ busy = false, error = undefined, onResume, onSignOut }) {
  const { t: uiT } = useI18n();
  const [confirmation, setConfirmation] = useState("");
  const [localError, setLocalError] = useState("");
  return (
    <main className="cloud-state-screen">
      <LanguageToggle className="cloud-language-toggle" />
      <section className="cloud-state-card cloud-deletion-card" aria-labelledby="deletion-pending-title">
        <span className="cloud-state-icon">
          <Trash2 aria-hidden="true" />
        </span>
        <h1 id="deletion-pending-title">{uiT("Account deletion is pending")}</h1>
        <p>
          {uiT(
            "Hibi has blocked this account so an old device, JWT, or offline outbox cannot recreate records. Resume the verified deletion to finish removing Auth.",
          )}
        </p>
        <Field label={uiT("Type DELETE MY ACCOUNT to resume")} error={localError || error}>
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
            disabled={busy || confirmation !== uiT("DELETE MY ACCOUNT")}
            onClick={async () => {
              if (confirmation !== uiT("DELETE MY ACCOUNT")) return;
              setLocalError("");
              try {
                await onResume({ confirmation: "DELETE MY ACCOUNT" });
              } catch (caught) {
                setLocalError(caught?.message || "Deletion could not be resumed.");
              }
            }}
          >
            {busy ? uiT("Finishing deletion…") : uiT("Resume permanent deletion")}
          </Button>
          <Button icon={LogOut} onClick={onSignOut} disabled={busy}>
            {uiT("Sign out")}
          </Button>
        </div>
      </section>
    </main>
  );
}

export function AccountDeletionComplete({ receipt, onRetryLocalPurge, onContinue }) {
  const { t: uiT, locale } = useI18n();
  const [purgeBusy, setPurgeBusy] = useState(false);
  const [purgeError, setPurgeError] = useState("");
  return (
    <main className="cloud-state-screen">
      <LanguageToggle className="cloud-language-toggle" />
      <section className="cloud-state-card cloud-deletion-complete" aria-labelledby="deletion-complete-title">
        <span className="cloud-state-icon">
          <CheckCircle2 aria-hidden="true" />
        </span>
        <h1 id="deletion-complete-title">{uiT("Account and data deleted")}</h1>
        <p>
          {uiT(
            "Cloud records, recovery history, imports, synchronization data, and the Auth account were permanently removed.",
          )}
          {receipt.localPurgeComplete
            ? uiT(" Hibi also purged this account's encrypted copies from the current device.")
            : uiT(" Local browser purging could not be verified.")}
        </p>
        {!receipt.localPurgeComplete ? (
          <div className="cloud-local-purge-warning" role="alert">
            <p>{uiT(purgeError || "Retry while this browser is still open to remove the remaining device copy.")}</p>
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
              {purgeBusy ? uiT("Cleaning device…") : uiT("Retry device cleanup")}
            </Button>
          </div>
        ) : null}
        <dl className="deletion-receipt">
          <div>
            <dt>{uiT("Request")}</dt>
            <dd>{receipt.requestId}</dd>
          </div>
          <div>
            <dt>{uiT("Verification code")}</dt>
            <dd>{receipt.receiptSecret}</dd>
          </div>
          <div>
            <dt>{uiT("Completed")}</dt>
            <dd>{new Date(receipt.completedAt).toLocaleString(locale)}</dd>
          </div>
        </dl>
        <div className="cloud-state-actions">
          <Button variant="primary" onClick={onContinue}>
            {uiT("Continue to sign in")}
          </Button>
        </div>
      </section>
    </main>
  );
}

export function LocalDataMigration({ state, accountEmail, busy, error, recoveryMode = false, onImport, onSkip }) {
  const { t: uiT } = useI18n();
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
            <p className="cloud-eyebrow">{recoveryMode ? uiT("Recovery copy found") : uiT("One-time migration")}</p>
            <h1 id="migration-title">
              {recoveryMode ? uiT("Recover this browser’s saved records?") : uiT("Move this browser’s records online?")}
            </h1>
            <p>
              {uiT("We found local class data on this device. You can ")}
              {recoveryMode ? uiT("restore") : uiT("copy")} {uiT(" it into the private workspace for ")}
              <strong>{accountEmail}</strong>.
            </p>
          </div>
        </div>

        <div className="cloud-migration-counts" aria-label={uiT("Local record summary")}>
          <div>
            <strong>{counts.students}</strong>
            <span>{uiT("Students")}</span>
          </div>
          <div>
            <strong>{counts.groups}</strong>
            <span>{uiT("Groups")}</span>
          </div>
          <div>
            <strong>{counts.grades}</strong>
            <span>{uiT("Grades")}</span>
          </div>
          <div>
            <strong>{counts.classes}</strong>
            <span>{uiT("Classes")}</span>
          </div>
        </div>

        <div className="cloud-security-note">
          <ShieldCheck aria-hidden="true" />
          <p>
            {uiT(
              "The copy is written only to your authenticated workspace. The local version stays on this device until you clear it yourself.",
            )}
          </p>
        </div>
        {error ? (
          <p className="cloud-migration-error" role="alert">
            {uiT(error)}
          </p>
        ) : null}
        <div className="cloud-state-actions cloud-migration-actions">
          <Button variant="primary" icon={Cloud} onClick={onImport} disabled={busy}>
            {busy
              ? uiT("Restoring records…")
              : recoveryMode
                ? uiT("Restore records from this browser")
                : uiT("Move records online")}
          </Button>
          <Button onClick={onSkip} disabled={busy}>
            {uiT("Start with an empty cloud workspace")}
          </Button>
        </div>
      </section>
    </main>
  );
}

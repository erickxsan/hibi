import { useState } from "react";
import { Cloud, DatabaseBackup, LogOut, RefreshCw, RotateCcw, ShieldCheck } from "lucide-react";
import { BrandMark } from "../components/BrandMark";
import { Button, ConfirmDialog } from "../components/ui";
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

export function CloudError({ error, onRetry, onSignOut, onReset }) {
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState("");
  const resetWorkspace = async () => {
    setResetting(true);
    setResetError("");
    try {
      await onReset?.();
      setConfirmReset(false);
    } catch (caught) {
      setResetError(caught?.message || "The workspace could not be reset.");
    } finally {
      setResetting(false);
    }
  };
  return (
    <>
      <main className="cloud-state-screen">
        <LanguageToggle className="cloud-language-toggle" />
        <section className="cloud-state-card cloud-error-card" aria-labelledby="cloud-error-title">
          <span className="cloud-state-icon"><Cloud aria-hidden="true" /></span>
          <h1 id="cloud-error-title">Cloud workspace unavailable</h1>
          <p>{error?.message || "The secure workspace could not be loaded. Check your connection and try again."}</p>
          <div className="cloud-state-actions">
            <Button variant="primary" icon={RefreshCw} onClick={onRetry}>Try again</Button>
            {onReset ? <Button variant="danger" icon={RotateCcw} onClick={() => setConfirmReset(true)}>Reset unreadable data</Button> : null}
            <Button icon={LogOut} onClick={onSignOut}>Sign out</Button>
          </div>
        </section>
      </main>
      <ConfirmDialog
        open={confirmReset}
        title="Reset this cloud workspace?"
        description={`Use this only when the saved workspace is unreadable. It permanently replaces the account data with an empty workspace; restore a trusted JSON backup afterward.${resetError ? ` Reset failed: ${resetError}` : ""}`}
        confirmLabel="Reset workspace"
        busy={resetting}
        onClose={() => setConfirmReset(false)}
        onConfirm={resetWorkspace}
      />
    </>
  );
}

export function CloudConfigurationRequired() {
  return (
    <main className="cloud-state-screen">
      <LanguageToggle className="cloud-language-toggle" />
      <section className="cloud-state-card cloud-error-card" aria-labelledby="cloud-config-title">
        <span className="cloud-state-icon"><Cloud aria-hidden="true" /></span>
        <h1 id="cloud-config-title">Cloud setup required</h1>
        <p>This production build is missing its Supabase URL or public publishable key. No records can be entered until the deployment is configured correctly.</p>
      </section>
    </main>
  );
}

export function LocalDataMigration({ state, accountEmail, busy, error, onImport, onSkip }) {
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
          <span className="cloud-state-icon"><DatabaseBackup aria-hidden="true" /></span>
          <div>
            <p className="cloud-eyebrow">One-time migration</p>
            <h1 id="migration-title">Move this browser’s records online?</h1>
            <p>We found local class data on this device. You can copy it into the private workspace for <strong>{accountEmail}</strong>.</p>
          </div>
        </div>

        <div className="cloud-migration-counts" aria-label="Local record summary">
          <div><strong>{counts.students}</strong><span>Students</span></div>
          <div><strong>{counts.groups}</strong><span>Groups</span></div>
          <div><strong>{counts.grades}</strong><span>Grades</span></div>
          <div><strong>{counts.classes}</strong><span>Classes</span></div>
        </div>

        <div className="cloud-security-note">
          <ShieldCheck aria-hidden="true" />
          <p>The copy is written only to your authenticated workspace. The local version stays on this device until you clear it yourself.</p>
        </div>
        {error ? <p className="cloud-migration-error" role="alert">{error}</p> : null}
        <div className="cloud-state-actions cloud-migration-actions">
          <Button variant="primary" icon={Cloud} onClick={onImport} disabled={busy}>{busy ? "Moving records…" : "Move records online"}</Button>
          <Button onClick={onSkip} disabled={busy}>Start with an empty cloud workspace</Button>
        </div>
      </section>
    </main>
  );
}

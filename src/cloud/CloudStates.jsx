import { Cloud, DatabaseBackup, LogOut, RefreshCw, ShieldCheck } from "lucide-react";
import { BrandMark } from "../components/BrandMark";
import { Button } from "../components/ui";
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
        <span className="cloud-state-icon"><Cloud aria-hidden="true" /></span>
        <h1 id="cloud-error-title">Cloud workspace unavailable</h1>
        <p>{error?.message || "The secure workspace could not be loaded. Check your connection and try again."}</p>
        <p>Your saved records have not been replaced. Retry or sign out, then contact support if the problem continues.</p>
        <div className="cloud-state-actions">
          <Button variant="primary" icon={RefreshCw} onClick={onRetry}>Try again</Button>
          <Button icon={LogOut} onClick={onSignOut}>Sign out</Button>
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
        <span className="cloud-state-icon"><Cloud aria-hidden="true" /></span>
        <h1 id="cloud-config-title">Cloud setup required</h1>
        <p>This production build is missing its Supabase URL or public publishable key. No records can be entered until the deployment is configured correctly.</p>
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
          <span className="cloud-state-icon"><DatabaseBackup aria-hidden="true" /></span>
          <div>
            <p className="cloud-eyebrow">{recoveryMode ? "Recovery copy found" : "One-time migration"}</p>
            <h1 id="migration-title">{recoveryMode ? "Recover this browser’s saved records?" : "Move this browser’s records online?"}</h1>
            <p>We found local class data on this device. You can {recoveryMode ? "restore" : "copy"} it into the private workspace for <strong>{accountEmail}</strong>.</p>
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
          <Button variant="primary" icon={Cloud} onClick={onImport} disabled={busy}>{busy ? "Restoring records…" : recoveryMode ? "Restore records from this browser" : "Move records online"}</Button>
          <Button onClick={onSkip} disabled={busy}>Start with an empty cloud workspace</Button>
        </div>
      </section>
    </main>
  );
}

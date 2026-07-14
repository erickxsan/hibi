import { useEffect, useRef, useState } from "react";
import { Clock3, Download, Globe2, LockKeyhole, Trash2, Upload } from "lucide-react";
import { Button, ConfirmDialog, Drawer, Field, Input } from "../components/ui";
import { MAX_BACKUP_BYTES } from "../domain";
import { confirmDiscard, draftChanged, useUnsavedChanges } from "../hooks/useUnsavedChanges";
import { LanguageToggle } from "../i18n";

function settingsDraft(settings) {
  return { ...settings, hourlyRateMxn: settings.hourlyRate };
}

export default function Settings({ state, actions, persistenceMode, registerNavigationBlocker }) {
  const [draft, setDraft] = useState(() => settingsDraft(state.settings));
  const [saving, setSaving] = useState(false);
  const [pendingImport, setPendingImport] = useState(null);
  const [clearTarget, setClearTarget] = useState("");
  const fileRef = useRef(null);
  const baselineRef = useRef(settingsDraft(state.settings));
  const dirty = draftChanged(draft, baselineRef.current);

  useUnsavedChanges(registerNavigationBlocker, dirty, "Discard your unsaved Settings changes?");
  useEffect(() => {
    const next = settingsDraft(state.settings);
    baselineRef.current = next;
    setDraft(next);
  }, [state.settings]);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await actions.updateSettings(draft);
      await actions.updatePreferences({ selectedMonth: draft.selectedMonth, asOfDate: draft.asOfDate });
      baselineRef.current = draft;
    } finally {
      setSaving(false);
    }
  };

  const importFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > MAX_BACKUP_BYTES) {
      actions.notify("That backup is larger than the 5 MB safety limit.", "error");
      return;
    }
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      setPendingImport({
        name: file.name,
        text,
        counts: {
          students: Array.isArray(parsed.students) ? parsed.students.length : 0,
          groups: Array.isArray(parsed.groups) ? parsed.groups.length : 0,
          grades: Array.isArray(parsed.grades) ? parsed.grades.length : 0,
          classes: Array.isArray(parsed.classLog) ? parsed.classLog.length : 0,
        },
      });
    } catch {
      actions.notify("The selected file is not valid JSON.", "error");
    }
  };

  return (
    <div className="page settings-page">
      <div className="page-heading"><div><h1>Settings</h1><p>Manage classroom defaults, reporting dates, language, backup, and privacy.</p></div></div>
      <section className="settings-stack">
        <article className="settings-card">
          <div className="settings-icon yellow"><Clock3 size={22} /></div>
          <div className="settings-content">
            <h2>Classroom defaults</h2><p>Used when recording classes and calculating alerts and projections.</p>
            <div className="settings-controls settings-controls-expanded">
              <Field label="Default duration"><Input type="number" min="0" step="0.25" value={draft.defaultClassHours} onChange={(event) => setDraft({ ...draft, defaultClassHours: Number(event.target.value) })} /><small>hours</small></Field>
              <Field label="Hourly rate"><Input type="number" min="0" step="1" value={draft.hourlyRateMxn} onChange={(event) => setDraft({ ...draft, hourlyRateMxn: Number(event.target.value) })} /><small>MXN / hour</small></Field>
              <Field label="Projection window"><Input type="number" min="1" step="1" value={draft.recentProjectionWeeks} onChange={(event) => setDraft({ ...draft, recentProjectionWeeks: Number(event.target.value) })} /><small>weeks</small></Field>
              <Field label="Low grade threshold"><Input type="number" min="0" max="100" step="1" value={Math.round(draft.lowGradeThreshold * 100)} onChange={(event) => setDraft({ ...draft, lowGradeThreshold: Number(event.target.value) / 100 })} /><small>percent</small></Field>
              <Field label="Low attendance threshold"><Input type="number" min="0" max="100" step="1" value={Math.round(draft.lowAttendanceThreshold * 100)} onChange={(event) => setDraft({ ...draft, lowAttendanceThreshold: Number(event.target.value) / 100 })} /><small>percent</small></Field>
              <Field label="Selected report month"><Input type="month" value={draft.selectedMonth.slice(0, 7)} onChange={(event) => setDraft({ ...draft, selectedMonth: `${event.target.value}-01` })} /></Field>
              <Field label="Balances calculated through"><Input type="date" value={draft.asOfDate} onChange={(event) => setDraft({ ...draft, asOfDate: event.target.value })} /></Field>
              <Button variant="primary" onClick={save} disabled={!dirty || saving}>{saving ? "Saving…" : "Save defaults"}</Button>
            </div>
          </div>
        </article>
        <article className="settings-card"><div className="settings-icon blue"><Globe2 size={22} /></div><div className="settings-content"><h2>Language</h2><p>Choose the interface language.</p><LanguageToggle className="settings-language" /></div></article>
        <article className="settings-card">
          <div className="settings-icon sage"><Download size={22} /></div>
          <div className="settings-content"><h2>Backup, import & export</h2><p>{persistenceMode === "cloud" ? "Your records sync to your private cloud workspace. Keep an offline JSON backup too." : "Your records are stored in this browser. Export a backup regularly."}</p><div className="button-cluster"><Button icon={Download} onClick={actions.exportJson}>Download backup</Button><Button icon={Upload} onClick={() => fileRef.current?.click()}>Restore backup</Button><input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={importFile} /></div></div>
        </article>
        <article className="settings-card">
          <div className="settings-icon lilac"><LockKeyhole size={22} /></div>
          <div className="settings-content"><h2>Data & privacy</h2><p>Backups include student, parent, grade, attendance, and payment data. Store them privately.</p><div className="danger-line"><span><strong>Clear all workspace data</strong><small>This cannot be undone without a backup.</small></span><Button variant="danger" icon={Trash2} onClick={() => setClearTarget("workspace")}>Clear all data</Button></div>{persistenceMode === "cloud" ? <div className="danger-line secondary-danger"><span><strong>Remove old browser copy</strong><small>Your signed-in cloud workspace is not affected.</small></span><Button onClick={() => setClearTarget("local")}>Remove local copy</Button></div> : null}</div>
        </article>
      </section>

      <Drawer open={Boolean(pendingImport)} onClose={() => setPendingImport(null)} title="Restore this backup?" description={pendingImport ? `${pendingImport.name} will replace the current workspace data.` : ""} size="compact" footer={<><Button onClick={() => setPendingImport(null)}>Cancel</Button><Button variant="danger" onClick={async () => { if (await actions.importJson(pendingImport.text)) setPendingImport(null); }}>Restore backup</Button></>}>
        {pendingImport ? <dl className="import-summary"><div><dt>Students</dt><dd>{pendingImport.counts.students}</dd></div><div><dt>Groups</dt><dd>{pendingImport.counts.groups}</dd></div><div><dt>Grades</dt><dd>{pendingImport.counts.grades}</dd></div><div><dt>Class records</dt><dd>{pendingImport.counts.classes}</dd></div></dl> : null}
      </Drawer>
      <ConfirmDialog
        open={Boolean(clearTarget)}
        title={clearTarget === "local" ? "Remove the old local copy?" : persistenceMode === "cloud" ? "Clear all cloud data?" : "Clear all data?"}
        description={clearTarget === "local" ? "This removes only the legacy browser copy on this device. Your signed-in cloud workspace remains available." : "Students, groups, grades, attendance, and payment records will be removed."}
        confirmLabel={clearTarget === "local" ? "Remove local copy" : "Clear all data"}
        onClose={() => setClearTarget("")}
        onConfirm={async () => {
          const cleared = clearTarget === "local" ? actions.clearLegacyLocalData() : await actions.clearAll();
          if (cleared) setClearTarget("");
        }}
      />
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { Clock3, Download, FilePlus2, Globe2, History, LockKeyhole, RotateCcw, ShieldCheck, Upload, Volume2 } from "lucide-react";
import { Button, ConfirmDialog, Drawer, Field, Input, Select } from "../components/ui";
import { importState, MAX_BACKUP_BYTES } from "../domain";
import { confirmDiscard, draftChanged, useUnsavedChanges } from "../hooks/useUnsavedChanges";
import { LanguageToggle, useI18n } from "../i18n";
import { getHibiSoundsEnabled, playHibiSound, setHibiSoundsEnabled } from "../utils/hibiSounds";

function settingsDraft(settings) {
  return { ...settings, hourlyRateMxn: settings.hourlyRate };
}

async function sha256(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export default function Settings({ state, actions, persistenceMode, registerNavigationBlocker }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(() => settingsDraft(state.settings));
  const [saving, setSaving] = useState(false);
  const [pendingImport, setPendingImport] = useState(null);
  const [pendingRecordImport, setPendingRecordImport] = useState(null);
  const [recordImportDecisions, setRecordImportDecisions] = useState({});
  const [recordImportBusy, setRecordImportBusy] = useState(false);
  const [importConfirmation, setImportConfirmation] = useState("");
  const [clearTarget, setClearTarget] = useState("");
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [recoveryPoints, setRecoveryPoints] = useState([]);
  const [pendingRecovery, setPendingRecovery] = useState(null);
  const [soundsEnabled, setSoundsEnabled] = useState(getHibiSoundsEnabled);
  const fileRef = useRef(null);
  const recordsFileRef = useRef(null);
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
      const parsed = importState(text);
      const counts = {
        students: parsed.students.length,
        groups: parsed.groups.length,
        grades: parsed.grades.length,
        classes: parsed.classLog.length,
      };
      const currentCounts = {
        students: state.students.length,
        groups: state.groups.length,
        grades: state.grades.length,
        classes: state.classLog.length,
      };
      const removals = Object.keys(counts).filter((key) => counts[key] < currentCounts[key]);
      setPendingImport({
        name: file.name,
        text,
        counts,
        currentCounts,
        removals,
      });
      setImportConfirmation("");
    } catch (error) {
      actions.notify(error?.message || "The selected file is not a valid Hibi backup.", "error");
    }
  };

  const previewRecordImport = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > MAX_BACKUP_BYTES) {
      actions.notify("That backup is larger than the 5 MB safety limit.", "error");
      return;
    }
    setRecordImportBusy(true);
    try {
      const text = await file.text();
      const fileHash = await sha256(text);
      const plan = await actions.previewImportRecords(text, fileHash);
      setRecordImportDecisions({});
      setPendingRecordImport({ ...plan, text, fileHash, name: file.name });
    } catch (error) {
      actions.notify(error?.message || "The selected file is not a valid Hibi backup.", "error");
    } finally {
      setRecordImportBusy(false);
    }
  };

  const applyRecordImport = async () => {
    if (!pendingRecordImport || recordImportBusy || pendingRecordImport.previousImport) return;
    setRecordImportBusy(true);
    try {
      const success = await actions.importRecords(pendingRecordImport.text, {
        fileHash: pendingRecordImport.fileHash,
        sourceName: pendingRecordImport.name,
        decisions: recordImportDecisions,
        signature: pendingRecordImport.signature,
      });
      if (success) setPendingRecordImport(null);
    } finally {
      setRecordImportBusy(false);
    }
  };

  const openRecoveryHistory = async () => {
    setRecoveryOpen(true);
    setRecoveryLoading(true);
    try {
      setRecoveryPoints(await actions.listRecoveryPoints());
    } catch (error) {
      actions.notify(error?.message || "Recovery history could not be loaded.", "error");
    } finally {
      setRecoveryLoading(false);
    }
  };

  const toggleSounds = () => {
    const next = !soundsEnabled;
    setSoundsEnabled(next);
    setHibiSoundsEnabled(next);
    if (next) playHibiSound("selection");
  };

  return (
    <div className="page settings-page">
      <div className="page-heading"><div><h1>Settings</h1><p>Manage classroom defaults, language, sounds, backup, and privacy.</p></div></div>
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
              <Button variant="primary" onClick={save} disabled={!dirty || saving}>{saving ? "Saving…" : "Save defaults"}</Button>
            </div>
          </div>
        </article>
        <article className="settings-card">
          <div className="settings-icon blue"><Globe2 size={22} /></div>
          <div className="settings-content">
            <h2>Interface</h2><p>Choose the interface language and whether Hibi plays gentle feedback sounds.</p>
            <div className="interface-settings">
              <div className="interface-setting"><span><strong>Language</strong><small>Choose the interface language.</small></span><LanguageToggle className="settings-language" /></div>
              <div className="interface-setting"><span className="sound-setting-copy"><Volume2 aria-hidden="true" size={18} /><span><strong>Sound effects</strong><small>A few gentle cues for saves, attendance, payments, and avatars.</small></span></span><button className="sound-toggle" type="button" role="switch" aria-checked={soundsEnabled} aria-label={soundsEnabled ? "Turn sound effects off" : "Turn sound effects on"} onClick={toggleSounds}><span aria-hidden="true" /><b>{soundsEnabled ? "On" : "Off"}</b></button></div>
            </div>
          </div>
        </article>
        <article className="settings-card">
          <div className="settings-icon sage"><Download size={22} /></div>
          <div className="settings-content">
            <h2>Records, backups & recovery</h2>
            <p>{persistenceMode === "cloud" ? "Add records safely or keep a complete recovery copy of your private cloud workspace." : "Add records safely and export a backup regularly."}</p>
            <div className="settings-data-actions">
              <div className="settings-data-action safe-import-action"><span><strong>Import records</strong><small>Add records from another Hibi JSON backup. Existing records and settings are never removed.</small></span><Button variant="primary" icon={FilePlus2} disabled={recordImportBusy} onClick={() => recordsFileRef.current?.click()}>{recordImportBusy ? "Reading…" : "Import records"}</Button></div>
              <div className="settings-data-action"><span><strong>Backup & recovery</strong><small>Download everything, or intentionally replace the workspace from a trusted full backup.</small></span><div className="button-cluster"><Button icon={Download} onClick={actions.exportJson}>Download backup</Button><Button icon={Upload} onClick={() => fileRef.current?.click()}>Restore full backup</Button>{persistenceMode === "cloud" ? <Button icon={History} onClick={openRecoveryHistory}>Recovery history</Button> : null}</div></div>
            </div>
            <input ref={recordsFileRef} type="file" accept=".json,application/json" hidden onChange={previewRecordImport} />
            <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={importFile} />
          </div>
        </article>
        <article className="settings-card">
          <div className="settings-icon lilac"><LockKeyhole size={22} /></div>
          <div className="settings-content"><h2>Data & privacy</h2><p>Backups include student, parent, grade, attendance, and payment data. Store them privately.</p>{persistenceMode === "cloud" ? <div className="danger-line secondary-danger"><span><strong>Remove old browser copy</strong><small>Your signed-in cloud workspace and recovery history are not affected.</small></span><Button onClick={() => setClearTarget("local")}>Remove local copy</Button></div> : null}</div>
        </article>
      </section>

      <Drawer
        open={Boolean(pendingRecordImport)}
        onClose={() => setPendingRecordImport(null)}
        title="Review record import"
        description={pendingRecordImport ? `${pendingRecordImport.name} was compared with the records currently saved in Hibi.` : ""}
        size="normal"
        footer={<><Button onClick={() => setPendingRecordImport(null)}>Cancel</Button><Button variant="primary" icon={ShieldCheck} disabled={recordImportBusy || Boolean(pendingRecordImport?.previousImport)} onClick={applyRecordImport}>{recordImportBusy ? "Importing…" : t(`Import ${pendingRecordImport ? pendingRecordImport.summary.added + Object.values(recordImportDecisions).filter((value) => value === "use-imported").length : 0} records`)}</Button></>}
      >
        {pendingRecordImport ? <div className="record-import-review">
          <div className="import-safety-note"><ShieldCheck size={22} aria-hidden="true" /><span><strong>No existing records will be deleted.</strong><small>Conflicts keep the current Hibi version unless you explicitly choose the imported version.</small></span></div>
          {pendingRecordImport.previousImport ? <div className="import-repeat-warning"><strong>This exact file was already imported.</strong><span>Imported {new Date(pendingRecordImport.previousImport.createdAt).toLocaleString()}. Reusing it is blocked to prevent duplicate work.</span></div> : null}
          <dl className="record-import-summary">
            <div><dt>New</dt><dd>{pendingRecordImport.summary.added}</dd></div>
            <div><dt>Exact duplicates</dt><dd>{pendingRecordImport.summary.duplicates}</dd></div>
            <div><dt>Needs review</dt><dd>{pendingRecordImport.summary.conflicts}</dd></div>
            <div><dt>Will be deleted</dt><dd>0</dd></div>
          </dl>
          <div className="record-import-collections">
            {Object.entries(pendingRecordImport.summary.byCollection).filter(([, counts]) => counts.added || counts.duplicates || counts.conflicts).map(([collection, counts]) => <div key={collection}><strong>{pendingRecordImport.entries.find((entry) => entry.collection === collection)?.collectionLabel || collection}</strong><span>{t(`${counts.added} new · ${counts.duplicates} duplicates · ${counts.conflicts} review`)}</span></div>)}
          </div>
          {pendingRecordImport.summary.conflicts ? <section className="record-import-conflicts"><div><h3>Resolve possible duplicates</h3><p>“Keep current” is the safest default.</p></div>{pendingRecordImport.entries.filter((entry) => entry.status === "conflict").map((entry) => <article key={entry.key}><span><strong>{entry.label}</strong><small>{entry.collectionLabel} · {entry.reason}</small></span><Select aria-label={`Import choice for ${entry.label}`} value={recordImportDecisions[entry.key] || "keep-current"} onChange={(event) => setRecordImportDecisions((current) => ({ ...current, [entry.key]: event.target.value }))}><option value="keep-current">Keep current</option><option value="use-imported">Use imported</option></Select></article>)}</section> : null}
        </div> : null}
      </Drawer>

      <Drawer open={Boolean(pendingImport)} onClose={() => setPendingImport(null)} title="Restore this backup?" description={pendingImport ? `${pendingImport.name} will replace the current workspace data. The current version will be kept in recovery history first.` : ""} size="compact" footer={<><Button onClick={() => setPendingImport(null)}>Cancel</Button><Button variant="danger" disabled={Boolean(pendingImport?.removals.length) && importConfirmation !== "RESTORE"} onClick={async () => { if (await actions.importJson(pendingImport.text)) setPendingImport(null); }}>Restore backup</Button></>}>
        {pendingImport ? <><dl className="import-summary"><div><dt>Students</dt><dd>{pendingImport.currentCounts.students} → {pendingImport.counts.students}</dd></div><div><dt>Groups</dt><dd>{pendingImport.currentCounts.groups} → {pendingImport.counts.groups}</dd></div><div><dt>Grades</dt><dd>{pendingImport.currentCounts.grades} → {pendingImport.counts.grades}</dd></div><div><dt>Class records</dt><dd>{pendingImport.currentCounts.classes} → {pendingImport.counts.classes}</dd></div></dl>{pendingImport.removals.length ? <Field label="Type RESTORE to confirm record removal"><Input value={importConfirmation} onChange={(event) => setImportConfirmation(event.target.value)} autoComplete="off" /></Field> : null}</> : null}
      </Drawer>
      <Drawer open={recoveryOpen} onClose={() => setRecoveryOpen(false)} title="Recovery history" description="Recent server snapshots and copies kept on this device. Restoring never deletes the current version; it is archived first." size="normal">
        {recoveryLoading ? <p>Loading recovery history…</p> : recoveryPoints.length ? <div className="recovery-list">{recoveryPoints.map((point) => <article className="recovery-row" key={`${point.source}:${point.id}`}><div><strong>{new Date(point.capturedAt).toLocaleString()}</strong><small>{point.source === "cloud-snapshot" ? "Cloud snapshot" : "This device"}{point.revision !== null && point.revision !== undefined ? ` · revision ${point.revision}` : ""}{point.counts ? ` · ${point.counts.students} students, ${point.counts.classes} classes` : ""}</small></div><div className="button-cluster"><Button icon={Download} onClick={() => actions.exportRecoveryPoint(point)}>Download</Button><Button icon={RotateCcw} onClick={() => setPendingRecovery(point)}>Restore</Button></div></article>)}</div> : <p>No recovery copies are available yet. Hibi creates them automatically as you use the app.</p>}
      </Drawer>
      <ConfirmDialog open={Boolean(pendingRecovery)} title="Restore this recovery copy?" description="Your current workspace will be archived first. This recovery action is revision-checked and can itself be undone from recovery history." confirmLabel="Restore copy" onClose={() => setPendingRecovery(null)} onConfirm={async () => { if (await actions.restoreRecoveryPoint(pendingRecovery)) { setPendingRecovery(null); setRecoveryOpen(false); } }} />
      <ConfirmDialog
        open={Boolean(clearTarget)}
        title="Remove the old local copy?"
        description="This removes only the legacy browser copy on this device. Your signed-in cloud workspace and recovery history remain available."
        confirmLabel="Remove local copy"
        onClose={() => setClearTarget("")}
        onConfirm={async () => {
          const cleared = actions.clearLegacyLocalData();
          if (cleared) setClearTarget("");
        }}
      />
    </div>
  );
}

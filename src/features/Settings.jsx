import { useEffect, useRef, useState } from "react";
import {
  Clock3,
  Download,
  FilePlus2,
  Globe2,
  History,
  KeyRound,
  LockKeyhole,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  Volume2,
} from "lucide-react";
import { Button, ConfirmDialog, Drawer, Field, Input, Select } from "../components/ui";
import { importState, MAX_BACKUP_BYTES } from "../domain";
import { draftChanged, useUnsavedChanges } from "../hooks/useUnsavedChanges";
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

export default function Settings({
  state,
  actions,
  persistenceMode,
  encryption,
  registerNavigationBlocker,
  onDeleteAccount,
  onOpenOnboarding,
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(() => settingsDraft(state.settings));
  const [saving, setSaving] = useState(false);
  const [pendingImport, setPendingImport] = useState(null);
  const [pendingRecordImport, setPendingRecordImport] = useState(null);
  const [recordImportDecisions, setRecordImportDecisions] = useState({});
  const [recordImportBusy, setRecordImportBusy] = useState(false);
  const [importConfirmation, setImportConfirmation] = useState("");
  const [clearTarget, setClearTarget] = useState("");
  const [resetOpen, setResetOpen] = useState(false);
  const [resetConfirmation, setResetConfirmation] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [recoveryPoints, setRecoveryPoints] = useState([]);
  const [pendingRecovery, setPendingRecovery] = useState(null);
  const [soundsEnabled, setSoundsEnabled] = useState(getHibiSoundsEnabled);
  const [securityBusy, setSecurityBusy] = useState(false);
  const [securityError, setSecurityError] = useState("");
  const [recoveryReveal, setRecoveryReveal] = useState("");
  const [rotationOpen, setRotationOpen] = useState(false);
  const [rotationProgress, setRotationProgress] = useState("");
  const [rotationPassword, setRotationPassword] = useState("");
  const [passwordChangeOpen, setPasswordChangeOpen] = useState(false);
  const [currentEncryptionPassword, setCurrentEncryptionPassword] = useState("");
  const [newEncryptionPassword, setNewEncryptionPassword] = useState("");
  const [newEncryptionPasswordConfirmation, setNewEncryptionPasswordConfirmation] = useState("");
  const [backupSourceRecovery, setBackupSourceRecovery] = useState(null);
  const [backupSourceRecoveryKey, setBackupSourceRecoveryKey] = useState("");
  const [backupSourcePassword, setBackupSourcePassword] = useState("");
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
      const saved = await actions.updateSettings(draft);
      if (saved) baselineRef.current = draft;
    } finally {
      setSaving(false);
    }
  };

  const stageFullRestore = (parsed, { name, text, encrypted, sourceRecoveryKey = "", sourcePassword = "" }) => {
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
    setPendingImport({ name, text, counts, currentCounts, removals, encrypted, sourceRecoveryKey, sourcePassword });
    setImportConfirmation("");
  };

  const importFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const encryptedFile = file.name.toLowerCase().endsWith(".hibi");
    if (file.size > (encryptedFile ? MAX_BACKUP_BYTES * 5 : MAX_BACKUP_BYTES)) {
      actions.notify(
        encryptedFile ? "That encrypted backup is larger than 25 MB." : "That backup is larger than 5 MB.",
        "error",
      );
      return;
    }
    try {
      const text = await file.text();
      const outer = JSON.parse(text);
      const isEncrypted = outer?.format === "hibi-encrypted-backup";
      if (isEncrypted && outer.workspaceCryptoId !== encryption?.profile?.workspaceCryptoId) {
        setBackupSourceRecovery({
          name: file.name,
          text,
          passwordAvailable: (outer.wrappers || []).some(
            (wrapper) => wrapper.type === "password" && !wrapper.revokedAt,
          ),
        });
        setBackupSourceRecoveryKey("");
        setBackupSourcePassword("");
        return;
      }
      const parsed = isEncrypted ? await actions.previewEncryptedBackup(text) : importState(text);
      stageFullRestore(parsed, { name: file.name, text, encrypted: isEncrypted });
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
      <div className="page-heading">
        <div>
          <h1>Settings</h1>
          <p>Manage classroom defaults, language, sounds, backup, and privacy.</p>
        </div>
      </div>
      <section className="settings-stack">
        <article className="settings-card">
          <div className="settings-icon yellow">
            <Clock3 size={22} />
          </div>
          <div className="settings-content">
            <h2>Classroom defaults</h2>
            <p>Used when recording classes and calculating alerts and projections.</p>
            <div className="settings-controls settings-controls-expanded">
              <Field label="Default duration">
                <Input
                  type="number"
                  min="0"
                  step="0.25"
                  value={draft.defaultClassHours}
                  onChange={(event) => setDraft({ ...draft, defaultClassHours: Number(event.target.value) })}
                />
                <small>hours</small>
              </Field>
              <Field label="Hourly rate">
                <Input
                  type="number"
                  min="0"
                  step="1"
                  value={draft.hourlyRateMxn}
                  onChange={(event) => setDraft({ ...draft, hourlyRateMxn: Number(event.target.value) })}
                />
                <small>MXN / hour</small>
              </Field>
              <Field label="Projection window">
                <Input
                  type="number"
                  min="1"
                  step="1"
                  value={draft.recentProjectionWeeks}
                  onChange={(event) => setDraft({ ...draft, recentProjectionWeeks: Number(event.target.value) })}
                />
                <small>weeks</small>
              </Field>
              <Field label="Low grade threshold">
                <Input
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  value={Math.round(draft.lowGradeThreshold * 100)}
                  onChange={(event) => setDraft({ ...draft, lowGradeThreshold: Number(event.target.value) / 100 })}
                />
                <small>percent</small>
              </Field>
              <Field label="Low attendance threshold">
                <Input
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  value={Math.round(draft.lowAttendanceThreshold * 100)}
                  onChange={(event) => setDraft({ ...draft, lowAttendanceThreshold: Number(event.target.value) / 100 })}
                />
                <small>percent</small>
              </Field>
              <Button variant="primary" onClick={save} disabled={!dirty || saving}>
                {saving ? "Saving…" : "Save defaults"}
              </Button>
            </div>
          </div>
        </article>
        {onOpenOnboarding ? (
          <article className="settings-card settings-tour-card" data-onboarding-tour="settings">
            <div className="settings-icon lilac">
              <Sparkles size={22} />
            </div>
            <div className="settings-content">
              <h2>Welcome tutorial</h2>
              <p>Revisit Hibi’s main features whenever you want.</p>
              <Button icon={Sparkles} onClick={onOpenOnboarding}>
                Start tour
              </Button>
              <div className="settings-tour-security">
                <LockKeyhole aria-hidden="true" size={18} />
                <span>
                  <strong>End-to-end encryption</strong>
                  <small>Your tutorial progress and classroom data stay protected with E2EE.</small>
                </span>
              </div>
            </div>
          </article>
        ) : null}
        <article className="settings-card">
          <div className="settings-icon blue">
            <Globe2 size={22} />
          </div>
          <div className="settings-content">
            <h2>Interface</h2>
            <p>Choose the interface language and whether Hibi plays gentle feedback sounds.</p>
            <div className="interface-settings">
              <div className="interface-setting">
                <span>
                  <strong>Language</strong>
                  <small>Choose the interface language.</small>
                </span>
                <LanguageToggle className="settings-language" />
              </div>
              <div className="interface-setting">
                <span className="sound-setting-copy">
                  <Volume2 aria-hidden="true" size={18} />
                  <span>
                    <strong>Sound effects</strong>
                    <small>A few gentle cues for saves, attendance, payments, and avatars.</small>
                  </span>
                </span>
                <button
                  className="sound-toggle"
                  type="button"
                  role="switch"
                  aria-checked={soundsEnabled}
                  aria-label={soundsEnabled ? "Turn sound effects off" : "Turn sound effects on"}
                  onClick={toggleSounds}
                >
                  <span aria-hidden="true" />
                  <b>{soundsEnabled ? "On" : "Off"}</b>
                </button>
              </div>
            </div>
          </div>
        </article>
        <article className="settings-card">
          <div className="settings-icon sage">
            <Download size={22} />
          </div>
          <div className="settings-content">
            <h2>Records, backups & recovery</h2>
            <p>
              {persistenceMode === "cloud"
                ? "Add records safely or keep a complete recovery copy of your private cloud workspace."
                : "Add records safely and export a backup regularly."}
            </p>
            <div className="settings-data-actions">
              <div className="settings-data-action safe-import-action">
                <span>
                  <strong>Import records</strong>
                  <small>
                    Add records from another Hibi JSON backup. Existing records and settings are never removed.
                  </small>
                </span>
                <Button
                  variant="primary"
                  icon={FilePlus2}
                  disabled={recordImportBusy}
                  onClick={() => recordsFileRef.current?.click()}
                >
                  {recordImportBusy ? "Reading…" : "Import records"}
                </Button>
              </div>
              <div className="settings-data-action">
                <span>
                  <strong>Backup & recovery</strong>
                  <small>Download everything, or intentionally replace the workspace from a trusted full backup.</small>
                </span>
                <div className="button-cluster">
                  {encryption?.enabled ? (
                    <Button variant="primary" icon={LockKeyhole} onClick={actions.exportEncryptedBackup}>
                      Download encrypted .hibi
                    </Button>
                  ) : null}
                  <Button icon={Download} onClick={actions.exportJson}>
                    {encryption?.enabled ? "Export readable JSON" : "Download backup"}
                  </Button>
                  <Button icon={Upload} onClick={() => fileRef.current?.click()}>
                    Restore full backup
                  </Button>
                  {persistenceMode === "cloud" ? (
                    <Button icon={History} onClick={openRecoveryHistory}>
                      Recovery history
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
            <input
              ref={recordsFileRef}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={previewRecordImport}
            />
            <input
              ref={fileRef}
              type="file"
              accept=".hibi,.json,application/json,application/vnd.hibi.encrypted+json"
              hidden
              onChange={importFile}
            />
            {encryption?.enabled ? (
              <p className="settings-inline-warning">
                <strong>.hibi is recommended.</strong> JSON exports are readable files intended only for advanced local
                use; Hibi never uploads their plaintext during import.
              </p>
            ) : null}
          </div>
        </article>
        {encryption?.enabled ? (
          <article className="settings-card encryption-settings-card">
            <div className="settings-icon sage">
              <KeyRound size={22} />
            </div>
            <div className="settings-content">
              <h2>Workspace encryption & access</h2>
              <p>
                E2EE protocol v{encryption.profile?.protocolVersion}; unlocked with {encryption.method || "a local key"}
                . Your password wraps the same stable master key, so changing it does not re-encrypt your records.
              </p>
              <div className="workspace-key-list" aria-label="Workspace key wrappers">
                {encryption.wrappers
                  .filter((wrapper) => !wrapper.revokedAt)
                  .map((wrapper) => (
                    <div className="workspace-key-row" key={wrapper.wrapperId}>
                      <span>
                        <strong>{wrapper.label}</strong>
                        <small>
                          {wrapper.type === "password" ? "Password-derived key" : "Recovery key"} · added{" "}
                          {new Date(wrapper.createdAt).toLocaleDateString()}
                          {wrapper.lastUsedAt
                            ? ` · last used ${new Date(wrapper.lastUsedAt).toLocaleDateString()}`
                            : " · not used yet"}
                        </small>
                      </span>
                      <Button
                        disabled={
                          securityBusy ||
                          wrapper.type === "password" ||
                          encryption.wrappers.filter((item) => !item.revokedAt).length <= 1
                        }
                        onClick={async () => {
                          setSecurityBusy(true);
                          setSecurityError("");
                          try {
                            await encryption.revokeWrapper(wrapper.wrapperId);
                          } catch (error) {
                            setSecurityError(error?.message || "That workspace key could not be revoked.");
                          } finally {
                            setSecurityBusy(false);
                          }
                        }}
                      >
                        Revoke
                      </Button>
                    </div>
                  ))}
              </div>
              {encryption.rememberedDevices?.length ? (
                <div className="workspace-key-list" aria-label="Remembered devices">
                  {encryption.rememberedDevices.map((device) => (
                    <div className="workspace-key-row" key={device.deviceId}>
                      <span>
                        <strong>This remembered browser</strong>
                        <small>
                          Added {new Date(device.createdAt).toLocaleDateString()} · last used{" "}
                          {new Date(device.lastUsedAt).toLocaleDateString()}
                        </small>
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="button-cluster workspace-key-actions">
                <Button
                  icon={KeyRound}
                  disabled={securityBusy}
                  onClick={() => {
                    setSecurityError("");
                    setCurrentEncryptionPassword("");
                    setNewEncryptionPassword("");
                    setNewEncryptionPasswordConfirmation("");
                    setPasswordChangeOpen(true);
                  }}
                >
                  Change encryption password
                </Button>
                <Button
                  icon={KeyRound}
                  disabled={securityBusy}
                  onClick={async () => {
                    setSecurityBusy(true);
                    setSecurityError("");
                    try {
                      setRecoveryReveal(await encryption.createRecoveryKey());
                    } catch (error) {
                      setSecurityError(error?.message || "A recovery key could not be created.");
                    } finally {
                      setSecurityBusy(false);
                    }
                  }}
                >
                  Create recovery key
                </Button>
                <Button
                  disabled={securityBusy}
                  onClick={async () => {
                    setSecurityBusy(true);
                    setSecurityError("");
                    try {
                      await encryption.rememberDevice();
                      actions.notify("This device will remember the workspace key");
                    } catch (error) {
                      setSecurityError(error?.message || "This device could not be remembered.");
                    } finally {
                      setSecurityBusy(false);
                    }
                  }}
                >
                  Remember this device
                </Button>
                <Button
                  disabled={securityBusy}
                  onClick={async () => {
                    setSecurityBusy(true);
                    setSecurityError("");
                    try {
                      await encryption.forgetDevice();
                      actions.notify("Remembered-device access removed");
                    } catch (error) {
                      setSecurityError(error?.message || "Remembered-device access could not be removed.");
                    } finally {
                      setSecurityBusy(false);
                    }
                  }}
                >
                  Forget this device
                </Button>
                <Button
                  variant="danger"
                  icon={RotateCcw}
                  disabled={securityBusy}
                  onClick={() => {
                    setRotationProgress("");
                    setRotationOpen(true);
                  }}
                >
                  Emergency key rotation
                </Button>
              </div>
              {recoveryReveal ? (
                <div className="recovery-key-reveal" role="status">
                  <strong>Save this recovery key now. Hibi support cannot reconstruct it.</strong>
                  <code>{recoveryReveal}</code>
                  <Button
                    onClick={() =>
                      navigator.clipboard?.writeText(recoveryReveal).then(() => actions.notify("Recovery key copied"))
                    }
                  >
                    Copy key
                  </Button>
                </div>
              ) : null}
              {securityError ? (
                <p className="field-error" role="alert">
                  {securityError}
                </p>
              ) : null}
            </div>
          </article>
        ) : null}
        <article className="settings-card">
          <div className="settings-icon lilac">
            <LockKeyhole size={22} />
          </div>
          <div className="settings-content">
            <h2>Data & privacy</h2>
            <p>
              {encryption?.enabled
                ? "Cloud records and snapshots are end-to-end encrypted. Files you export remain under your control."
                : "Backups include student, parent, grade, attendance, and payment data. Store them privately."}
            </p>
            {persistenceMode === "cloud" ? (
              <div className="privacy-actions">
                <div className="danger-line secondary-danger">
                  <span>
                    <strong>Remove old browser copy</strong>
                    <small>Your signed-in cloud workspace and recovery history are not affected.</small>
                  </span>
                  <Button onClick={() => setClearTarget("local")}>Remove local copy</Button>
                </div>
                <div className="danger-line workspace-reset-line">
                  <span>
                    <strong>Reset workspace</strong>
                    <small>
                      Clears active students, groups, grades, classes, schedules, and payments. Server snapshots and
                      encrypted copies on this device have a 30-day recovery window. Expired device copies are purged
                      the next time Hibi opens on that device. This is not permanent deletion.
                    </small>
                  </span>
                  <Button
                    icon={RotateCcw}
                    onClick={() => {
                      setResetConfirmation("");
                      setResetOpen(true);
                    }}
                  >
                    Reset workspace
                  </Button>
                </div>
                <div className="danger-line permanent-delete-line">
                  <span>
                    <strong>Delete account and data</strong>
                    <small>
                      Permanently erases active records, snapshots, imports, synchronization history, the Auth account,
                      and this account&apos;s copies on the current device. There is no recovery.
                    </small>
                  </span>
                  <Button
                    variant="danger"
                    icon={Trash2}
                    onClick={() => {
                      setDeleteConfirmation("");
                      setDeleteError("");
                      setDeleteOpen(true);
                    }}
                  >
                    Delete account and data
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </article>
      </section>

      <Drawer
        open={Boolean(pendingRecordImport)}
        onClose={() => setPendingRecordImport(null)}
        title="Review record import"
        description={
          pendingRecordImport
            ? `${pendingRecordImport.name} was compared with the records currently saved in Hibi.`
            : ""
        }
        size="normal"
        footer={
          <>
            <Button onClick={() => setPendingRecordImport(null)}>Cancel</Button>
            <Button
              variant="primary"
              icon={ShieldCheck}
              disabled={recordImportBusy || Boolean(pendingRecordImport?.previousImport)}
              onClick={applyRecordImport}
            >
              {recordImportBusy
                ? "Importing…"
                : t(
                    `Import ${pendingRecordImport ? pendingRecordImport.summary.added + Object.values(recordImportDecisions).filter((value) => value === "use-imported").length : 0} records`,
                  )}
            </Button>
          </>
        }
      >
        {pendingRecordImport ? (
          <div className="record-import-review">
            <div className="import-safety-note">
              <ShieldCheck size={22} aria-hidden="true" />
              <span>
                <strong>No existing records will be deleted.</strong>
                <small>
                  Conflicts keep the current Hibi version unless you explicitly choose the imported version.
                </small>
              </span>
            </div>
            {pendingRecordImport.previousImport ? (
              <div className="import-repeat-warning">
                <strong>This exact file was already imported.</strong>
                <span>
                  Imported {new Date(pendingRecordImport.previousImport.createdAt).toLocaleString()}. Reusing it is
                  blocked to prevent duplicate work.
                </span>
              </div>
            ) : null}
            <dl className="record-import-summary">
              <div>
                <dt>New</dt>
                <dd>{pendingRecordImport.summary.added}</dd>
              </div>
              <div>
                <dt>Exact duplicates</dt>
                <dd>{pendingRecordImport.summary.duplicates}</dd>
              </div>
              <div>
                <dt>Needs review</dt>
                <dd>{pendingRecordImport.summary.conflicts}</dd>
              </div>
              <div>
                <dt>Will be deleted</dt>
                <dd>0</dd>
              </div>
            </dl>
            <div className="record-import-collections">
              {Object.entries(pendingRecordImport.summary.byCollection)
                .filter(([, counts]) => counts.added || counts.duplicates || counts.conflicts)
                .map(([collection, counts]) => (
                  <div key={collection}>
                    <strong>
                      {pendingRecordImport.entries.find((entry) => entry.collection === collection)?.collectionLabel ||
                        collection}
                    </strong>
                    <span>
                      {t(`${counts.added} new · ${counts.duplicates} duplicates · ${counts.conflicts} review`)}
                    </span>
                  </div>
                ))}
            </div>
            {pendingRecordImport.summary.conflicts ? (
              <section className="record-import-conflicts">
                <div>
                  <h3>Resolve possible duplicates</h3>
                  <p>“Keep current” is the safest default.</p>
                </div>
                {pendingRecordImport.entries
                  .filter((entry) => entry.status === "conflict")
                  .map((entry) => (
                    <article key={entry.key}>
                      <span>
                        <strong>{entry.label}</strong>
                        <small>
                          {entry.collectionLabel} · {entry.reason}
                        </small>
                      </span>
                      <Select
                        aria-label={`Import choice for ${entry.label}`}
                        value={recordImportDecisions[entry.key] || "keep-current"}
                        onChange={(event) =>
                          setRecordImportDecisions((current) => ({ ...current, [entry.key]: event.target.value }))
                        }
                      >
                        <option value="keep-current">Keep current</option>
                        <option value="use-imported">Use imported</option>
                      </Select>
                    </article>
                  ))}
              </section>
            ) : null}
          </div>
        ) : null}
      </Drawer>

      <Drawer
        open={Boolean(pendingImport)}
        onClose={() => setPendingImport(null)}
        title="Restore this backup?"
        description={
          pendingImport
            ? `${pendingImport.name} will replace the current workspace data. The current version will be kept in recovery history first.`
            : ""
        }
        size="compact"
        footer={
          <>
            <Button onClick={() => setPendingImport(null)}>Cancel</Button>
            <Button
              variant="danger"
              disabled={Boolean(pendingImport?.removals.length) && importConfirmation !== "RESTORE"}
              onClick={async () => {
                const restored = pendingImport.sourcePassword
                  ? await actions.importEncryptedBackupWithPassword(pendingImport.text, pendingImport.sourcePassword)
                  : pendingImport.encrypted
                    ? await actions.importEncryptedBackup(pendingImport.text, pendingImport.sourceRecoveryKey)
                    : await actions.importJson(pendingImport.text);
                if (restored) setPendingImport(null);
              }}
            >
              Restore backup
            </Button>
          </>
        }
      >
        {pendingImport ? (
          <>
            <dl className="import-summary">
              <div>
                <dt>Students</dt>
                <dd>
                  {pendingImport.currentCounts.students} → {pendingImport.counts.students}
                </dd>
              </div>
              <div>
                <dt>Groups</dt>
                <dd>
                  {pendingImport.currentCounts.groups} → {pendingImport.counts.groups}
                </dd>
              </div>
              <div>
                <dt>Grades</dt>
                <dd>
                  {pendingImport.currentCounts.grades} → {pendingImport.counts.grades}
                </dd>
              </div>
              <div>
                <dt>Class records</dt>
                <dd>
                  {pendingImport.currentCounts.classes} → {pendingImport.counts.classes}
                </dd>
              </div>
            </dl>
            {pendingImport.removals.length ? (
              <Field label="Type RESTORE to confirm record removal">
                <Input
                  value={importConfirmation}
                  onChange={(event) => setImportConfirmation(event.target.value)}
                  autoComplete="off"
                />
              </Field>
            ) : null}
          </>
        ) : null}
      </Drawer>
      <Drawer
        open={Boolean(backupSourceRecovery)}
        onClose={() => {
          if (!recordImportBusy) {
            setBackupSourceRecovery(null);
            setBackupSourceRecoveryKey("");
          }
        }}
        title="Unlock the source backup"
        description="This .hibi file belongs to another workspace. Its recovery key will be used only in this browser to decrypt and validate the source, then Hibi will re-encrypt every record for the current account."
        size="compact"
        footer={
          <>
            <Button
              disabled={recordImportBusy}
              onClick={() => {
                setBackupSourceRecovery(null);
                setBackupSourceRecoveryKey("");
                setBackupSourcePassword("");
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              icon={KeyRound}
              disabled={recordImportBusy || !backupSourceRecoveryKey.trim()}
              onClick={async () => {
                setRecordImportBusy(true);
                try {
                  const parsed = await actions.previewEncryptedBackup(
                    backupSourceRecovery.text,
                    backupSourceRecoveryKey,
                  );
                  stageFullRestore(parsed, {
                    name: backupSourceRecovery.name,
                    text: backupSourceRecovery.text,
                    encrypted: true,
                    sourceRecoveryKey: backupSourceRecoveryKey,
                  });
                  setBackupSourceRecovery(null);
                  setBackupSourceRecoveryKey("");
                } catch (error) {
                  actions.notify(error?.message || "That recovery key could not unlock the backup.", "error");
                } finally {
                  setRecordImportBusy(false);
                }
              }}
            >
              {recordImportBusy ? "Unlocking…" : "Unlock and review"}
            </Button>
          </>
        }
      >
        <Field label="Source workspace recovery key">
          <Input
            value={backupSourceRecoveryKey}
            onChange={(event) => setBackupSourceRecoveryKey(event.target.value)}
            placeholder="HIBI1-…"
            autoComplete="off"
            spellCheck="false"
          />
        </Field>
        {backupSourceRecovery?.passwordAvailable ? (
          <div className="backup-password-unlock">
            <span>or</span>
            <Field label="Source workspace encryption password">
              <Input
                type="password"
                value={backupSourcePassword}
                onChange={(event) => setBackupSourcePassword(event.target.value)}
                autoComplete="off"
                spellCheck="false"
              />
            </Field>
            <Button
              variant="primary"
              icon={KeyRound}
              disabled={recordImportBusy || !backupSourcePassword}
              onClick={async () => {
                setRecordImportBusy(true);
                try {
                  const parsed = await actions.previewEncryptedBackupWithPassword(
                    backupSourceRecovery.text,
                    backupSourcePassword,
                  );
                  stageFullRestore(parsed, {
                    name: backupSourceRecovery.name,
                    text: backupSourceRecovery.text,
                    encrypted: true,
                    sourcePassword: backupSourcePassword,
                  });
                  setBackupSourceRecovery(null);
                  setBackupSourceRecoveryKey("");
                  setBackupSourcePassword("");
                } catch (error) {
                  actions.notify(error?.message || "The source password could not unlock this backup.", "error");
                } finally {
                  setRecordImportBusy(false);
                }
              }}
            >
              Unlock source with password
            </Button>
          </div>
        ) : null}
      </Drawer>
      <Drawer
        open={recoveryOpen}
        onClose={() => setRecoveryOpen(false)}
        title="Recovery history"
        description="Recent server snapshots and encrypted copies kept independently on this device. Opening this history also verifies that device copies can be decrypted. Restoring never deletes the current version; it is archived first."
        size="normal"
      >
        {recoveryLoading ? (
          <p>Loading recovery history…</p>
        ) : recoveryPoints.length ? (
          <div className="recovery-list">
            {recoveryPoints.map((point) => (
              <article className="recovery-row" key={`${point.source}:${point.id}`}>
                <div>
                  <strong>{new Date(point.capturedAt).toLocaleString()}</strong>
                  <small>
                    {point.source === "cloud-snapshot" ? "Cloud snapshot" : "Encrypted device copy"}
                    {point.revision !== null && point.revision !== undefined ? ` · revision ${point.revision}` : ""}
                    {point.counts ? ` · ${point.counts.students} students, ${point.counts.classes} classes` : ""}
                  </small>
                </div>
                <div className="button-cluster">
                  <Button icon={Download} onClick={() => actions.exportRecoveryPoint(point)}>
                    Download
                  </Button>
                  <Button icon={RotateCcw} onClick={() => setPendingRecovery(point)}>
                    Restore
                  </Button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p>No recovery copies are available yet. Hibi creates them automatically as you use the app.</p>
        )}
      </Drawer>
      <Drawer
        open={passwordChangeOpen}
        onClose={() => {
          if (!securityBusy) setPasswordChangeOpen(false);
        }}
        title="Change encryption password"
        description="This replaces only the password wrapper around your account master key. Your encrypted records do not need to be re-encrypted."
        size="compact"
        footer={
          <>
            <Button onClick={() => setPasswordChangeOpen(false)} disabled={securityBusy}>
              Cancel
            </Button>
            <Button
              variant="primary"
              icon={KeyRound}
              disabled={
                securityBusy ||
                !currentEncryptionPassword ||
                !newEncryptionPassword ||
                !newEncryptionPasswordConfirmation
              }
              onClick={async () => {
                if (newEncryptionPassword !== newEncryptionPasswordConfirmation) {
                  setSecurityError("The new password confirmation does not match.");
                  return;
                }
                setSecurityBusy(true);
                setSecurityError("");
                try {
                  await encryption.changePassword(currentEncryptionPassword, newEncryptionPassword);
                  setPasswordChangeOpen(false);
                  setCurrentEncryptionPassword("");
                  setNewEncryptionPassword("");
                  setNewEncryptionPasswordConfirmation("");
                  actions.notify("Encryption password changed");
                } catch (error) {
                  setSecurityError(error?.message || "The encryption password could not be changed.");
                } finally {
                  setSecurityBusy(false);
                }
              }}
            >
              Save new password
            </Button>
          </>
        }
      >
        <div className="settings-controls settings-controls-expanded">
          <Field label="Current encryption password">
            <Input
              type="password"
              value={currentEncryptionPassword}
              onChange={(event) => setCurrentEncryptionPassword(event.target.value)}
              autoComplete="current-password"
            />
          </Field>
          <Field label="New encryption password">
            <Input
              type="password"
              value={newEncryptionPassword}
              onChange={(event) => setNewEncryptionPassword(event.target.value)}
              autoComplete="new-password"
            />
          </Field>
          <Field label="Confirm new encryption password">
            <Input
              type="password"
              value={newEncryptionPasswordConfirmation}
              onChange={(event) => setNewEncryptionPasswordConfirmation(event.target.value)}
              autoComplete="new-password"
            />
          </Field>
          {securityError ? <p className="settings-inline-warning">{securityError}</p> : null}
        </div>
      </Drawer>
      <ConfirmDialog
        open={rotationOpen}
        title="Rotate the account master key?"
        description="Hibi will verify your encryption password, generate a new master key, and re-encrypt active records, snapshots, device cache, and the password wrapper. Existing recovery keys will be revoked; create a new one afterward. A lost device cannot decrypt future revisions."
        confirmLabel={rotationProgress || "Rotate master key"}
        busy={securityBusy}
        confirmDisabled={!rotationPassword}
        onClose={() => {
          if (!securityBusy) {
            setRotationOpen(false);
            setRotationPassword("");
          }
        }}
        onConfirm={async () => {
          setSecurityBusy(true);
          setSecurityError("");
          try {
            await encryption.rotateKey(rotationPassword, setRotationProgress);
            setRotationOpen(false);
            setRotationPassword("");
            setRecoveryReveal("");
            actions.notify("Workspace master key rotated");
          } catch (error) {
            setSecurityError(error?.message || "The workspace key could not be rotated.");
          } finally {
            setRotationProgress("");
            setSecurityBusy(false);
          }
        }}
      >
        <Field label="Encryption password">
          <Input
            type="password"
            value={rotationPassword}
            onChange={(event) => setRotationPassword(event.target.value)}
            autoComplete="current-password"
            disabled={securityBusy}
          />
        </Field>
      </ConfirmDialog>
      <ConfirmDialog
        open={Boolean(pendingRecovery)}
        title="Restore this recovery copy?"
        description="Your current workspace will be archived first. This recovery action is revision-checked and can itself be undone from recovery history."
        confirmLabel="Restore copy"
        onClose={() => setPendingRecovery(null)}
        onConfirm={async () => {
          if (await actions.restoreRecoveryPoint(pendingRecovery)) {
            setPendingRecovery(null);
            setRecoveryOpen(false);
          }
        }}
      />
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
      <Drawer
        open={resetOpen}
        onClose={() => {
          if (!resetBusy) setResetOpen(false);
        }}
        title="Reset this workspace?"
        description="Active records will be emptied immediately. The recovery window is 30 days, so this is not permanent deletion."
        size="compact"
        footer={
          <>
            <Button onClick={() => setResetOpen(false)} disabled={resetBusy}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={resetBusy || resetConfirmation !== "RESET"}
              onClick={async () => {
                setResetBusy(true);
                try {
                  if (await actions.resetWorkspace()) setResetOpen(false);
                } finally {
                  setResetBusy(false);
                }
              }}
            >
              {resetBusy ? "Resetting…" : "Reset workspace"}
            </Button>
          </>
        }
      >
        <Field label="Type RESET to confirm" hint="Your settings stay in place; active class data is emptied.">
          <Input
            value={resetConfirmation}
            onChange={(event) => setResetConfirmation(event.target.value)}
            autoComplete="off"
            spellCheck="false"
          />
        </Field>
      </Drawer>
      <Drawer
        open={deleteOpen}
        onClose={() => {
          if (!deleteBusy) setDeleteOpen(false);
        }}
        title="Permanently delete account and data?"
        description="This verified deletion has no recovery. Sign in again first if your last authentication was more than 10 minutes ago."
        size="compact"
        footer={
          <>
            <Button onClick={() => setDeleteOpen(false)} disabled={deleteBusy}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={deleteBusy || deleteConfirmation !== "DELETE MY ACCOUNT"}
              onClick={async () => {
                setDeleteBusy(true);
                setDeleteError("");
                try {
                  await onDeleteAccount?.({ confirmation: deleteConfirmation });
                } catch (error) {
                  setDeleteError(error?.message || "Account deletion could not be completed.");
                  setDeleteBusy(false);
                }
              }}
            >
              {deleteBusy ? "Deleting…" : "Delete permanently"}
            </Button>
          </>
        }
      >
        <div className="permanent-delete-confirmation">
          <p>
            Hibi will purge cloud records and recovery history first, then hard-delete the Auth user and this
            account&apos;s encrypted data on this device.
          </p>
          <Field label="Type DELETE MY ACCOUNT to confirm" error={deleteError}>
            <Input
              value={deleteConfirmation}
              onChange={(event) => setDeleteConfirmation(event.target.value)}
              autoComplete="off"
              spellCheck="false"
            />
          </Field>
        </div>
      </Drawer>
    </div>
  );
}

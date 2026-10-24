import { useEffect, useMemo, useRef, useState } from "react";
import {
  Clock3,
  Download,
  FilePlus2,
  Globe2,
  HardDrive,
  History,
  KeyRound,
  LockKeyhole,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Trash2,
  TriangleAlert,
  Upload,
  UsersRound,
} from "lucide-react";
import {
  BottomSheet,
  Button,
  ConfirmDialog,
  Drawer,
  Field,
  Input,
  ListRow,
  SectionHeading,
  Segmented,
  Select,
  Switch,
} from "../components/ui";
import { StudentAvatar } from "../components/StudentAvatar";
import { useCompactViewport } from "../components/OverlayContext";
import { todayDateOnly } from "../domain/dates";
import {
  formatHours,
  formatMoney,
  formatPercent,
  formatScore,
  formatShortDate,
  monthLong,
} from "../utils/displayFormat";
import {
  encryptionAccess,
  formatKeyDate,
  hasLegacyBrowserCopy,
  ownRateSentences,
  revokeBlockedReason,
  settingsEffects,
  unlockMethodCopy,
} from "./settingsModel";
import "../i18n/screenTranslations.js";
import "./settings.css";
import { importState, MAX_BACKUP_BYTES } from "../domain";
import { draftChanged, useUnsavedChanges } from "../hooks/useUnsavedChanges";
import { LanguageToggle, useI18n } from "../i18n";
import { NEW_PASSWORD_GUIDANCE, getNewPasswordWarning } from "../crypto/passwords.js";
import { getHibiSoundsEnabled, playHibiSound, setHibiSoundsEnabled } from "../utils/hibiSounds";
import { setupResumeStep } from "../onboarding/onboardingModel";
import { useAppearance } from "../theme/appearance";

// «Apariencia» is a per-device preference (localStorage), not part of the synced settings.
const APPEARANCE_ITEMS = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];
const APPEARANCE_SUMMARY = { system: "System theme", light: "Light theme", dark: "Dark theme" };

function settingsDraft(settings) {
  return { ...settings, hourlyRateMxn: settings.hourlyRate };
}

// Mobile rows open a sheet with −/+ for one class value at a time.
const MOBILE_FIELDS = {
  defaultClassHours: {
    group: "Classes",
    title: "Default duration",
    hint: "New classes start with this length; each class can still change it.",
    unit: "per class",
    min: 0.25,
    max: 12,
    step: 0.25,
    format: (value, locale) => formatHours(value, locale),
  },
  hourlyRateMxn: {
    group: "Classes",
    title: "Hourly rate",
    hint: "The general one. Groups with their own rate do not change.",
    unit: "MXN per hour",
    min: 0,
    max: 100000,
    step: 10,
    format: (value, locale) => formatMoney(value, locale),
  },
  recentProjectionWeeks: {
    group: "Classes",
    title: "Projection window",
    hint: "Weeks of collections used to project the month.",
    unit: "weeks",
    min: 1,
    max: 52,
    step: 1,
    format: (value) => String(value),
  },
  lowGradeThreshold: {
    group: "Alerts",
    title: "Low grade",
    hint: "Grades below this value are flagged.",
    unit: "out of 10",
    min: 0,
    max: 1,
    step: 0.05,
    format: (value, locale) => formatScore(value * 10, locale),
  },
  lowAttendanceThreshold: {
    group: "Alerts",
    title: "Low attendance",
    hint: "Students below this attendance are flagged.",
    unit: "attendance",
    min: 0,
    max: 1,
    step: 0.05,
    format: (value) => `${Math.round(value * 100)}%`,
  },
};

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
  derived = undefined,
  account = undefined,
  intent = undefined,
  clearIntent = undefined,
}) {
  const { t: uiT, locale, language } = useI18n();
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
  const { preference: appearance, setPreference: setAppearance } = useAppearance();
  const cloudSecurityReadOnly = encryption?.writesEnabled === false;
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
  const newPasswordWarning = passwordChangeOpen ? getNewPasswordWarning(newEncryptionPassword) : "";
  const [backupSourceRecovery, setBackupSourceRecovery] = useState(null);
  const [backupSourceRecoveryKey, setBackupSourceRecoveryKey] = useState("");
  const [backupSourcePassword, setBackupSourcePassword] = useState("");
  const [legacyCopy, setLegacyCopy] = useState(() => persistenceMode === "cloud" && hasLegacyBrowserCopy());
  const { active: activeKeys, hasRecoveryKey } = encryptionAccess(encryption);
  const recoveryKeyMissing = Boolean(encryption?.enabled) && !hasRecoveryKey;
  const deviceRemembered = Boolean(encryption?.rememberedDevices?.length);
  const createRecoveryRef = useRef(null);
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
      return saved;
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
      const requestBackupUnlock = () => {
        setBackupSourceRecovery({
          name: file.name,
          text,
          passwordAvailable: (outer.wrappers || []).some(
            (wrapper) => wrapper.type === "password" && !wrapper.revokedAt,
          ),
        });
        setBackupSourceRecoveryKey("");
        setBackupSourcePassword("");
      };
      let parsed;
      if (isEncrypted) {
        try {
          parsed = await actions.previewEncryptedBackup(text);
        } catch (error) {
          if (
            error?.code === "backup_recovery_required" ||
            error?.code === "backup_authentication_failed" ||
            error?.code === "manifest_authentication_failed" ||
            error?.name === "OperationError"
          ) {
            requestBackupUnlock();
            return;
          }
          throw error;
        }
      } else parsed = importState(text);
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

  const compact = useCompactViewport();
  const asOf = state.settings.asOfDate || todayDateOnly();
  const effects = useMemo(() => settingsEffects(state, derived, draft, asOf), [asOf, derived, draft, state]);
  const ownRatesText = ownRateSentences(effects, locale)
    .map((sentence) => uiT(sentence.key, sentence.values))
    .join(" ");
  const resumeStep = setupResumeStep(state.settings);
  const [section, setSection] = useState("classes");
  const [mobileSheet, setMobileSheet] = useState("");
  const sheetField = MOBILE_FIELDS[mobileSheet];
  const sheetValue = sheetField ? Number(draft[mobileSheet]) || 0 : 0;
  const openSheet = (id) => {
    setDraft(baselineRef.current);
    setMobileSheet(id);
  };
  const stepSheet = (direction) => {
    const next = Math.min(sheetField.max, Math.max(sheetField.min, sheetValue + direction * sheetField.step));
    setDraft({ ...draft, [mobileSheet]: Number(next.toFixed(2)) });
  };
  const saveSheet = async () => {
    if (await save()) setMobileSheet("");
  };
  // «Create a recovery key» on Inicio lands here, on the encryption controls, with that action focused.
  useEffect(() => {
    if (intent?.type !== "create-recovery-key") return undefined;
    if (compact) setMobileSheet("privacy");
    else setSection("privacy");
    const timer = globalThis.setTimeout(() => {
      const target = createRecoveryRef.current?.querySelector("button");
      target?.scrollIntoView?.({ block: "center" });
      target?.focus({ preventScroll: true });
      clearIntent?.();
    }, 120);
    return () => globalThis.clearTimeout(timer);
  }, [clearIntent, compact, intent]);

  const dialogs = (
    <>
      <Drawer
        open={Boolean(pendingRecordImport)}
        onClose={() => setPendingRecordImport(null)}
        title={uiT("Review record import")}
        description={
          pendingRecordImport
            ? uiT("{p0} was compared with the records currently saved in Hibi.", { p0: pendingRecordImport.name })
            : ""
        }
        size="normal"
        footer={
          <>
            <Button onClick={() => setPendingRecordImport(null)}>{uiT("Cancel")}</Button>
            <Button
              variant="primary"
              icon={ShieldCheck}
              disabled={recordImportBusy || Boolean(pendingRecordImport?.previousImport)}
              onClick={applyRecordImport}
            >
              {recordImportBusy
                ? uiT("Importing…")
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
                <strong>{uiT("No existing records will be deleted.")}</strong>
                <small>
                  {uiT("Conflicts keep the current Hibi version unless you explicitly choose the imported version.")}
                </small>
              </span>
            </div>
            {pendingRecordImport.previousImport ? (
              <div className="import-repeat-warning">
                <strong>{uiT("This exact file was already imported.")}</strong>
                <span>
                  {uiT("Imported ")}
                  {new Date(pendingRecordImport.previousImport.createdAt).toLocaleString(locale)}
                  {uiT(". Reusing it is blocked to prevent duplicate work.")}
                </span>
              </div>
            ) : null}
            <dl className="record-import-summary">
              <div>
                <dt>{uiT("New")}</dt>
                <dd>{pendingRecordImport.summary.added}</dd>
              </div>
              <div>
                <dt>{uiT("Exact duplicates")}</dt>
                <dd>{pendingRecordImport.summary.duplicates}</dd>
              </div>
              <div>
                <dt>{uiT("Needs review")}</dt>
                <dd>{pendingRecordImport.summary.conflicts}</dd>
              </div>
              <div>
                <dt>{uiT("Will be deleted")}</dt>
                <dd>0</dd>
              </div>
            </dl>
            <div className="record-import-collections">
              {Object.entries(pendingRecordImport.summary.byCollection)
                .filter(([, counts]) => counts.added || counts.duplicates || counts.conflicts)
                .map(([collection, counts]) => (
                  <div key={collection}>
                    <strong>
                      {uiT(
                        pendingRecordImport.entries.find((entry) => entry.collection === collection)?.collectionLabel ||
                          collection,
                      )}
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
                  <h3>{uiT("Resolve possible duplicates")}</h3>
                  <p>{uiT("“Keep current” is the safest default.")}</p>
                </div>
                {pendingRecordImport.entries
                  .filter((entry) => entry.status === "conflict")
                  .map((entry) => (
                    <article key={entry.key}>
                      <span>
                        <strong>{entry.label}</strong>
                        <small>
                          {uiT(entry.collectionLabel)} · {uiT(entry.reason)}
                        </small>
                      </span>
                      <Select
                        aria-label={uiT("Import choice for {p0}", { p0: entry.label })}
                        value={recordImportDecisions[entry.key] || "keep-current"}
                        onChange={(event) =>
                          setRecordImportDecisions((current) => ({ ...current, [entry.key]: event.target.value }))
                        }
                      >
                        <option value="keep-current">{uiT("Keep current")}</option>
                        <option value="use-imported">{uiT("Use imported")}</option>
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
        title={uiT("Restore this backup?")}
        description={
          pendingImport
            ? uiT(
                "{p0} will replace the current workspace data. The current version will be kept in recovery history first.",
                { p0: pendingImport.name },
              )
            : ""
        }
        size="compact"
        footer={
          <>
            <Button onClick={() => setPendingImport(null)}>{uiT("Cancel")}</Button>
            <Button
              variant="danger"
              disabled={Boolean(pendingImport?.removals.length) && importConfirmation !== uiT("RESTORE")}
              onClick={async () => {
                const restored = pendingImport.sourcePassword
                  ? await actions.importEncryptedBackupWithPassword(pendingImport.text, pendingImport.sourcePassword)
                  : pendingImport.encrypted
                    ? await actions.importEncryptedBackup(pendingImport.text, pendingImport.sourceRecoveryKey)
                    : await actions.importJson(pendingImport.text);
                if (restored) setPendingImport(null);
              }}
            >
              {uiT("Restore backup")}
            </Button>
          </>
        }
      >
        {pendingImport ? (
          <>
            <dl className="import-summary">
              <div>
                <dt>{uiT("Students")}</dt>
                <dd>
                  {pendingImport.currentCounts.students} → {pendingImport.counts.students}
                </dd>
              </div>
              <div>
                <dt>{uiT("Groups")}</dt>
                <dd>
                  {pendingImport.currentCounts.groups} → {pendingImport.counts.groups}
                </dd>
              </div>
              <div>
                <dt>{uiT("Grades")}</dt>
                <dd>
                  {pendingImport.currentCounts.grades} → {pendingImport.counts.grades}
                </dd>
              </div>
              <div>
                <dt>{uiT("Class records")}</dt>
                <dd>
                  {pendingImport.currentCounts.classes} → {pendingImport.counts.classes}
                </dd>
              </div>
            </dl>
            {pendingImport.removals.length ? (
              <Field label={uiT("Type RESTORE to confirm record removal")}>
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
            setBackupSourcePassword("");
          }
        }}
        title={uiT("Unlock the source backup")}
        description={uiT(
          "This backup needs its original encryption password or recovery key. Hibi will unlock and validate it in this browser, then re-encrypt the records for the current account.",
        )}
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
              {uiT("Cancel")}
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
                  setBackupSourcePassword("");
                } catch (error) {
                  actions.notify(error?.message || "That recovery key could not unlock the backup.", "error");
                } finally {
                  setRecordImportBusy(false);
                }
              }}
            >
              {recordImportBusy ? uiT("Unlocking…") : uiT("Unlock and review")}
            </Button>
          </>
        }
      >
        <Field label={uiT("Source workspace recovery key")}>
          <Input
            value={backupSourceRecoveryKey}
            onChange={(event) => setBackupSourceRecoveryKey(event.target.value)}
            placeholder={uiT("HIBI1-…")}
            autoComplete="off"
            spellCheck="false"
          />
        </Field>
        {backupSourceRecovery?.passwordAvailable ? (
          <div className="backup-password-unlock">
            <span>{uiT("or")}</span>
            <Field label={uiT("Source workspace encryption password")}>
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
              {uiT("Unlock source with password")}
            </Button>
          </div>
        ) : null}
      </Drawer>
      <Drawer
        open={recoveryOpen}
        onClose={() => setRecoveryOpen(false)}
        title={uiT("Recovery history")}
        description={uiT(
          "Recent server snapshots and encrypted copies kept independently on this device. Opening this history also verifies that device copies can be decrypted. Restoring never deletes the current version; it is archived first.",
        )}
        size="normal"
      >
        {recoveryLoading ? (
          <p>{uiT("Loading recovery history…")}</p>
        ) : recoveryPoints.length ? (
          <div className="recovery-list">
            {recoveryPoints.map((point) => (
              <article className="recovery-row" key={`${point.source}:${point.id}`}>
                <div>
                  <strong>{new Date(point.capturedAt).toLocaleString(locale)}</strong>
                  <small>
                    {point.source === "cloud-snapshot" ? uiT("Cloud snapshot") : uiT("Encrypted device copy")}
                    {point.revision !== null && point.revision !== undefined
                      ? uiT(" · revision {p0}", { p0: point.revision })
                      : ""}
                    {point.counts
                      ? uiT(" · {p0} students, {p1} classes", { p0: point.counts.students, p1: point.counts.classes })
                      : ""}
                  </small>
                </div>
                <div className="button-cluster">
                  <Button icon={Download} onClick={() => actions.exportRecoveryPoint(point)}>
                    {uiT("Download")}
                  </Button>
                  <Button icon={RotateCcw} onClick={() => setPendingRecovery(point)}>
                    {uiT("Restore")}
                  </Button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p>{uiT("No recovery copies are available yet. Hibi creates them automatically as you use the app.")}</p>
        )}
      </Drawer>
      <Drawer
        open={passwordChangeOpen}
        onClose={() => {
          if (!securityBusy) setPasswordChangeOpen(false);
        }}
        title={uiT("Change encryption password")}
        description={uiT(
          "This replaces only the password wrapper around your account master key. Your encrypted records do not need to be re-encrypted.",
        )}
        size="compact"
        footer={
          <>
            <Button onClick={() => setPasswordChangeOpen(false)} disabled={securityBusy || cloudSecurityReadOnly}>
              {uiT("Cancel")}
            </Button>
            <Button
              variant="primary"
              icon={KeyRound}
              disabled={
                securityBusy ||
                !currentEncryptionPassword ||
                Boolean(newPasswordWarning) ||
                cloudSecurityReadOnly ||
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
              {uiT("Save new password")}
            </Button>
          </>
        }
      >
        <div className="settings-controls settings-controls-expanded">
          <Field label={uiT("Current encryption password")}>
            <Input
              type="password"
              value={currentEncryptionPassword}
              onChange={(event) => setCurrentEncryptionPassword(event.target.value)}
              autoComplete="current-password"
            />
          </Field>
          <Field label={uiT("New encryption password")}>
            <Input
              type="password"
              value={newEncryptionPassword}
              onChange={(event) => setNewEncryptionPassword(event.target.value)}
              autoComplete="new-password"
            />
          </Field>
          <p>{uiT(NEW_PASSWORD_GUIDANCE)}</p>
          {newPasswordWarning ? <p role="status">{uiT(newPasswordWarning)}</p> : null}
          <Field label={uiT("Confirm new encryption password")}>
            <Input
              type="password"
              value={newEncryptionPasswordConfirmation}
              onChange={(event) => setNewEncryptionPasswordConfirmation(event.target.value)}
              autoComplete="new-password"
            />
          </Field>
          {securityError ? <p className="settings-inline-warning">{uiT(securityError)}</p> : null}
        </div>
      </Drawer>
      <ConfirmDialog
        open={rotationOpen}
        title={uiT("Rotate the account master key?")}
        description={uiT(
          "Hibi will verify your encryption password, generate a new master key, and re-encrypt active records, snapshots, device cache, and the password wrapper. Existing recovery keys will be revoked; create a new one afterward. A lost device cannot decrypt future revisions.",
        )}
        confirmLabel={rotationProgress || uiT("Rotate master key")}
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
        <Field label={uiT("Encryption password")}>
          <Input
            type="password"
            value={rotationPassword}
            onChange={(event) => setRotationPassword(event.target.value)}
            autoComplete="current-password"
            disabled={securityBusy || cloudSecurityReadOnly}
          />
        </Field>
      </ConfirmDialog>
      <ConfirmDialog
        open={Boolean(pendingRecovery)}
        title={uiT("Restore this recovery copy?")}
        description={uiT(
          "Your current workspace will be archived first. This recovery action is revision-checked and can itself be undone from recovery history.",
        )}
        confirmLabel={uiT("Restore copy")}
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
        title={uiT("Delete the readable copy?")}
        description={uiT(
          "This deletes only the unencrypted copy from before your account on this browser. Your cloud workspace and recovery history stay available.",
        )}
        confirmLabel={uiT("Delete readable copy")}
        onClose={() => setClearTarget("")}
        onConfirm={async () => {
          const cleared = actions.clearLegacyLocalData();
          if (cleared) {
            setClearTarget("");
            setLegacyCopy(false);
          }
        }}
      />
      <Drawer
        open={resetOpen}
        onClose={() => {
          if (!resetBusy) setResetOpen(false);
        }}
        title={uiT("Reset this workspace?")}
        description={uiT(
          "Active records will be emptied immediately. The recovery window is 30 days, so this is not permanent deletion.",
        )}
        size="compact"
        footer={
          <>
            <Button onClick={() => setResetOpen(false)} disabled={resetBusy}>
              {uiT("Cancel")}
            </Button>
            <Button
              variant="danger"
              disabled={resetBusy || resetConfirmation !== uiT("RESET")}
              onClick={async () => {
                setResetBusy(true);
                try {
                  if (await actions.resetWorkspace()) setResetOpen(false);
                } finally {
                  setResetBusy(false);
                }
              }}
            >
              {resetBusy ? uiT("Resetting…") : uiT("Reset workspace")}
            </Button>
          </>
        }
      >
        <Field
          label={uiT("Type RESET to confirm")}
          hint={uiT("Your settings stay in place; active class data is emptied.")}
        >
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
        title={uiT("Permanently delete account and data?")}
        description={uiT(
          "This verified deletion has no recovery. Sign in again first if your last authentication was more than 10 minutes ago.",
        )}
        size="compact"
        footer={
          <>
            <Button onClick={() => setDeleteOpen(false)} disabled={deleteBusy}>
              {uiT("Cancel")}
            </Button>
            <Button
              variant="danger"
              disabled={deleteBusy || deleteConfirmation !== uiT("DELETE MY ACCOUNT")}
              onClick={async () => {
                if (deleteConfirmation !== uiT("DELETE MY ACCOUNT")) return;
                setDeleteBusy(true);
                setDeleteError("");
                try {
                  await onDeleteAccount?.({ confirmation: "DELETE MY ACCOUNT" });
                } catch (error) {
                  setDeleteError(error?.message || "Account deletion could not be completed.");
                  setDeleteBusy(false);
                }
              }}
            >
              {deleteBusy ? uiT("Deleting…") : uiT("Delete permanently")}
            </Button>
          </>
        }
      >
        <div className="permanent-delete-confirmation">
          <p>
            {uiT(
              "Hibi will purge cloud records and recovery history first, then hard-delete the Auth user and this account’s encrypted data on this device.",
            )}
          </p>
          <Field label={uiT("Type DELETE MY ACCOUNT to confirm")} error={deleteError}>
            <Input
              value={deleteConfirmation}
              onChange={(event) => setDeleteConfirmation(event.target.value)}
              autoComplete="off"
              spellCheck="false"
            />
          </Field>
        </div>
      </Drawer>
    </>
  );

  const records = (
    <>
      <h2>{uiT("Records, backups & recovery")}</h2>
      <p>
        {persistenceMode === "cloud"
          ? uiT("Add records safely or keep a complete recovery copy of your private cloud workspace.")
          : uiT("Add records safely and export a backup regularly.")}
      </p>
      <div className="settings-data-actions">
        {/* Backing up is the one primary action here; importing is secondary. */}
        <div className="settings-data-action">
          <span>
            <strong>{uiT("Backup & recovery")}</strong>
            <small>
              {uiT("Download everything, or intentionally replace the workspace from a trusted full backup.")}
            </small>
          </span>
          <div className="button-cluster">
            {encryption?.enabled ? (
              <Button variant="primary" icon={LockKeyhole} onClick={actions.exportEncryptedBackup}>
                {uiT("Download encrypted .hibi")}
              </Button>
            ) : (
              <Button variant="primary" icon={Download} onClick={actions.exportJson}>
                {uiT("Download backup")}
              </Button>
            )}
            {encryption?.enabled ? (
              <Button icon={Download} onClick={actions.exportJson}>
                {uiT("Export readable JSON")}
              </Button>
            ) : null}
            <Button icon={Upload} onClick={() => fileRef.current?.click()}>
              {uiT("Restore full backup")}
            </Button>
            {persistenceMode === "cloud" ? (
              <Button icon={History} onClick={openRecoveryHistory}>
                {uiT("Recovery history")}
              </Button>
            ) : null}
          </div>
        </div>
        <div className="settings-data-action safe-import-action">
          <span>
            <strong>{uiT("Import records")}</strong>
            <small>
              {uiT("Add records from another Hibi JSON backup. Existing records and settings are never removed.")}
            </small>
          </span>
          <Button icon={FilePlus2} disabled={recordImportBusy} onClick={() => recordsFileRef.current?.click()}>
            {recordImportBusy ? uiT("Reading…") : uiT("Import records")}
          </Button>
        </div>
      </div>
      <input ref={recordsFileRef} type="file" accept=".json,application/json" hidden onChange={previewRecordImport} />
      <input
        ref={fileRef}
        type="file"
        accept=".hibi,.json,application/json,application/vnd.hibi.encrypted+json"
        hidden
        onChange={importFile}
      />
      {encryption?.enabled ? (
        <p className="settings-inline-warning">
          <strong>{uiT(".hibi is recommended.")}</strong>{" "}
          {uiT(
            " JSON exports are readable files intended only for advanced local use; Hibi never uploads their plaintext during import.",
          )}
        </p>
      ) : null}
    </>
  );
  const runSecurityAction = async (action, fallbackError) => {
    setSecurityBusy(true);
    setSecurityError("");
    try {
      await action();
    } catch (error) {
      setSecurityError(error?.message || fallbackError);
    } finally {
      setSecurityBusy(false);
    }
  };
  const createRecoveryKey = () =>
    runSecurityAction(
      async () => setRecoveryReveal(await encryption.createRecoveryKey()),
      "A recovery key could not be created.",
    );
  const keyDates = (createdAt, lastUsedAt) => {
    const date = formatKeyDate(createdAt, locale);
    const lastUsed = formatKeyDate(lastUsedAt, locale);
    if (date && lastUsed) return uiT("Created {date} · last used {lastUsed}", { date, lastUsed });
    if (date) return uiT("Created {date} · not used yet", { date });
    return lastUsed ? uiT("Last used {lastUsed}", { lastUsed }) : uiT("Not used yet");
  };
  const rememberedDevice = encryption?.rememberedDevices?.[0];
  const rememberedSince = formatKeyDate(rememberedDevice?.createdAt, locale);
  const rememberedLastUsed = formatKeyDate(rememberedDevice?.lastUsedAt, locale);
  const deviceNote = !rememberedSince
    ? uiT("Hibi opens here without your password.")
    : rememberedLastUsed
      ? uiT("Hibi opens here without your password. Since {date} · last used {lastUsed}.", {
          date: rememberedSince,
          lastUsed: rememberedLastUsed,
        })
      : uiT("Hibi opens here without your password. Since {date}.", { date: rememberedSince });
  // Encryption & devices: how Hibi is unlocked, the keys that can unlock it, and this browser's access.
  const encryptionBlock = encryption?.enabled ? (
    <section className="settings-block encryption-settings-card" aria-labelledby="settings-encryption-title">
      <h3 id="settings-encryption-title" className="settings-subhead">
        {uiT("Encryption and devices")}
      </h3>
      <p className="settings-block-lead">{uiT(unlockMethodCopy(encryption.method))}</p>
      {recoveryKeyMissing ? (
        <div className="recovery-key-warning" ref={createRecoveryRef}>
          <TriangleAlert aria-hidden="true" size={20} />
          <span>
            <strong>{uiT("You don't have a recovery key yet")}</strong>
            <small>
              {uiT(
                "If you forget your encryption password, nobody can recover your data, not even Hibi. A recovery key is your other way in. Create one and keep it somewhere safe.",
              )}
            </small>
            <Button
              variant="primary"
              icon={KeyRound}
              disabled={securityBusy || cloudSecurityReadOnly}
              onClick={createRecoveryKey}
            >
              {uiT("Create recovery key")}
            </Button>
          </span>
        </div>
      ) : null}
      {recoveryReveal ? (
        <div className="recovery-key-reveal" role="status">
          <strong>{uiT("Save this recovery key now. Hibi support cannot reconstruct it.")}</strong>
          <code>{recoveryReveal}</code>
          <Button
            onClick={() =>
              navigator.clipboard?.writeText(recoveryReveal).then(() => actions.notify("Recovery key copied"))
            }
          >
            {uiT("Copy key")}
          </Button>
        </div>
      ) : null}
      <h4 className="settings-minor-head">{uiT("Ways to unlock")}</h4>
      <div className="workspace-key-list" role="group" aria-label={uiT("Ways to unlock")}>
        {activeKeys.map((wrapper) => {
          const blockedReason = revokeBlockedReason(wrapper, activeKeys.length);
          return (
            <div className="workspace-key-row" key={wrapper.wrapperId}>
              <span>
                <strong>
                  {wrapper.type === "password"
                    ? uiT("Encryption password")
                    : wrapper.type === "recovery"
                      ? uiT("Recovery key")
                      : uiT(wrapper.label || "Key")}
                </strong>
                <small>{keyDates(wrapper.createdAt, wrapper.lastUsedAt)}</small>
              </span>
              {blockedReason ? (
                <small className="workspace-key-note">{uiT(blockedReason)}</small>
              ) : (
                <Button
                  disabled={securityBusy || cloudSecurityReadOnly}
                  onClick={() =>
                    runSecurityAction(
                      () => encryption.revokeWrapper(wrapper.wrapperId),
                      "That workspace key could not be revoked.",
                    )
                  }
                >
                  {uiT("Revoke")}
                </Button>
              )}
            </div>
          );
        })}
      </div>
      <div className="button-cluster workspace-key-actions">
        <Button
          icon={KeyRound}
          disabled={securityBusy || cloudSecurityReadOnly}
          onClick={() => {
            setSecurityError("");
            setCurrentEncryptionPassword("");
            setNewEncryptionPassword("");
            setNewEncryptionPasswordConfirmation("");
            setPasswordChangeOpen(true);
          }}
        >
          {uiT("Change encryption password")}
        </Button>
        {recoveryKeyMissing ? null : (
          <Button icon={KeyRound} disabled={securityBusy || cloudSecurityReadOnly} onClick={createRecoveryKey}>
            {uiT("Create another recovery key")}
          </Button>
        )}
      </div>
      <h4 className="settings-minor-head">{uiT("This browser")}</h4>
      <div className="workspace-key-list" role="group" aria-label={uiT("This browser")}>
        <div className="workspace-key-row">
          <span>
            <strong>
              {deviceRemembered
                ? uiT("This browser remembers your key")
                : uiT("This browser doesn't remember your key")}
            </strong>
            <small>
              {deviceRemembered ? deviceNote : uiT("You need your encryption password each time you open Hibi here.")}
            </small>
          </span>
          {deviceRemembered ? (
            <Button
              disabled={securityBusy}
              onClick={() =>
                runSecurityAction(async () => {
                  await encryption.forgetDevice();
                  actions.notify("Remembered-device access removed");
                }, "Remembered-device access could not be removed.")
              }
            >
              {uiT("Forget this device")}
            </Button>
          ) : (
            <Button
              disabled={securityBusy}
              onClick={() =>
                runSecurityAction(async () => {
                  await encryption.rememberDevice();
                  actions.notify("This device will remember the workspace key");
                }, "This device could not be remembered.")
              }
            >
              {uiT("Remember this device")}
            </Button>
          )}
        </div>
      </div>
      {deviceRemembered ? (
        <p className="settings-action-note">
          {uiT(
            "Forgetting removes only the key saved in this browser. Your records stay; next time you will need your encryption password.",
          )}
        </p>
      ) : null}
      <div className="danger-line settings-rotation-line">
        <span>
          <strong>{uiT("Lost a device?")}</strong>
          <small>
            {uiT(
              "An emergency rotation renews your key so that device cannot read new changes. Your recovery keys stop working; create a new one afterwards.",
            )}
          </small>
        </span>
        <Button
          icon={RotateCcw}
          disabled={securityBusy || cloudSecurityReadOnly}
          onClick={() => {
            setRotationProgress("");
            setRotationOpen(true);
          }}
        >
          {uiT("Emergency key rotation")}
        </Button>
      </div>
      {cloudSecurityReadOnly ? (
        <p role="status">{uiT("This preview is read-only. Security changes are disabled.")}</p>
      ) : null}
      {securityError ? (
        <p className="field-error" role="alert">
          {uiT(securityError)}
        </p>
      ) : null}
    </section>
  ) : null;
  // Copies kept in this browser, each named for exactly what it removes.
  const localCopies =
    encryption?.enabled || legacyCopy ? (
      <section className="settings-block" aria-labelledby="settings-local-title">
        <h3 id="settings-local-title" className="settings-subhead">
          {uiT("Copies on this browser")}
        </h3>
        <div className="privacy-actions">
          {encryption?.enabled ? (
            <div className="danger-line">
              <span>
                <strong>{uiT("Encrypted copies on this browser")}</strong>
                <small>
                  {uiT(
                    "Erases the offline copy, this device's copies in recovery history and the saved key, then locks Hibi until you enter your password. Your cloud records are not touched. It won't run while changes are waiting to sync.",
                  )}
                </small>
              </span>
              <Button
                disabled={securityBusy}
                onClick={() =>
                  runSecurityAction(async () => {
                    await encryption.clearLocalCopies();
                    actions.notify("Local encrypted copies and remembered access cleared");
                  }, "Local copies could not be cleared.")
                }
              >
                {uiT("Erase copies on this browser")}
              </Button>
            </div>
          ) : null}
          {legacyCopy ? (
            <div className="danger-line">
              <span>
                <strong>{uiT("Readable copy from before your account")}</strong>
                <small>
                  {uiT(
                    "An unencrypted copy of your records left in this browser from before you signed in. Deleting it doesn't affect your cloud workspace or recovery history.",
                  )}
                </small>
              </span>
              <Button onClick={() => setClearTarget("local")}>{uiT("Delete readable copy")}</Button>
            </div>
          ) : null}
        </div>
      </section>
    ) : null;
  const privacy = (
    <>
      <h2>{uiT("Data & privacy")}</h2>
      <p>
        {encryption?.enabled
          ? uiT("Cloud records and snapshots are end-to-end encrypted. Files you export remain under your control.")
          : uiT("Backups include student, parent, grade, attendance, and payment data. Store them privately.")}
      </p>
      {persistenceMode !== "cloud" ? (
        <>
          <ul className="privacy-facts">
            <li>
              <HardDrive aria-hidden="true" size={18} />
              <span>
                <strong>{uiT("Stored only in this browser")}</strong>
                <small>
                  {uiT(
                    "Your students, groups, grades, attendance, and payments live on this device. Hibi does not send them to any server.",
                  )}
                </small>
              </span>
            </li>
            <li>
              <ShieldCheck aria-hidden="true" size={18} />
              <span>
                <strong>{uiT("No account, no tracking")}</strong>
                <small>{uiT("Hibi does not collect analytics or share your records with anyone.")}</small>
              </span>
            </li>
            <li>
              <TriangleAlert aria-hidden="true" size={18} />
              <span>
                <strong>{uiT("Clearing browser data erases everything")}</strong>
                <small>
                  {uiT(
                    "Clearing site data, using private browsing, or switching browsers or devices leaves your records behind. A backup is the only way to recover them.",
                  )}
                </small>
              </span>
            </li>
            <li>
              <UsersRound aria-hidden="true" size={18} />
              <span>
                <strong>{uiT("Shared computers")}</strong>
                <small>
                  {uiT(
                    "Anyone who uses this browser profile can open Hibi and see your records. Use your own profile or device.",
                  )}
                </small>
              </span>
            </li>
          </ul>
          <div className="settings-data-actions">
            <div className="settings-data-action">
              <span>
                <strong>{uiT("Keep a private copy")}</strong>
                <small>
                  {uiT(
                    "The backup is a readable file. Save it somewhere only you can access, and do not send it by email or chat.",
                  )}
                </small>
              </span>
              <Button variant="primary" icon={Download} onClick={actions.exportJson}>
                {uiT("Download backup")}
              </Button>
            </div>
          </div>
        </>
      ) : null}
      {persistenceMode === "cloud" ? (
        <>
          {encryptionBlock}
          {localCopies}
          {/* Last, and apart: actions that empty the workspace or delete the account. */}
          <section className="settings-block settings-danger-zone" aria-labelledby="settings-danger-title">
            <h3 id="settings-danger-title" className="settings-subhead">
              {uiT("Danger zone")}
            </h3>
            <div className="privacy-actions">
              <div className="danger-line workspace-reset-line">
                <span>
                  <strong>{uiT("Reset workspace")}</strong>
                  <small>
                    {uiT(
                      "Clears active students, groups, grades, classes, schedules, and payments. Server snapshots and encrypted copies on this device have a 30-day recovery window. Expired device copies are purged the next time Hibi opens on that device. This is not permanent deletion.",
                    )}
                  </small>
                </span>
                <Button
                  icon={RotateCcw}
                  onClick={() => {
                    setResetConfirmation("");
                    setResetOpen(true);
                  }}
                >
                  {uiT("Reset workspace")}
                </Button>
              </div>
              <div className="danger-line permanent-delete-line">
                <span>
                  <strong>{uiT("Delete account and data")}</strong>
                  <small>
                    {uiT(
                      "Permanently erases active records, snapshots, imports, synchronization history, the Auth account, and this account’s copies on the current device. There is no recovery.",
                    )}
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
                  {uiT("Delete account and data")}
                </Button>
              </div>
            </div>
          </section>
        </>
      ) : (
        encryptionBlock
      )}
    </>
  );

  const unitField = (key, label, unit, { min = 0, max = undefined, step = 1, percent = false } = {}) => (
    <Field label={label}>
      <span className="unit-input">
        <Input
          type="number"
          min={min}
          max={max}
          step={step}
          value={percent ? Math.round(draft[key] * 100) : draft[key]}
          onChange={(event) =>
            setDraft({ ...draft, [key]: percent ? Number(event.target.value) / 100 : Number(event.target.value) })
          }
        />
        <span aria-hidden="true">{unit}</span>
      </span>
    </Field>
  );

  const saveFooter = (
    <div className="settings-save">
      <span className="muted">{dirty ? uiT("Unsaved changes") : uiT("No changes to save")}</span>
      <Button variant="primary" onClick={save} disabled={!dirty || saving}>
        {saving ? uiT("Saving…") : uiT("Save values")}
      </Button>
    </div>
  );

  const classes = (
    <>
      <h2>{uiT("Class values")}</h2>
      <p>{uiT("Used when recording new classes and to calculate alerts and projections.")}</p>
      <div className="settings-grid">
        {unitField("defaultClassHours", uiT("Default duration"), uiT("hours"), { step: 0.25 })}
        {unitField("hourlyRateMxn", uiT("Hourly rate"), uiT("MXN / hour"))}
        {unitField("recentProjectionWeeks", uiT("Projection window"), uiT("weeks"), { min: 1 })}
        {unitField("lowGradeThreshold", uiT("Low grade, below"), "%", { max: 100, percent: true })}
        {unitField("lowAttendanceThreshold", uiT("Low attendance, below"), "%", { max: 100, percent: true })}
      </div>
      <div className="settings-effects">
        <h3 className="overline">{uiT("With these values")}</h3>
        <div className="fx">
          <span>
            <b>
              {uiT("A new {hours} class costs {amount} per student", {
                hours: formatHours(draft.defaultClassHours, locale),
                amount: formatMoney(effects.classCost, locale),
              })}
            </b>
            <small>{effects.ownRates.length ? ownRatesText : uiT("Every group uses this rate.")}</small>
          </span>
          <span className="v">{formatMoney(effects.classCost, locale)}</span>
        </div>
        <div className="fx">
          <span>
            <b>{uiT("Projection for {month}", { month: monthLong(asOf, locale) })}</b>
            <small>{uiT("Collected so far plus the fees and classes left this month.")}</small>
          </span>
          <span className="v">{formatMoney(effects.projection, locale)}</span>
        </div>
        <div className="fx">
          <span>
            <b>
              {uiT(
                effects.lowAttendance.length === 1
                  ? "{count} student with low attendance"
                  : "{count} students with low attendance",
                {
                  count: effects.lowAttendance.length,
                },
              )}
            </b>
            <small>
              {effects.lowAttendance.length
                ? effects.lowAttendance
                    .slice(0, 3)
                    .map((row) => `${row.student.fullName} ${formatPercent(row.attendance, locale)}`)
                    .join(" · ")
                : uiT("Nobody this month.")}
            </small>
          </span>
          <span className="settings-avatars" aria-hidden="true">
            {effects.lowAttendance.slice(0, 3).map((row) => (
              <StudentAvatar
                key={row.student.id}
                avatarId={row.student.avatarId}
                name={row.student.fullName}
                size="small"
                decorative
              />
            ))}
          </span>
        </div>
        <div className="fx">
          <span>
            <b>
              {uiT(
                effects.lowGradeCount === 1 ? "{count} student with a low grade" : "{count} students with a low grade",
                {
                  count: effects.lowGradeCount,
                },
              )}
            </b>
            <small>
              {effects.lowGrades.length
                ? effects.lowGrades
                    .slice(0, 2)
                    .map((item) =>
                      uiT("{name} got {grade} in {assessment} ({date}).", {
                        name: item.name,
                        grade: formatScore(item.value, locale),
                        assessment: item.assessment,
                        date: formatShortDate(item.date, locale),
                      }),
                    )
                    .join(" ")
                : uiT("Nobody this month.")}
            </small>
          </span>
          {effects.lowGrades.length ? <span className="st st-venc">{uiT("Review")}</span> : <span />}
        </div>
      </div>
      {saveFooter}
    </>
  );

  const tutorial = onOpenOnboarding ? (
    <div>
      <h2>{uiT("Welcome tutorial")}</h2>
      <p>{uiT("Revisit Hibi’s main features or set up another group with guidance.")}</p>
      <div className="settings-tour-actions">
        <Button icon={Sparkles} onClick={() => onOpenOnboarding("tour")}>
          {uiT("Start tour")}
        </Button>
        <Button icon={UsersRound} onClick={() => onOpenOnboarding("setup")}>
          {resumeStep ? uiT("Resume guided setup") : uiT("Guided setup")}
        </Button>
      </div>
      <div className="settings-note">
        <LockKeyhole aria-hidden="true" size={18} />
        <span>
          <strong>{uiT("End-to-end encryption")}</strong>
          <small>{uiT("Your tutorial progress and classroom data stay protected with E2EE.")}</small>
        </span>
      </div>
    </div>
  ) : null;

  const soundSwitch = (
    <Switch
      checked={soundsEnabled}
      onChange={toggleSounds}
      label={soundsEnabled ? uiT("Turn sound effects off") : uiT("Turn sound effects on")}
    />
  );
  const appearanceControl = (
    <Segmented
      className="settings-appearance"
      label={uiT("Appearance")}
      value={appearance}
      onChange={setAppearance}
      items={APPEARANCE_ITEMS}
    />
  );
  const interfaceSection = (
    <>
      <h2>{uiT("Interface")}</h2>
      <p>{uiT("Choose the language, the appearance and whether Hibi plays gentle feedback sounds.")}</p>
      <div className="fx">
        <span>
          <b>{uiT("Language")}</b>
          <small>{uiT("Choose the interface language.")}</small>
        </span>
        <LanguageToggle className="settings-language" />
      </div>
      <div className="fx">
        <span>
          <b>{uiT("Appearance")}</b>
          <small>{uiT("Follow the system theme or choose light or dark; saved on this device only.")}</small>
        </span>
        {appearanceControl}
      </div>
      <div className="fx">
        <span>
          <b>{uiT("Sound effects")}</b>
          <small>{uiT("A few gentle cues for saves, attendance, payments, and avatars.")}</small>
        </span>
        {soundSwitch}
      </div>
    </>
  );

  const languageName = language === "es" ? "Español" : "English";
  const sections = [
    {
      id: "classes",
      icon: Clock3,
      title: uiT("Class values"),
      summary: uiT("{hours} · {rate} per hour · projection over {weeks} weeks", {
        hours: formatHours(state.settings.defaultClassHours, locale),
        rate: formatMoney(state.settings.hourlyRate, locale),
        weeks: state.settings.recentProjectionWeeks,
      }),
      content: classes,
    },
    ...(tutorial
      ? [
          {
            id: "tutorial",
            icon: Sparkles,
            title: uiT("Welcome tutorial"),
            summary: resumeStep ? uiT("Guided setup in progress") : uiT("Tour and guided setup"),
            content: tutorial,
          },
        ]
      : []),
    {
      id: "interface",
      icon: Globe2,
      title: uiT("Interface"),
      summary: `${languageName} · ${uiT(APPEARANCE_SUMMARY[appearance])} · ${soundsEnabled ? uiT("sounds on") : uiT("sounds off")}`,
      content: interfaceSection,
    },
    {
      id: "records",
      icon: Download,
      title: uiT("Records and backups"),
      summary:
        persistenceMode === "cloud" ? uiT("Cloud copy with recovery history") : uiT("Saved only in this browser"),
      status: persistenceMode === "cloud" ? null : { tone: "st-pend", text: uiT("Back up regularly") },
      content: records,
    },
    {
      id: "privacy",
      icon: LockKeyhole,
      title: uiT("Data & privacy"),
      summary: encryption?.enabled ? uiT("End-to-end encryption") : uiT("Your backups stay with you"),
      status: recoveryKeyMissing
        ? { tone: "st-pend", text: uiT("No recovery key") }
        : encryption?.enabled
          ? { tone: "st-ok", text: uiT("Active") }
          : null,
      content: privacy,
    },
  ];
  const current = sections.find((item) => item.id === section) || sections[0];

  if (compact) {
    const valueRow = (id, label, value) => (
      <ListRow key={id} name={label} value={value} onClick={() => openSheet(id)} />
    );
    const sheet = sheetField;
    return (
      <div className="page settings-page is-compact">
        <div className="settings-mobile-head">
          {account?.email ? (
            <span className="overline">{uiT("Your account · {email}", { email: account.email })}</span>
          ) : null}
          <h1>{uiT("Settings (short)")}</h1>
        </div>
        <section className="settings-group">
          <h2 className="overline">{uiT("Classes")}</h2>
          {valueRow(
            "defaultClassHours",
            uiT("Default duration"),
            formatHours(state.settings.defaultClassHours, locale),
          )}
          {valueRow("hourlyRateMxn", uiT("Hourly rate"), formatMoney(state.settings.hourlyRate, locale))}
          {valueRow(
            "recentProjectionWeeks",
            uiT("Projection"),
            uiT("{count} weeks", { count: state.settings.recentProjectionWeeks }),
          )}
        </section>
        <section className="settings-group">
          <h2 className="overline">{uiT("Alerts")}</h2>
          {valueRow(
            "lowGradeThreshold",
            uiT("Low grade"),
            uiT("Below {value}", { value: formatScore(state.settings.lowGradeThreshold * 10, locale) }),
          )}
          {valueRow(
            "lowAttendanceThreshold",
            uiT("Low attendance"),
            uiT("Below {value}", { value: `${Math.round(state.settings.lowAttendanceThreshold * 100)}%` }),
          )}
        </section>
        <section className="settings-group" data-onboarding-tour="settings">
          <h2 className="overline">{uiT("App")}</h2>
          {valueRow("language", uiT("Language"), languageName)}
          {valueRow(
            "appearance",
            uiT("Appearance"),
            uiT(APPEARANCE_ITEMS.find((item) => item.value === appearance)?.label ?? "System"),
          )}
          <div className="settings-row">
            <span>{uiT("Sound effects")}</span>
            {soundSwitch}
          </div>
          {tutorial ? valueRow("tutorial", uiT("Welcome tutorial"), uiT("See it again")) : null}
        </section>
        <section className="settings-group">
          <h2 className="overline">{uiT("Your data")}</h2>
          <ListRow
            name={uiT("Records and backups")}
            value={persistenceMode === "cloud" ? uiT("In the cloud") : uiT("This browser")}
            valueTone={persistenceMode === "cloud" ? "ok" : "pend"}
            onClick={() => openSheet("records")}
          />
          <ListRow
            name={encryption?.enabled ? uiT("End-to-end encryption") : uiT("Data & privacy")}
            value={recoveryKeyMissing ? uiT("No recovery key") : encryption?.enabled ? uiT("Active") : ""}
            valueTone={recoveryKeyMissing ? "pend" : "ok"}
            onClick={() => openSheet("privacy")}
          />
          {account?.onSignOut ? (
            <button type="button" className="settings-signout" onClick={account.onSignOut}>
              {uiT("Sign out")}
            </button>
          ) : null}
        </section>
        <BottomSheet
          open={Boolean(sheet)}
          onClose={() => setMobileSheet("")}
          kicker={sheet ? uiT(sheet.group) : ""}
          title={sheet ? uiT(sheet.title) : ""}
          description={sheet?.hint ? uiT(sheet.hint) : undefined}
          footer={
            <Button variant="primary" className="is-block" onClick={saveSheet} disabled={!dirty || saving}>
              {saving ? uiT("Saving…") : uiT("Save")}
            </Button>
          }
        >
          {sheet ? (
            <div className="settings-sheet">
              <div className="settings-stepper">
                <button
                  type="button"
                  aria-label={uiT("Less")}
                  disabled={sheetValue <= sheet.min}
                  onClick={() => stepSheet(-1)}
                >
                  −
                </button>
                <span>
                  <b>{sheet.format(sheetValue, locale)}</b>
                  <small>{uiT(sheet.unit)}</small>
                </span>
                <button
                  type="button"
                  aria-label={uiT("More")}
                  disabled={sheetValue >= sheet.max}
                  onClick={() => stepSheet(1)}
                >
                  +
                </button>
              </div>
              <ul className="settings-sheet-effects">
                <li>
                  {uiT("{hours} class: {amount} per student.", {
                    hours: formatHours(draft.defaultClassHours, locale),
                    amount: formatMoney(effects.classCost, locale),
                  })}
                </li>
                <li>
                  {uiT("Projection for {month}: {amount}.", {
                    month: monthLong(asOf, locale),
                    amount: formatMoney(effects.projection, locale),
                  })}
                </li>
                <li className={effects.lowAttendance.length ? "is-bad" : ""}>
                  {uiT(
                    effects.lowAttendance.length === 1
                      ? "{count} student with low attendance"
                      : "{count} students with low attendance",
                    { count: effects.lowAttendance.length },
                  )}
                </li>
                {effects.ownRates.length ? <li className="is-muted">{ownRatesText}</li> : null}
              </ul>
            </div>
          ) : null}
        </BottomSheet>
        <BottomSheet
          open={["language", "appearance", "tutorial", "records", "privacy"].includes(mobileSheet)}
          onClose={() => setMobileSheet("")}
          title={
            mobileSheet === "language"
              ? uiT("Language")
              : mobileSheet === "appearance"
                ? uiT("Appearance")
                : (sections.find((item) => item.id === mobileSheet)?.title ?? "")
          }
        >
          <div className="settings-detail is-sheet">
            {mobileSheet === "language" ? (
              <LanguageToggle className="settings-language" />
            ) : mobileSheet === "appearance" ? (
              appearanceControl
            ) : (
              sections.find((item) => item.id === mobileSheet)?.content
            )}
          </div>
        </BottomSheet>
        {dialogs}
      </div>
    );
  }

  return (
    <div className="page settings-page">
      <SectionHeading
        title={uiT("Settings")}
        description={uiT("Class values, language, sounds, backups and privacy.")}
      />
      <div className="settings-cols">
        <nav className="settings-nav" aria-label={uiT("Settings sections")} data-onboarding-tour="settings">
          {sections.map((item) => {
            const Icon = item.icon;
            return (
              <button
                type="button"
                key={item.id}
                className={`settings-sec ${current.id === item.id ? "is-active" : ""}`}
                aria-current={current.id === item.id ? "true" : undefined}
                onClick={() => setSection(item.id)}
              >
                <Icon aria-hidden="true" size={20} />
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.summary}</small>
                  {item.status ? <span className={`st ${item.status.tone}`}>{item.status.text}</span> : null}
                </span>
              </button>
            );
          })}
        </nav>
        <section className="settings-detail" aria-label={current.title}>
          {current.content}
        </section>
      </div>

      {dialogs}
    </div>
  );
}

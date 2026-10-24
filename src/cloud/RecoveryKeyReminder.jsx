import { useId, useState } from "react";
import { KeyRound, TriangleAlert } from "lucide-react";
import { Button } from "../components/ui";
import { useI18n } from "../i18n/index.jsx";
import { RECOVERY_REMINDER_DISMISSED_PREFIX } from "./workspaceStorageKeys.js";
import "./cloud.css";

/** True while an encrypted workspace has no active recovery key and this session could create one. */
export function needsRecoveryKeyReminder(encryption) {
  return (
    Boolean(encryption?.enabled) &&
    encryption.writesEnabled !== false &&
    !(encryption.wrappers || []).some((wrapper) => wrapper.type === "recovery" && !wrapper.revokedAt)
  );
}

/** Per account and device; account deletion purges it with the account's other local keys. */
export function recoveryReminderStorageKey(encryption) {
  const ownerId = encryption?.profile?.ownerId;
  return ownerId ? `${RECOVERY_REMINDER_DISMISSED_PREFIX}${ownerId}` : "";
}

function storedDismissal(key) {
  if (!key) return false;
  try {
    return localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
}

/**
 * Inicio: without a recovery key, forgetting the encryption password means losing the data. One dismissible
 * reminder that leads to «Crear clave de recuperación» in Configuración.
 */
export function RecoveryKeyReminder({ encryption, openPage = undefined }) {
  const { t: uiT } = useI18n();
  const titleId = useId();
  const storageKey = recoveryReminderStorageKey(encryption);
  const [dismissedNow, setDismissedNow] = useState(false);
  if (!needsRecoveryKeyReminder(encryption) || dismissedNow || storedDismissal(storageKey)) return null;

  const dismiss = () => {
    setDismissedNow(true);
    if (!storageKey) return;
    try {
      localStorage.setItem(storageKey, new Date().toISOString());
    } catch {
      // Storage can be blocked; the reminder stays hidden for this visit.
    }
  };

  return (
    <aside className="recovery-key-reminder" aria-labelledby={titleId}>
      <TriangleAlert aria-hidden="true" size={20} />
      <div className="recovery-key-reminder-copy">
        <strong id={titleId}>{uiT("You don't have a recovery key yet")}</strong>
        <small>
          {uiT(
            "If you forget your encryption password, nobody can recover your data, not even Hibi. A recovery key is your other way in. Create one and keep it somewhere safe.",
          )}
        </small>
        <div className="recovery-key-reminder-actions">
          <Button
            variant="primary"
            icon={KeyRound}
            onClick={() => openPage?.("settings", { type: "create-recovery-key" })}
          >
            {uiT("Create recovery key")}
          </Button>
          <button type="button" className="recovery-key-reminder-dismiss" onClick={dismiss}>
            {uiT("Not now")}
          </button>
        </div>
      </div>
    </aside>
  );
}

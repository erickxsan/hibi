import { useI18n } from "../i18n/index.jsx";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Cloud, CloudOff, LogOut } from "lucide-react";
import "./auth.css";

const STATUS_DETAILS = {
  synced: { label: "Saved online", short: "Synced", tone: "", icon: CheckCircle2 },
  syncing: { label: "Saving changes…", short: "Saving…", tone: "is-syncing", icon: Cloud },
  reconnecting: { label: "Cloud reconnecting", short: "Reconnecting", tone: "is-pending", icon: CloudOff },
  offline: { label: "Offline — changes pending", short: "Offline", tone: "is-pending", icon: CloudOff },
  "offline-cached": { label: "Offline — device copy", short: "Offline", tone: "is-pending", icon: CloudOff },
  conflict: { label: "Changes need review", short: "Review changes", tone: "is-error", icon: AlertCircle },
  error: { label: "Sync needs attention", short: "Needs attention", tone: "is-error", icon: AlertCircle },
};

export function syncStatusDetails(syncStatus) {
  return STATUS_DETAILS[syncStatus] ?? STATUS_DETAILS.synced;
}

/** The sync pill doubles as the account menu: status, email and sign out. */
export function AccountMenu({
  email,
  syncStatus = "synced",
  syncMessage,
  signingOut = false,
  onSignOut,
  placement = "down",
}) {
  const { t: uiT } = useI18n();
  const [open, setOpen] = useState(false);
  const [signOutError, setSignOutError] = useState("");
  const [localSigningOut, setLocalSigningOut] = useState(false);
  const [panelPosition, setPanelPosition] = useState(null);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const panelId = useId();
  const status = syncStatusDetails(syncStatus);
  const StatusIcon = status.icon;
  const busy = signingOut || localSigningOut;

  useEffect(() => {
    if (!open) return undefined;

    const handlePointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  // The sidebar scrolls (overflow: auto), so an absolutely positioned panel
  // would be clipped. Upward panels are pinned to the viewport instead.
  useLayoutEffect(() => {
    if (!open || placement !== "up") {
      setPanelPosition(null);
      return undefined;
    }

    const place = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPanelPosition({ left: rect.left, bottom: window.innerHeight - rect.top + 8 });
    };

    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, placement]);

  const handleSignOut = async () => {
    if (busy || !onSignOut) return;
    setSignOutError("");
    setLocalSigningOut(true);
    try {
      await onSignOut();
      setOpen(false);
    } catch (error) {
      setSignOutError(error instanceof Error ? error.message : "Couldn’t sign out. Please try again.");
    } finally {
      setLocalSigningOut(false);
    }
  };

  return (
    <div className={`account-menu is-${placement}`} ref={rootRef}>
      <button
        ref={triggerRef}
        className={`sync-pill ${status.tone}`.trim()}
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-label={uiT("Account menu for {p0}", { p0: email || uiT("current account") })}
        aria-expanded={open}
        aria-controls={panelId}
      >
        {uiT(status.short)}
      </button>

      {open ? (
        <section
          id={panelId}
          className="account-menu-panel"
          style={panelPosition ? { position: "fixed", ...panelPosition } : undefined}
          aria-label={uiT("Account options")}
        >
          <div className="account-menu-heading">
            <span>{uiT("Signed in as")}</span>
            <strong>{email || uiT("Your account")}</strong>
          </div>

          <div className={`account-sync-detail ${status.tone}`.trim()} role="status">
            <StatusIcon aria-hidden="true" size={18} strokeWidth={1.9} />
            <span>
              <strong>{uiT(status.label)}</strong>
              {syncMessage ? <small>{uiT(syncMessage)}</small> : null}
            </span>
          </div>

          {signOutError ? (
            <p className="account-menu-error" role="alert">
              {uiT(signOutError)}
            </p>
          ) : null}

          <button
            className="account-signout-button"
            type="button"
            onClick={handleSignOut}
            disabled={busy || !onSignOut}
          >
            <LogOut aria-hidden="true" size={18} strokeWidth={1.9} />
            {busy ? uiT("Signing out…") : uiT("Sign out")}
          </button>
        </section>
      ) : null}
    </div>
  );
}

import { useEffect, useId, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, ChevronDown, Cloud, CloudOff, LogOut } from "lucide-react";
import "./auth.css";

const STATUS_DETAILS = {
  synced: { label: "Saved online", icon: CheckCircle2 },
  syncing: { label: "Saving changes…", icon: Cloud },
  reconnecting: { label: "Cloud reconnecting", icon: CloudOff },
  offline: { label: "Offline — changes pending", icon: CloudOff },
  "offline-cached": { label: "Offline — device copy", icon: CloudOff },
  conflict: { label: "Sync conflict — local copy safe", icon: AlertCircle },
  error: { label: "Sync needs attention", icon: AlertCircle },
};

function initialFromEmail(email) {
  return email?.trim().charAt(0).toUpperCase() || "A";
}

export function AccountMenu({ email, syncStatus = "synced", syncMessage, signingOut = false, onSignOut }) {
  const [open, setOpen] = useState(false);
  const [signOutError, setSignOutError] = useState("");
  const [localSigningOut, setLocalSigningOut] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const panelId = useId();
  const status = STATUS_DETAILS[syncStatus] ?? STATUS_DETAILS.synced;
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
    <div className="account-menu" ref={rootRef}>
      <button
        ref={triggerRef}
        className="account-menu-trigger"
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-label={`Account menu for ${email || "current account"}`}
        aria-expanded={open}
        aria-controls={panelId}
      >
        <span className="account-avatar" aria-hidden="true">
          {initialFromEmail(email)}
        </span>
        <span className="account-trigger-copy">
          <span className="account-email">{email || "Account"}</span>
          <span className={`account-sync-inline is-${syncStatus}`}>
            <span aria-hidden="true" />
            {status.label}
          </span>
        </span>
        <ChevronDown className={open ? "is-open" : undefined} aria-hidden="true" size={16} />
      </button>

      {open ? (
        <section id={panelId} className="account-menu-panel" aria-label="Account options">
          <div className="account-menu-heading">
            <span className="account-avatar account-avatar-large" aria-hidden="true">
              {initialFromEmail(email)}
            </span>
            <div>
              <span>Signed in as</span>
              <strong>{email || "Your account"}</strong>
            </div>
          </div>

          <div className={`account-sync-detail is-${syncStatus}`} role="status">
            <StatusIcon aria-hidden="true" size={18} strokeWidth={1.9} />
            <span>
              <strong>{status.label}</strong>
              {syncMessage ? <small>{syncMessage}</small> : null}
            </span>
          </div>

          {signOutError ? (
            <p className="account-menu-error" role="alert">
              {signOutError}
            </p>
          ) : null}

          <button
            className="account-signout-button"
            type="button"
            onClick={handleSignOut}
            disabled={busy || !onSignOut}
          >
            <LogOut aria-hidden="true" size={18} strokeWidth={1.9} />
            {busy ? "Signing out…" : "Sign out"}
          </button>
        </section>
      ) : null}
    </div>
  );
}

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

const PANEL_WIDTH = 280;
const VIEWPORT_MARGIN = 12;
const PANEL_GAP = 8;
const MIN_PANEL_HEIGHT = 120;

/**
 * Fixed-position box for the account panel: next to the pill, never outside the viewport.
 * @param {{ left: number, right: number, top: number, bottom: number }} rect the pill's client rect
 * @param {string} placement "up" (sidebar) or "down" (top bar)
 * @param {number} viewportWidth
 * @param {number} viewportHeight
 */
export function accountPanelPosition(rect, placement, viewportWidth, viewportHeight) {
  const width = Math.max(0, Math.min(PANEL_WIDTH, viewportWidth - VIEWPORT_MARGIN * 2));
  const maxLeft = Math.max(VIEWPORT_MARGIN, viewportWidth - VIEWPORT_MARGIN - width);
  const position = { position: "fixed", width, maxHeight: 0 };
  if (placement === "up") {
    position.left = Math.min(Math.max(rect.left, VIEWPORT_MARGIN), maxLeft);
    position.bottom = Math.max(VIEWPORT_MARGIN, viewportHeight - rect.top + PANEL_GAP);
    position.maxHeight = Math.max(MIN_PANEL_HEIGHT, viewportHeight - position.bottom - VIEWPORT_MARGIN);
  } else {
    // Aligned to the pill's right edge, as in the top bar.
    position.left = Math.min(Math.max(rect.right - width, VIEWPORT_MARGIN), maxLeft);
    position.top = Math.max(VIEWPORT_MARGIN, rect.bottom + PANEL_GAP);
    position.maxHeight = Math.max(MIN_PANEL_HEIGHT, viewportHeight - position.top - VIEWPORT_MARGIN);
  }
  return position;
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

  // The sidebar scrolls (overflow: auto), so an absolutely positioned panel would be clipped there, and a
  // 280 px panel does not fit every phone. The panel is pinned to the viewport, kept inside it with a margin and,
  // only on very short windows, scrolls inside itself instead of being cut off.
  useLayoutEffect(() => {
    if (!open) {
      setPanelPosition(null);
      return undefined;
    }

    const place = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPanelPosition(accountPanelPosition(rect, placement, window.innerWidth, window.innerHeight));
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
        // The name starts with the visible status (WCAG 2.5.3) and leaves the email to the open panel.
        aria-label={uiT("{status} · Account menu", { status: uiT(status.short) })}
        aria-expanded={open}
        aria-controls={panelId}
      >
        {uiT(status.short)}
      </button>

      {open ? (
        <section
          id={panelId}
          className="account-menu-panel"
          style={panelPosition || undefined}
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

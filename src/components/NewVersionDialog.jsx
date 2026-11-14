import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../i18n";

export function reloadPage() {
  window.location.reload();
}

/**
 * Shown when a newer Hibi has written the workspace this tab is showing. This build cannot keep the fields it
 * does not know, so it refuses to save and nothing can be done here except reload. It looks like the in-app
 * confirmation (a sheet on phones) but has a single button and no way to dismiss it.
 * @param {{ onReload?: () => void }} props
 */
export function NewVersionDialog({ onReload = reloadPage }) {
  const { t: uiT } = useI18n();
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef(null);
  const reloadRef = useRef(null);

  useEffect(() => {
    const panel = panelRef.current;
    const silenced = [
      ...document.querySelectorAll('.hibi-shell, .app-shell, .toast-region, [role="dialog"], [role="alertdialog"]'),
    ].filter((element) => element !== panel && !element.contains(panel) && !element.hasAttribute("inert"));
    silenced.forEach((element) => element.setAttribute("inert", ""));
    reloadRef.current?.focus();
    // Escape belongs to nothing underneath while the dialog is up.
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      silenced.forEach((element) => element.removeAttribute("inert"));
    };
  }, []);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="overlay is-dialog confirm-prompt-layer" role="presentation" style={{ zIndex: 2200 }}>
      <section
        ref={panelRef}
        className="drawer drawer-compact confirm-prompt"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <header className="drawer-header">
          <div>
            <h2 id={titleId}>{uiT("A new version of Hibi is available")}</h2>
            <p id={descriptionId}>{uiT("Reload to keep saving your changes.")}</p>
          </div>
        </header>
        <footer className="drawer-footer">
          <button ref={reloadRef} type="button" className="button button-primary" onClick={onReload}>
            <span>{uiT("Reload")}</span>
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

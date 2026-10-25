import { useEffect, useId, useRef, useState } from "react";
import { Archive, ChevronDown } from "lucide-react";
import { useI18n } from "../i18n";
import { formatMoney } from "../utils/displayFormat";
import { Switch } from "./ui";

/**
 * «Incluir grupos archivados» as a small filter chip («1 grupo archivado fuera»). Opening it shows the
 * switch, what stays out (or which archived groups count during this session) and the archived balance.
 */
export function ArchivedGroupsScope({ scope }) {
  const { t, locale } = useI18n();
  if (!scope?.count) return null;
  const names = new Intl.ListFormat(locale, { type: "conjunction" }).format(scope.names || []);
  const toggle = <Switch label={t("Include archived groups")} checked={scope.included} onChange={scope.onChange} />;
  const message = scope.included
    ? names
      ? t(
          (scope.names || []).length === 1
            ? "includes {names} (archived) only during this session"
            : "includes the archived groups {names} only during this session",
          { names },
        )
      : t("Includes {count} archived groups · This session only", { count: scope.count })
    : t(
        scope.count === 1
          ? "{count} archived group is left out of these figures"
          : "{count} archived groups are left out of these figures",
        { count: scope.count },
      );
  return (
    <ArchivedGroupsMenu
      scope={scope}
      toggle={toggle}
      message={message}
      amount={formatMoney(scope.pendingBalance, locale)}
    />
  );
}

/** The chip and the panel it opens; the panel closes on Escape or a click outside. */
function ArchivedGroupsMenu({ scope, toggle, message, amount }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const panelId = useId();
  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (event.type === "keydown" ? event.key === "Escape" : !rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  const label = scope.included
    ? t("Includes archived groups")
    : t(scope.count === 1 ? "{count} archived group left out" : "{count} archived groups left out", {
        count: scope.count,
      });
  return (
    <div className={`scope-menu ${scope.included ? "on" : ""}`.trim()} ref={rootRef}>
      <button
        type="button"
        className="scope-menu-chip"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
      >
        <Archive aria-hidden="true" />
        {label}
        <ChevronDown aria-hidden="true" />
      </button>
      {open ? (
        <div className="scope-menu-panel" id={panelId} role="group" aria-label={t("Archived groups in statistics")}>
          <span className="scope-menu-row">
            <b>{t("Include archived groups")}</b>
            {toggle}
          </span>
          <small role="status">{`${message.charAt(0).toUpperCase()}${message.slice(1)}.`}</small>
          {!scope.included && scope.pendingBalance > 0 ? (
            <button type="button" className="scope-balance" onClick={scope.onOpen}>
              {t("Balance in archived groups: {amount}", { amount })}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

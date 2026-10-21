import { useI18n } from "../i18n";
import { formatMoney } from "../utils/displayFormat";
import { Switch } from "./ui";

/**
 * «Incluir grupos archivados» inside a scope notice. Off, it says what stays out and the balance
 * left in the archive; on, which archived groups count during this session.
 */
export function ArchivedGroupsScope({ scope, compact = false }) {
  const { t, locale } = useI18n();
  if (!scope?.count) return null;
  const included = scope.included;
  const names = new Intl.ListFormat(locale, { type: "conjunction" }).format(scope.names || []);
  const message = included
    ? names
      ? t("includes {names} (archived) only during this session", { names })
      : t("Includes {count} archived groups · This session only", { count: scope.count })
    : compact
      ? t(scope.count === 1 ? "{count} archived group is left out" : "{count} archived groups are left out", {
          count: scope.count,
        })
      : t(
          scope.count === 1
            ? "{count} archived group is left out of these figures"
            : "{count} archived groups are left out of these figures",
          { count: scope.count },
        );
  const amount = formatMoney(scope.pendingBalance, locale);
  const balance =
    !included && scope.pendingBalance > 0
      ? compact
        ? t("balance {amount}", { amount })
        : t("Balance in archived groups: {amount}", { amount })
      : "";
  return (
    <div
      className={`scope ${compact ? "is-compact" : ""} ${included ? "on" : ""}`.trim()}
      role="group"
      aria-label={t("Archived groups in statistics")}
    >
      {compact ? null : <Switch label={t("Include archived groups")} checked={included} onChange={scope.onChange} />}
      <span className="scope-text" role="status">
        <b>{t("Include archived groups")}</b>
        {compact ? null : " · "}
        <span>{compact && balance ? `${message} · ${balance}` : message}</span>
      </span>
      {!compact && balance ? (
        <button type="button" className="scope-balance" onClick={scope.onOpen}>
          {balance}
        </button>
      ) : null}
      {compact ? <Switch label={t("Include archived groups")} checked={included} onChange={scope.onChange} /> : null}
    </div>
  );
}

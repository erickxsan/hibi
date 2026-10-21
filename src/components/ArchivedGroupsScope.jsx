import { Archive } from "lucide-react";
import { useI18n } from "../i18n";
import { formatMoney } from "../utils/displayFormat";
import { Switch } from "./ui";

/**
 * «Incluir grupos archivados» inside a scope notice. Off, it says what stays out and the balance
 * left in the archive; on, which archived groups count during this session.
 * Variants: "bar" (Inicio), "pill" (Seguimiento), and on phones "row" (Inicio) or "card" (Seguimiento).
 */
export function ArchivedGroupsScope({ scope, compact = false, variant = "" }) {
  const { t, locale } = useI18n();
  if (!scope?.count) return null;
  const look = variant || (compact ? "row" : "bar");
  const included = scope.included;
  const names = new Intl.ListFormat(locale, { type: "conjunction" }).format(scope.names || []);
  const amount = formatMoney(scope.pendingBalance, locale);
  const hasBalance = !included && scope.pendingBalance > 0;
  const toggle = <Switch label={t("Include archived groups")} checked={included} onChange={scope.onChange} />;
  const longMessage = included
    ? names
      ? t("includes {names} (archived) only during this session", { names })
      : t("Includes {count} archived groups · This session only", { count: scope.count })
    : t(
        scope.count === 1
          ? "{count} archived group is left out of these figures"
          : "{count} archived groups are left out of these figures",
        { count: scope.count },
      );
  if (look === "pill") {
    return (
      <div
        className={`scope is-pill ${included ? "on" : ""}`.trim()}
        role="group"
        aria-label={t("Archived groups in statistics")}
      >
        {toggle}
        <span>{t("Include archived groups")}</span>
        <small role="status">
          {included
            ? t("This session only")
            : hasBalance
              ? t("Balance {amount} left out", { amount })
              : t(scope.count === 1 ? "{count} group left out" : "{count} groups left out", { count: scope.count })}
        </small>
      </div>
    );
  }
  if (look === "card") {
    return (
      <div
        className={`scope is-card ${included ? "on" : ""}`.trim()}
        role="group"
        aria-label={t("Archived groups in statistics")}
      >
        <span className="scope-card-head">
          <Archive aria-hidden="true" />
          <b>{t("Include archived groups")}</b>
          {toggle}
        </span>
        <span role="status">{longMessage.charAt(0).toUpperCase() + longMessage.slice(1)}.</span>
        {hasBalance ? (
          <button type="button" className="scope-balance" onClick={scope.onOpen}>
            {t("Balance in archived groups: {amount}", { amount })}
          </button>
        ) : null}
      </div>
    );
  }
  const message =
    look === "row" && !included
      ? t(scope.count === 1 ? "{count} archived group is left out" : "{count} archived groups are left out", {
          count: scope.count,
        })
      : longMessage;
  const balance = hasBalance
    ? look === "row"
      ? t("balance {amount}", { amount })
      : t("Balance in archived groups: {amount}", { amount })
    : "";
  return (
    <div
      className={`scope ${look === "row" ? "is-compact" : ""} ${included ? "on" : ""}`.trim()}
      role="group"
      aria-label={t("Archived groups in statistics")}
    >
      {look === "row" ? null : toggle}
      <span className="scope-text" role="status">
        <b>{t("Include archived groups")}</b>
        {look === "row" ? null : " · "}
        <span>{look === "row" && balance ? `${message} · ${balance}` : message}</span>
      </span>
      {look !== "row" && balance ? (
        <button type="button" className="scope-balance" onClick={scope.onOpen}>
          {balance}
        </button>
      ) : null}
      {look === "row" ? toggle : null}
    </div>
  );
}

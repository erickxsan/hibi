import { Archive, Info } from "lucide-react";
import { useI18n } from "../i18n";

export function ArchivedGroupsScope({ scope }) {
  const { t, locale } = useI18n();
  if (!scope?.count) return null;
  const included = scope.included;
  return (
    <section
      className={"archive-statistics-scope " + (included ? "is-included" : "")}
      aria-label={t("Archived groups in statistics")}
    >
      <div className="archive-statistics-control">
        <span>
          <Archive size={18} aria-hidden="true" />
          {t("Include archived groups")}
        </span>
        <button
          type="button"
          role="switch"
          aria-label={t("Include archived groups")}
          aria-checked={included}
          className="archive-statistics-switch"
          onClick={() => scope.onChange(!included)}
        >
          <span />
        </button>
      </div>
      <div className="archive-statistics-notice" role="status">
        <Info size={16} aria-hidden="true" />
        <span>
          {included
            ? t("Includes {count} archived groups · This session only", { count: scope.count })
            : t("{count} archived groups excluded from statistics", { count: scope.count })}
        </span>
        <button type="button" onClick={included ? () => scope.onChange(false) : scope.onOpen}>
          {t(included ? "Exclude again" : "View archive")}
        </button>
      </div>
      {!included && scope.pendingBalance > 0 ? (
        <p className="archive-statistics-balance">
          {t("Pending balances in the archive: {amount}", {
            amount: new Intl.NumberFormat(locale, { style: "currency", currency: scope.currency || "MXN" }).format(
              scope.pendingBalance,
            ),
          })}
        </p>
      ) : null}
    </section>
  );
}

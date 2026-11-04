import { useState } from "react";
import { useI18n } from "../i18n/index.jsx";
import { formatMoney } from "../utils/displayFormat";
import "./monthlyFeePay.css";

/**
 * «$450 [Marcar pagada]» for a monthly fee: the amount starts at what is still owed and can be
 * lowered to record an abono, so the same button settles the month or records part of it.
 * Callers key it by the balance, so a new balance starts a fresh amount.
 */
export function MonthlyFeePay({ charge, studentName, onPay, busy, fullLabel, buttonClassName = "mbtn" }) {
  const { t, locale } = useI18n();
  const [text, setText] = useState(String(charge.balance));
  const typed = text === "" ? 0 : Number(text);
  const amount = Number.isFinite(typed) ? Math.min(typed, charge.balance) : 0;
  const pay = () => amount > 0 && !busy && onPay(charge, amount);
  return (
    <span className="fee-pay">
      <label className="fee-amount">
        <span aria-hidden="true">$</span>
        <input
          inputMode="decimal"
          aria-label={t("Amount {name} pays", { name: studentName })}
          value={text}
          style={{ width: `${Math.max(2, text.length)}ch` }}
          disabled={busy}
          onChange={(event) => setText(event.target.value.replace(/[^\d.]/g, ""))}
          onFocus={(event) => event.target.select()}
          onBlur={() => {
            if (!(typed > 0) || typed > charge.balance) setText(String(charge.balance));
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") pay();
          }}
        />
      </label>
      <button type="button" className={buttonClassName} disabled={busy || !(amount > 0)} onClick={pay}>
        {amount >= charge.balance ? fullLabel : t("Record {amount}", { amount: formatMoney(amount, locale) })}
      </button>
    </span>
  );
}

/** Older same-day receipts have no recording time. Let the owner choose instead of guessing by UUID. */
export function MonthlyFeeUndo({ charge, date, onUndo, busy, buttonClassName = "link-button" }) {
  const { t, locale } = useI18n();
  const [selected, setSelected] = useState("");
  if (charge.lastPaidAt !== date) return null;
  const candidates = (charge.payments || []).filter((item) => item.paidAt === date);
  const latest = candidates.find((item) => item.id === charge.paymentId);
  const ambiguous = !latest?.recordedAt && candidates.length > 1;
  const paymentId = ambiguous ? candidates.find((item) => item.id === selected)?.id || "" : charge.paymentId;
  return (
    <span className="fee-undo">
      {ambiguous ? (
        <select
          aria-label={t("Payment to undo")}
          value={paymentId}
          disabled={busy}
          onChange={(event) => setSelected(event.target.value)}
        >
          <option value="">{t("Choose a payment")}</option>
          {candidates.map((item) => (
            <option key={item.id} value={item.id}>
              {formatMoney(item.amount, locale)}
            </option>
          ))}
        </select>
      ) : null}
      <button
        type="button"
        className={buttonClassName}
        disabled={busy || !paymentId}
        onClick={() => onUndo({ ...charge, paymentId })}
      >
        {t("Undo")}
      </button>
    </span>
  );
}

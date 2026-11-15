import { useState } from "react";
import { useI18n } from "../i18n/index.jsx";
import { BottomSheet, Button, Field, Input } from "../components/ui";
import { sumMoney } from "../domain/money.js";
import { formatMoney, formatShortDate, monthLong } from "../utils/displayFormat";
import { allocatePayment } from "./collectModel";
import "./collectSheet.css";

/** Rows shown before «Ver N más». */
const SHOWN = 4;

function capitalize(text) {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function shortDay(date, locale) {
  return formatShortDate(date, locale, { weekday: false });
}

/** «Abril» for a fee, «12 feb» for a class. */
function debtTitle(debt, locale) {
  return debt.kind === "class" ? shortDay(debt.date, locale) : capitalize(monthLong(`${debt.period}-01`, locale));
}

/** «Vencida · 5 may», «Abonó $300 · faltan $500», «Prepa · Pendiente». */
function debtStatus(debt, t, locale, withGroup) {
  const group = withGroup ? debt.groupName : "";
  const state =
    debt.kind === "class"
      ? `${debt.groupName || t("Individual")} · ${t(debt.overdue ? "Overdue (fee)" : "Pending")}`
      : debt.abono > 0
        ? t("Paid {paid} · {left} left", {
            paid: formatMoney(debt.abono, locale),
            left: formatMoney(debt.amount, locale),
          })
        : debt.canLose
          ? t("Overdue · {date}", { date: shortDay(debt.date, locale) })
          : t("Due today");
  return group && debt.kind === "monthly" ? `${group} · ${state}` : state;
}

/** «8 mensualidades · la más antigua es de abril», «2 mensualidades y 1 clase · …». */
function owedLine(debts, t, locale) {
  const months = debts.filter((debt) => debt.kind === "monthly").length;
  const classes = debts.length - months;
  const monthNoun = t(months === 1 ? "{count} monthly fee" : "{count} monthly fees", { count: months });
  const classNoun = t(classes === 1 ? "{count} class" : "{count} classes", { count: classes });
  const noun =
    months && classes
      ? t("{first} and {second}", { first: monthNoun, second: classNoun })
      : months
        ? monthNoun
        : classNoun;
  if (debts.length < 2) return noun;
  const [oldest] = debts;
  const since =
    oldest.kind === "class"
      ? t("the oldest is from {date}", { date: shortDay(oldest.date, locale) })
      : t("the oldest is from {month}", { month: monthLong(`${oldest.period}-01`, locale) });
  return `${noun} · ${since}`;
}

/** «Prepa mensual · $800 al mes». */
function studentLine(debts, t, locale) {
  const groups = [...new Set(debts.map((debt) => debt.groupName || ""))];
  if (groups.length !== 1) return groups.filter(Boolean).join(" · ");
  const fee = debts.filter((debt) => debt.kind === "monthly").at(-1)?.charge?.total;
  const name = groups[0] || t("Individual");
  return fee ? `${name} · ${t("{amount} a month", { amount: formatMoney(fee, locale) })}` : name;
}

/** What the amount will do, said before it is saved: an abono, or a class left for later. */
function planNote(plan, debts, t, locale) {
  if (plan.blocked) {
    const date = shortDay(plan.blocked.date, locale);
    return plan.applied > 0
      ? t("Classes are paid in full: the one of {date} stays pending and {amount} is recorded.", {
          date,
          amount: formatMoney(plan.applied, locale),
        })
      : t("Classes are paid in full: the one of {date} costs {amount}.", {
          date,
          amount: formatMoney(plan.blocked.amount, locale),
        });
  }
  if (plan.partial) {
    const full = plan.items.length - 1;
    const values = {
      count: full,
      amount: formatMoney(plan.partial.amount, locale),
      // Mid-sentence a month reads in lower case: «abona $500 a mayo».
      name: monthLong(`${plan.partial.debt.period}-01`, locale),
    };
    if (!full) return t("Saved as a partial payment of {amount} toward {name}.", values);
    return t(
      full === 1
        ? "Covers {count} debt in full and puts {amount} toward {name}."
        : "Covers {count} debts in full and puts {amount} toward {name}.",
      values,
    );
  }
  return debts.length ? t("Less than the total is saved as a partial payment.") : "";
}

/**
 * «Cobrar»: every debt of one student in one sheet. All come checked; the amount starts at what the
 * checked ones add up to, and less than that is applied oldest first (see `allocatePayment`).
 * `rows` are `studentDebtRows`; lost ones stay out. «Dar un adeudo por perdido…» lists the overdue ones.
 */
export function CollectSheet({ open, onClose, studentId, studentName, rows, lostActions, busy = false }) {
  const { t, locale } = useI18n();
  const [off, setOff] = useState(() => new Set());
  const [typed, setTyped] = useState(/** @type {string | null} */ (null));
  const [more, setMore] = useState(false);
  const [mode, setMode] = useState("pay");
  const [wasOpen, setWasOpen] = useState(open);
  // Each opening starts over: everything checked, the whole amount.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setOff(new Set());
      setTyped(null);
      setMore(false);
      setMode("pay");
    }
  }
  const debts = rows.filter((debt) => !debt.lost);
  const losable = debts.filter((debt) => debt.canLose);
  const checked = debts.filter((debt) => !off.has(debt.key));
  const total = sumMoney(checked, (debt) => debt.amount);
  const owed = sumMoney(debts, (debt) => debt.amount);
  const text = typed ?? String(total);
  const plan = allocatePayment(checked, text === "" ? 0 : Number(text));
  const working = busy || lostActions.busy;
  const severalGroups = new Set(debts.map((debt) => debt.groupId)).size > 1;
  const onlyMonths = debts.every((debt) => debt.kind === "monthly");
  const shown = more || debts.length <= SHOWN + 1 ? debts : debts.slice(0, SHOWN);
  const toggle = (key) => {
    setOff((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    // A new choice brings a new total: the amount follows it.
    setTyped(null);
  };
  const collect = async () => {
    if (!plan.applied || working) return;
    if (await lostActions.collect(studentId, studentName, plan)) onClose();
  };
  const losing = mode === "lose";
  return (
    <BottomSheet
      open={open && (debts.length > 0 || losing)}
      onClose={onClose}
      title={studentName}
      description={studentLine(debts, t, locale)}
      className="collect-sheet"
      backLabel={losing ? t("Collect") : undefined}
      onBack={losing ? () => setMode("pay") : undefined}
      footer={
        losing ? null : (
          <div className="collect-foot">
            <Field label={t("Amount")} hint={planNote(plan, checked, t, locale)} className="collect-amount">
              <span className="collect-input">
                <span aria-hidden="true">$</span>
                <Input
                  inputMode="decimal"
                  value={text}
                  disabled={working || !checked.length}
                  onChange={(event) => setTyped(event.target.value.replace(/[^\d.]/g, ""))}
                  onFocus={(event) => event.target.select()}
                  onBlur={() => {
                    if (typed !== null && !(Number(typed) > 0 && Number(typed) <= total)) setTyped(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") collect();
                  }}
                />
              </span>
            </Field>
            <Button variant="primary" className="collect-go" disabled={working || !plan.applied} onClick={collect}>
              {t("Collect {amount}", { amount: formatMoney(plan.applied, locale) })}
            </Button>
            {losable.length ? (
              <button type="button" className="collect-link" disabled={working} onClick={() => setMode("lose")}>
                {t("Give up a debt…")}
              </button>
            ) : null}
          </div>
        )
      }
    >
      {losing ? (
        <div className="collect-lose">
          <h3 className="overline">{t("Debts")}</h3>
          {losable.length ? (
            losable.map((debt) => {
              const title = debtTitle(debt, locale);
              return (
                <div className="collect-lose-row" key={debt.key}>
                  <span className="collect-what">
                    <b>{title}</b>
                    <small className="is-bad">{debtStatus(debt, t, locale, severalGroups)}</small>
                  </span>
                  <span className="collect-money">{formatMoney(debt.amount, locale)}</span>
                  <Button
                    className="is-danger-text"
                    aria-label={`${t("Mark as lost")}: ${title}`}
                    disabled={working}
                    onClick={() => lostActions.lose(studentId, debt)}
                  >
                    {t("Mark as lost")}
                  </Button>
                </div>
              );
            })
          ) : (
            <p className="muted">{t("Nothing overdue to give up.")}</p>
          )}
        </div>
      ) : (
        <>
          <div className="collect-owed">
            <span className="collect-owed-head">
              <span className="overline">{t("Owes")}</span>
              <b>{formatMoney(owed, locale)}</b>
            </span>
            <span>{owedLine(debts, t, locale)}</span>
          </div>
          <h3 className="overline collect-overline">
            {t(onlyMonths ? "Months this payment covers" : "What this payment covers")}
          </h3>
          <div className="collect-list">
            {shown.map((debt) => {
              const on = !off.has(debt.key);
              const tone =
                debt.kind === "monthly" ? (debt.canLose ? "is-bad" : "is-pend") : debt.overdue ? "is-bad" : "";
              return (
                <label className={`collect-row ${on ? "" : "is-off"}`.trim()} key={debt.key}>
                  <input
                    type="checkbox"
                    className="collect-check"
                    checked={on}
                    disabled={working}
                    onChange={() => toggle(debt.key)}
                  />
                  <span className="collect-what">
                    <b>{debtTitle(debt, locale)}</b>
                    <small className={tone || undefined}>{debtStatus(debt, t, locale, severalGroups)}</small>
                  </span>
                  <span className="collect-money">{formatMoney(debt.amount, locale)}</span>
                </label>
              );
            })}
          </div>
          {shown.length < debts.length ? (
            <button type="button" className="collect-more" onClick={() => setMore(true)}>
              {t("Show {count} more", { count: debts.length - shown.length })}
            </button>
          ) : null}
        </>
      )}
    </BottomSheet>
  );
}

/** One «Cobrar» button per student, with its sheet. Nothing to collect, nothing shown. */
export function CollectButton({
  studentId,
  studentName,
  rows,
  lostActions,
  busy = false,
  variant = "primary",
  className = "",
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  if (!rows.some((debt) => !debt.lost)) return null;
  return (
    <>
      <Button
        variant={variant}
        className={`collect-open ${className}`.trim()}
        aria-label={`${t("Collect")}: ${studentName}`}
        disabled={busy || lostActions.busy}
        onClick={() => setOpen(true)}
      >
        {t("Collect")}
      </Button>
      <CollectSheet
        open={open}
        onClose={() => setOpen(false)}
        studentId={studentId}
        studentName={studentName}
        rows={rows}
        lostActions={lostActions}
        busy={busy}
      />
    </>
  );
}

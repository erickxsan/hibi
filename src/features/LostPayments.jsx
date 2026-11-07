import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, CircleSlash, Undo2 } from "lucide-react";
import { useI18n } from "../i18n/index.jsx";
import { BottomSheet, Button, Segmented } from "../components/ui";
import { StudentAvatar } from "../components/StudentAvatar";
import { lostKey } from "../domain/lostPayments";
import { sumMoney } from "../domain/money.js";
import { formatMoney, formatShortDate, monthLong, monthShort } from "../utils/displayFormat";
import { lostSummary, staleDebts } from "./homeDashboardModel";
import { debtItem } from "./lostPaymentsModel";
import { MonthlyFeePay } from "./MonthlyFeePay";
import "./lostPayments.css";

const STALE_FILTERS = [3, 6, 12];

function capitalize(text) {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function shortDay(date, locale) {
  return formatShortDate(date, locale, { weekday: false });
}

/** «Mayo» for a fee, «12 feb» for a class. */
function debtName(debt, locale) {
  return debt.kind === "class" ? shortDay(debt.date, locale) : capitalize(monthLong(`${debt.period}-01`, locale));
}

/** «Mayo», plus its group when the student owes in several: the rows would read alike otherwise. */
function debtLabeler(items, groups, locale) {
  const several = new Set(items.map((item) => item.groupId)).size > 1;
  return (item) => {
    const name = debtName(item, locale);
    const group = several ? groups.find((candidate) => candidate.id === item.groupId)?.name : "";
    return group ? `${name} · ${group}` : name;
  };
}

/** «4 meses · abr a jul» / «2 clases · 12 feb y 19 feb» / «2 meses y 1 clase». */
function debtSpan(items, t, locale, inactive = false) {
  const names = items.map((item) =>
    item.kind === "monthly" ? monthShort(`${item.period}-01`, locale) : shortDay(item.date, locale),
  );
  const count = items.length;
  const months = items.filter((item) => item.kind === "monthly").length;
  const classes = count - months;
  const monthNoun = t(months === 1 ? "{count} month" : "{count} months", { count: months });
  const classNoun = t(classes === 1 ? "{count} class" : "{count} classes", { count: classes });
  const mixed = months > 0 && classes > 0;
  const noun = mixed
    ? t("{first} and {second}", { first: monthNoun, second: classNoun })
    : months
      ? monthNoun
      : classNoun;
  if (inactive) return `${t("Inactive")} · ${noun}`;
  if (mixed) return noun;
  const span =
    count === 1
      ? names[0]
      : count === 2
        ? t("{first} and {second}", { first: names[0], second: names[1] })
        : t("{first} to {last}", { first: names[0], last: names.at(-1) });
  return `${noun} · ${span}`;
}

/** The icon-only control of a debt: ⊘ gives it up, ↶ recovers it. The word shows on hover. */
export function LostIconButton({ recover = false, name = "", onClick, disabled = false }) {
  const { t } = useI18n();
  const word = t(recover ? "Recover" : "Mark as lost");
  const Icon = recover ? Undo2 : CircleSlash;
  return (
    <button
      type="button"
      className="lost-icon"
      data-tip={word}
      aria-label={name ? `${word}: ${name}` : word}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon aria-hidden="true" />
    </button>
  );
}

/** Saves through the manager with one busy flag, and words the «Deshacer» notice of each change. */
export function useLostPaymentActions(actions) {
  const { t, locale } = useI18n();
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const run = async (work) => {
    if (working.current) return false;
    working.current = true;
    setBusy(true);
    try {
      return await work();
    } finally {
      working.current = false;
      setBusy(false);
    }
  };
  const amountOf = (debt) => formatMoney(debt.amount, locale);
  return {
    busy,
    lose: (studentId, debt) =>
      run(() =>
        actions?.giveUpPayments?.(
          [debtItem(studentId, debt)],
          debt.kind === "class"
            ? t("Class of {date} lost · {amount}", { date: shortDay(debt.date, locale), amount: amountOf(debt) })
            : t("{month} lost · {amount}", { month: debtName(debt, locale), amount: amountOf(debt) }),
        ),
      ),
    loseMany: (items, total) =>
      run(() => actions?.giveUpPayments?.(items, t("{amount} marked as lost", { amount: formatMoney(total, locale) }))),
    recover: (studentId, debt) =>
      run(() =>
        actions?.recoverPayments?.([debtItem(studentId, debt)], t("Recovered · {amount}", { amount: amountOf(debt) })),
      ),
    payFee: (charge, amount) => {
      const money = formatMoney(amount, locale);
      const month = monthLong(`${charge.period}-01`, locale);
      const message =
        amount < charge.balance
          ? t("{amount} paid toward {month}", { amount: money, month })
          : t("{month} paid · {amount}", { month: capitalize(month), amount: money });
      return run(() => actions?.payFee?.(charge, amount, message));
    },
    payClass: (debt) =>
      run(() =>
        actions?.markClassPaid?.(
          debt.classId,
          t("Class of {date} paid · {amount}", { date: shortDay(debt.date, locale), amount: amountOf(debt) }),
        ),
      ),
  };
}

/**
 * «Adeudos» of one student: pay it, give it up or recover it, one line per month or class. Only
 * `editable` on today's figures: a payment or a mark is dated today, so a report of an earlier day
 * could not show it, and may list as owed a class that was paid after that day.
 */
export function StudentDebts({
  studentId,
  studentName,
  rows,
  liveDate,
  editable,
  lostActions,
  busy = false,
  heading = "h4",
}) {
  const Heading = /** @type {"h3" | "h4"} */ (heading);
  const { t, locale } = useI18n();
  if (!rows.length) return null;
  const working = busy || lostActions.busy;
  const severalGroups = new Set(rows.map((debt) => debt.groupId)).size > 1;
  return (
    <div className="debts">
      <Heading className="overline">{t("Debts")}</Heading>
      {rows.map((debt) => {
        const group = severalGroups ? debt.groupName : "";
        const name = group ? `${debtName(debt, locale)} · ${group}` : debtName(debt, locale);
        const title =
          debt.kind === "class" ? debtName(debt, locale) : capitalize(monthShort(`${debt.period}-01`, locale));
        const state = debt.lost
          ? t("Lost · {date}", { date: debt.lostAt === liveDate ? t("today") : shortDay(debt.lostAt, locale) })
          : debt.kind === "class"
            ? debt.groupName || t("Individual")
            : debt.canLose
              ? `${t("Overdue · {date}", { date: shortDay(debt.date, locale) })}${
                  debt.abono ? ` · ${t("paid {amount}", { amount: formatMoney(debt.abono, locale) })}` : ""
                }`
              : t("Due today");
        // A pending class already reads as its group.
        const when = group && (debt.lost || debt.kind === "monthly") ? `${group} · ${state}` : state;
        const tone = debt.lost ? "" : debt.kind === "class" ? "" : debt.canLose ? "is-bad" : "is-pend";
        return (
          <div className={`debt-row ${debt.lost ? "is-lost" : ""}`.trim()} key={debt.key}>
            <b>{title}</b>
            <span className={`debt-when ${tone}`.trim()}>{when}</span>
            {debt.lost ? (
              <s className="debt-amount">{formatMoney(debt.amount, locale)}</s>
            ) : !editable ? (
              <span className="debt-amount">{formatMoney(debt.amount, locale)}</span>
            ) : debt.kind === "monthly" ? (
              <MonthlyFeePay
                key={`${debt.key}:${debt.amount}`}
                charge={debt.charge}
                studentName={`${studentName} · ${name}`}
                onPay={lostActions.payFee}
                busy={working}
                fullLabel={t("Mark paid (fee)")}
                name={name}
              />
            ) : (
              <span className="fee-pay">
                <span className="debt-amount">{formatMoney(debt.amount, locale)}</span>
                <button
                  type="button"
                  className="mbtn"
                  aria-label={`${t("Mark paid (fee)")}: ${name}`}
                  disabled={working}
                  onClick={() => lostActions.payClass(debt)}
                >
                  {t("Mark paid (fee)")}
                </button>
              </span>
            )}
            <span className="debt-action">
              {debt.lost ? (
                <LostIconButton
                  recover
                  name={name}
                  disabled={working}
                  onClick={() => lostActions.recover(studentId, debt)}
                />
              ) : debt.canLose && editable ? (
                <LostIconButton name={name} disabled={working} onClick={() => lostActions.lose(studentId, debt)} />
              ) : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function PanelStudent({ student, sub, children }) {
  return (
    <>
      <StudentAvatar avatarId={student?.avatarId} name={student?.fullName || ""} size="small" decorative />
      <span className="lost-name">
        <strong>{student?.fullName}</strong>
        <small>{sub}</small>
      </span>
      {children}
    </>
  );
}

/** «Perdidos»: the running total, per student; each month or class is recovered on its own. */
export function LostPaymentsPanel({ open, onClose, state, derived, asOf, scope = "all", kicker, lostActions }) {
  const { t, locale } = useI18n();
  const [opened, setOpened] = useState({});
  const studentsById = useMemo(
    () => new Map((state.students || []).map((student) => [student.id, student])),
    [state.students],
  );
  const summary = useMemo(
    () => (open ? lostSummary(state, derived?.classLog || [], asOf, scope) : { total: 0, students: [] }),
    [asOf, derived, open, scope, state],
  );
  // Recovering the last one leaves nothing to show.
  useEffect(() => {
    if (open && !summary.total) onClose();
  }, [onClose, open, summary.total]);
  return (
    <BottomSheet
      open={open && summary.total > 0}
      onClose={onClose}
      kicker={kicker}
      title={t("Lost · {amount}", { amount: formatMoney(summary.total, locale) })}
    >
      <div className="lost-list">
        {summary.students.map((entry) => {
          const student = studentsById.get(entry.studentId);
          const sub = debtSpan(entry.items, t, locale, student?.status === "Inactive");
          const single = entry.items.length === 1;
          const isOpen = Boolean(opened[entry.studentId]);
          const nameOf = debtLabeler(entry.items, state.groups || [], locale);
          return (
            <div className="lost-group" key={entry.studentId}>
              {single ? (
                <div className="lost-row">
                  <PanelStudent student={student} sub={sub}>
                    <s className="lost-amount">{formatMoney(entry.amount, locale)}</s>
                    <LostIconButton
                      recover
                      name={`${nameOf(entry.items[0])}, ${student?.fullName || ""}`}
                      disabled={lostActions.busy}
                      onClick={() => lostActions.recover(entry.studentId, entry.items[0])}
                    />
                  </PanelStudent>
                </div>
              ) : (
                <button
                  type="button"
                  className="lost-row lost-toggle"
                  aria-expanded={isOpen}
                  onClick={() => setOpened((current) => ({ ...current, [entry.studentId]: !isOpen }))}
                >
                  <PanelStudent student={student} sub={sub}>
                    <s className="lost-amount">{formatMoney(entry.amount, locale)}</s>
                    <span className="lost-chevron">
                      {isOpen ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
                    </span>
                  </PanelStudent>
                </button>
              )}
              {!single && isOpen
                ? entry.items.map((item) => (
                    <div className="lost-sub" key={lostKey(item)}>
                      <span>{nameOf(item)}</span>
                      <s className="lost-amount">{formatMoney(item.amount, locale)}</s>
                      <LostIconButton
                        recover
                        name={`${nameOf(item)}, ${student?.fullName || ""}`}
                        disabled={lostActions.busy}
                        onClick={() => lostActions.recover(entry.studentId, item)}
                      />
                    </div>
                  ))
                : null}
            </div>
          );
        })}
      </div>
    </BottomSheet>
  );
}

function Check({ checked, mixed = false, label, onChange }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = mixed;
  }, [mixed]);
  return (
    <input ref={ref} type="checkbox" className="lost-check" aria-label={label} checked={checked} onChange={onChange} />
  );
}

/** «Adeudos viejos»: Hibi gathers them, the teacher picks. Nothing starts marked. */
export function StaleDebtsPanel({ open, onClose, state, derived, asOf, scope = "all", kicker, lostActions }) {
  const { t, locale } = useI18n();
  const [months, setMonths] = useState(3);
  const [picked, setPicked] = useState({});
  const [opened, setOpened] = useState({});
  const studentsById = useMemo(
    () => new Map((state.students || []).map((student) => [student.id, student])),
    [state.students],
  );
  const stale = useMemo(
    () => (open ? staleDebts(state, derived?.classLog || [], asOf, months, scope) : { total: 0, students: [] }),
    [asOf, derived, months, open, scope, state],
  );
  useEffect(() => {
    if (open) {
      setMonths(3);
      setPicked({});
      setOpened({});
    }
  }, [open]);
  const keyOf = (studentId, item) => `${studentId}|${lostKey(item)}`;
  const all = stale.students.flatMap((entry) => entry.items.map((item) => ({ entry, item })));
  const chosen = all.filter(({ entry, item }) => picked[keyOf(entry.studentId, item)]);
  const total = sumMoney(chosen, ({ item }) => item.amount);
  const people = new Set(chosen.map(({ entry }) => entry.studentId)).size;
  const everyone = all.length > 0 && chosen.length === all.length;
  const setKeys = (keys, value) =>
    setPicked((current) => {
      const next = { ...current };
      keys.forEach((key) => {
        if (value) next[key] = true;
        else delete next[key];
      });
      return next;
    });
  const apply = async () => {
    const items = chosen.map(({ entry, item }) => debtItem(entry.studentId, item));
    if (await lostActions.loseMany(items, total)) onClose();
  };
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      kicker={kicker}
      title={t("Old debts")}
      footer={
        <div className="lost-foot">
          <span className="lost-total">
            {t(people === 1 ? "{count} student" : "{count} students", { count: people })}
            <b>{formatMoney(total, locale)}</b>
          </span>
          <Button variant="primary" disabled={!chosen.length || lostActions.busy} onClick={apply}>
            {t("Mark as lost")}
          </Button>
        </div>
      }
    >
      <div className="lost-tools">
        <Segmented
          value={String(months)}
          onChange={(value) => {
            setMonths(Number(value));
            setPicked({});
          }}
          label={t("How old")}
          items={STALE_FILTERS.map((value) => ({
            value: String(value),
            label: value === STALE_FILTERS[0] ? t("+{count} months", { count: value }) : `+${value}`,
          }))}
        />
        {all.length ? (
          <button
            type="button"
            className="lost-link"
            onClick={() =>
              setKeys(
                all.map(({ entry, item }) => keyOf(entry.studentId, item)),
                !everyone,
              )
            }
          >
            {t(everyone ? "Clear all (plural)" : "Choose all")}
          </button>
        ) : null}
      </div>
      {!all.length ? <p className="muted">{t("Nothing older than {count} months.", { count: months })}</p> : null}
      <div className="lost-list">
        {stale.students.map((entry) => {
          const student = studentsById.get(entry.studentId);
          const keys = entry.items.map((item) => keyOf(entry.studentId, item));
          const count = keys.filter((key) => picked[key]).length;
          const isOpen = Boolean(opened[entry.studentId]);
          const nameOf = debtLabeler(entry.items, state.groups || [], locale);
          return (
            <div className="lost-group" key={entry.studentId}>
              <div className={`lost-row lost-pick ${count ? "" : "is-off"}`.trim()}>
                <label className="lost-hit">
                  <Check
                    checked={count === keys.length}
                    mixed={count > 0 && count < keys.length}
                    label={student?.fullName || ""}
                    onChange={() => setKeys(keys, count !== keys.length)}
                  />
                </label>
                <PanelStudent student={student} sub={debtSpan(entry.items, t, locale, entry.inactive)}>
                  <span className="lost-amount is-live">{formatMoney(entry.amount, locale)}</span>
                  <button
                    type="button"
                    className="lost-icon"
                    aria-expanded={isOpen}
                    aria-label={t("Details of {name}", { name: student?.fullName || "" })}
                    onClick={() => setOpened((current) => ({ ...current, [entry.studentId]: !isOpen }))}
                  >
                    {isOpen ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
                  </button>
                </PanelStudent>
              </div>
              {isOpen
                ? entry.items.map((item) => {
                    const key = keyOf(entry.studentId, item);
                    return (
                      <label className="lost-sub lost-pick-sub" key={key}>
                        <Check
                          checked={Boolean(picked[key])}
                          label={`${nameOf(item)}, ${student?.fullName || ""}`}
                          onChange={() => setKeys([key], !picked[key])}
                        />
                        <span>{nameOf(item)}</span>
                        <b className="lost-amount is-live">{formatMoney(item.amount, locale)}</b>
                      </label>
                    );
                  })
                : null}
            </div>
          );
        })}
      </div>
    </BottomSheet>
  );
}

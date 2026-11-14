import { useState } from "react";
import { AlertTriangle, CloudOff, RefreshCw } from "lucide-react";
import { useI18n } from "../i18n/index.jsx";
import { Button } from "../components/ui";
import { formatMoney, formatMonthYear } from "../utils/displayFormat.js";
import "./cloud.css";

const COLLECTION_LABELS = {
  settings: "Settings",
  groups: "Group",
  students: "Student",
  grades: "Grade",
  classLog: "Class record",
  classSchedules: "Class schedule",
  scheduleExceptions: "Class change",
  scheduleChanges: "Schedule change",
};

const FIELD_LABELS = {
  fullName: "Name",
  name: "Name",
  code: "Student code",
  phone: "Phone",
  guardianPhone: "Guardian phone",
  guardianContact: "Guardian",
  studentEmail: "Email",
  notes: "Notes",
  status: "Status",
  groupIds: "Groups",
  isIndividual: "Individual classes",
  customHourlyRate: "Custom hourly rate",
  monthlyPayments: "Monthly payments",
  lostPayments: "Lost payments",
  billingByGroup: "Billing",
  avatarId: "Avatar",
  iconId: "Group icon",
  colorId: "Group color",
  schedule: "Schedule",
  scheduleHistory: "Schedule history",
  classDate: "Class date",
  startTime: "Start time",
  hours: "Hours",
  classTitle: "Class title",
  classStatus: "Class status",
  attendance: "Attendance",
  appliedHourlyRate: "Hourly rate",
  appliedCharge: "Charge",
  amountPaid: "Amount paid",
  paymentState: "Payment status",
  paymentDate: "Payment date",
  paymentMethod: "Payment method",
  paymentReference: "Payment reference",
  date: "Date",
  assessment: "Assessment",
  category: "Category",
  score: "Score",
  maxScore: "Maximum score",
  workStatus: "Work status",
  feedback: "Feedback",
  hourlyRate: "Hourly rate",
  currency: "Currency",
  defaultClassHours: "Default class hours",
  recentProjectionWeeks: "Projection weeks",
  lowGradeThreshold: "Low grade threshold",
  lowAttendanceThreshold: "Low attendance threshold",
  startDate: "Start date",
  endDate: "End date",
  durationHours: "Duration (hours)",
  daysOfWeek: "Days of the week",
  intervalWeeks: "Repeat every (weeks)",
  participantIds: "Participants",
  occurrenceDate: "Original date",
  effectiveFrom: "Effective from",
  dayOfWeek: "Day of the week",
};

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

// A student's money is shown one element per line (the review narrows it to the elements involved).
const MONEY_FIELDS = new Set(["monthlyPayments", "lostPayments", "billingByGroup"]);
const ADJUSTMENT_LABELS = { group: "Group fee", perClass: "Per class" };

function recordFor(state, collection, entityId) {
  if (!state) return null;
  if (collection === "settings") return state.settings || null;
  return (state[collection] || []).find((item) => String(item.id) === String(entityId)) || null;
}

function namesById(entry) {
  const names = new Map();
  for (const state of [entry.mutation?.previousState, entry.mutation?.state]) {
    for (const student of state?.students || []) names.set(String(student.id), student.fullName || student.code);
    for (const group of state?.groups || []) names.set(String(group.id), group.name);
  }
  return names;
}

function classDatesById(entry) {
  const dates = new Map();
  for (const state of [entry.mutation?.previousState, entry.mutation?.state])
    for (const row of state?.classLog || []) dates.set(String(row.id), row.classDate);
  return dates;
}

export function PendingOperations({ persistence }) {
  const { t, locale } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const entries = persistence?.pendingOperations || [];
  if (!entries.length) return null;
  const conflicts = entries.filter((entry) => entry.status === "conflict");
  const waiting = entries.length - conflicts.length;

  const formatDate = (value) => {
    const date = new Date(DATE_ONLY.test(value) ? `${value}T12:00:00` : value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat(
      locale,
      DATE_ONLY.test(value)
        ? { dateStyle: "medium" }
        : {
            dateStyle: "medium",
            timeStyle: "short",
          },
    ).format(date);
  };

  const monthOf = (period) => formatMonthYear(`${period}-01`, locale) || String(period);
  // Inside a sentence Spanish writes the month in lowercase («desde noviembre 2026»).
  const monthInText = (period) => {
    const text = monthOf(period);
    return String(locale).toLowerCase().startsWith("es") ? text.toLowerCase() : text;
  };

  // «Octubre 2026 · Grupo · $1,000 · 13 nov 2026», one receipt, debt or group per line.
  const formatMoneyValue = (field, value, names, classDates) => {
    if (field === "monthlyPayments")
      return (Array.isArray(value) ? value : [])
        .map((item) =>
          [
            monthOf(item.period),
            names.get(String(item.groupId)),
            formatMoney(item.amount, locale),
            formatDate(item.paidAt),
          ]
            .filter(Boolean)
            .join(" · "),
        )
        .join("\n");
    if (field === "lostPayments")
      return (Array.isArray(value) ? value : [])
        .map((mark) =>
          mark.kind === "class"
            ? [t("Class"), classDates.get(String(mark.classId)) ? formatDate(classDates.get(String(mark.classId))) : ""]
                .filter(Boolean)
                .join(" · ")
            : [monthOf(mark.period), names.get(String(mark.groupId))].filter(Boolean).join(" · "),
        )
        .join("\n");
    return Object.entries(value || {})
      .map(([groupId, override]) => {
        const parts = [
          override.mode === "customFee"
            ? t("Other fee {amount}", { amount: formatMoney(override.fee, locale) })
            : t(ADJUSTMENT_LABELS[override.mode] || "Group fee"),
        ];
        if (override.effectiveFrom) parts.push(t("from {month}", { month: monthInText(override.effectiveFrom) }));
        if (override.joinedOn) parts.push(t("joined {date}", { date: formatDate(override.joinedOn) }));
        if (override.leftOn) parts.push(t("left {date}", { date: formatDate(override.leftOn) }));
        for (const stretch of override.away || [])
          parts.push(t("away {from} – {to}", { from: formatDate(stretch.from), to: formatDate(stretch.to) }));
        return `${names.get(String(groupId)) || t("Unnamed group")}: ${parts.join(" · ")}`;
      })
      .join("\n");
  };

  const formatValue = (value, names, field = "", classDates = new Map()) => {
    if (value === undefined || value === null || value === "") return "—";
    if (MONEY_FIELDS.has(field) && typeof value === "object") return formatMoneyValue(field, value, names, classDates);
    if (typeof value === "boolean") return value ? t("Yes") : t("No");
    if (typeof value === "number") return new Intl.NumberFormat(locale).format(value);
    if (Array.isArray(value))
      return value.length ? value.map((item) => names.get(String(item)) || String(item)).join(", ") : "—";
    if (typeof value === "string") return DATE_ONLY.test(value) ? formatDate(value) : names.get(value) || value;
    return JSON.stringify(value);
  };

  const recordLabel = (entry, change, names) => {
    const record =
      change.local ||
      change.before ||
      change.cloud ||
      recordFor(entry.mutation?.state, change.collection, change.entityId);
    if (change.collection === "settings") return t("Workspace settings");
    if (change.collection === "students") return record?.fullName || record?.code || t("Unnamed student");
    if (change.collection === "groups") return record?.name || t("Unnamed group");
    if (change.collection === "grades")
      return (
        [record?.assessment, names.get(String(record?.studentId))].filter(Boolean).join(" · ") || t("Untitled record")
      );
    const date = record?.classDate || record?.occurrenceDate || record?.startDate || record?.effectiveFrom;
    const owner = names.get(String(record?.studentId)) || names.get(String(record?.groupId));
    return [date ? formatDate(date) : "", record?.startTime, owner].filter(Boolean).join(" · ") || t("Untitled record");
  };

  // Rows to compare: for a deletion, only what the other device edited.
  const rowsFor = (change) => {
    // The same class saved on two devices: compare this device's record with the cloud's.
    if (change.conflict === "duplicate") return change.fields;
    if (change.kind === "create") return [];
    if (change.kind === "delete") {
      if (!change.cloud) return [];
      return change.fields
        .filter((field) => JSON.stringify(field.before ?? null) !== JSON.stringify(field.cloud ?? null))
        .map((field) => ({ ...field, conflict: true }));
    }
    return change.fields;
  };

  const sideValue = (record, value, names, field, classDates) => {
    if (record === null) return t("Deleted");
    if (record === undefined) return t("Not available");
    return formatValue(value, names, field, classDates);
  };

  const resolve = async (id, choice) => {
    setBusy(true);
    setError("");
    try {
      await persistence.resolvePendingOperation(id, choice);
    } catch (caught) {
      setError(caught?.message || t("This change could not be resolved. Try again."));
    } finally {
      setBusy(false);
    }
  };

  // Ordinary waiting is a quiet status, not a review. It is only shown while
  // the device cannot reach the cloud; online changes sync within moments.
  if (!conflicts.length) {
    if (persistence.connectionStatus === "connected" && globalThis.navigator?.onLine !== false) return null;
    return (
      <p className="pending-operations-note" role="status">
        <CloudOff aria-hidden="true" size={16} />
        <span>
          {waiting === 1
            ? t("1 change is saved on this device and will sync when the connection returns.")
            : t("{p0} changes are saved on this device and will sync when the connection returns.", { p0: waiting })}
        </span>
      </p>
    );
  }

  return (
    <section className="pending-operations" aria-labelledby="pending-operations-title">
      <div className="pending-operations-heading">
        <AlertTriangle aria-hidden="true" size={20} />
        <div>
          <h2 id="pending-operations-title">
            {conflicts.length === 1
              ? t("1 change needs your review")
              : t("{p0} changes need your review", { p0: conflicts.length })}
          </h2>
          <p>
            {t(
              "Another device changed the same information. Compare the values and choose which one to keep. Changes to other records keep syncing.",
            )}
          </p>
        </div>
      </div>
      {error ? (
        <p className="pending-operations-error" role="alert">
          {t(error)}
        </p>
      ) : null}
      <ul className="pending-operations-list">
        {conflicts.map((entry) => {
          const names = namesById(entry);
          const classDates = classDatesById(entry);
          const changes = entry.review?.changes || [];
          return (
            <li key={entry.id} className="pending-conflict">
              <p className="pending-conflict-meta">
                {t("Saved on this device")} · {formatDate(entry.createdAt)}
              </p>
              {changes.map((change) => (
                <article key={`${change.collection}/${change.entityId}`} className="pending-conflict-record">
                  <h3>
                    {t(COLLECTION_LABELS[change.collection] || "Other record")}: {recordLabel(entry, change, names)}
                  </h3>
                  {change.conflict === "duplicate" ? (
                    <p className="pending-conflict-note">
                      {t(
                        "Another device saved this same class for this student. Keep this device's values or the cloud's: only one record stays.",
                      )}
                    </p>
                  ) : change.conflict === "delete-edit" ? (
                    <p className="pending-conflict-note">
                      {t("This device deleted this record, but another device edited it.")}
                    </p>
                  ) : change.conflict === "edit-delete" ? (
                    <p className="pending-conflict-note">
                      {t("This device edited this record, but another device deleted it.")}
                    </p>
                  ) : change.kind === "delete" ? (
                    <p className="pending-conflict-note">{t("This device deleted this record.")}</p>
                  ) : change.kind === "create" ? (
                    <p className="pending-conflict-note">{t("This device added this record.")}</p>
                  ) : null}
                  {rowsFor(change).length ? (
                    <div className="pending-conflict-table">
                      <table>
                        <thead>
                          <tr>
                            <th scope="col">{t("Field")}</th>
                            <th scope="col">{t("Before")}</th>
                            <th scope="col">{t("This device")}</th>
                            <th scope="col">{t("Cloud now")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rowsFor(change).map((field) => {
                            const list = MONEY_FIELDS.has(field.field) ? "is-list" : undefined;
                            return (
                              <tr key={field.field} className={field.conflict ? "is-conflict" : undefined}>
                                <th scope="row">
                                  {t(FIELD_LABELS[field.field] || field.field)}
                                  {field.conflict ? (
                                    <span className="pending-conflict-badge">{t("Different values")}</span>
                                  ) : null}
                                </th>
                                <td className={list}>
                                  {change.before === null
                                    ? "—"
                                    : formatValue(field.before, names, field.field, classDates)}
                                </td>
                                <td className={list}>
                                  {sideValue(change.local, field.local, names, field.field, classDates)}
                                </td>
                                <td className={list}>
                                  {sideValue(change.cloud, field.cloud, names, field.field, classDates)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                </article>
              ))}
              <p className="pending-conflict-hint">
                {t(
                  "Keep this device's version to replace the highlighted cloud values. Discard it to keep the cloud version; nothing else is removed.",
                )}
              </p>
              <div className="pending-conflict-actions">
                <Button variant="primary" disabled={busy} onClick={() => void resolve(entry.id, "local")}>
                  {t("Keep this device's version")}
                </Button>
                <Button disabled={busy} onClick={() => void resolve(entry.id, "discard")}>
                  {t("Discard this device's change")}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      {waiting ? (
        <p className="pending-operations-waiting">
          {waiting === 1
            ? t("1 more change is safe on this device and will sync automatically.")
            : t("{p0} more changes are safe on this device and will sync automatically.", { p0: waiting })}
        </p>
      ) : null}
      <Button icon={RefreshCw} disabled={busy} onClick={() => void persistence.retrySync()}>
        {t("Retry synchronization")}
      </Button>
    </section>
  );
}

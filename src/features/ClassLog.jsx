import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  Check,
  CircleDollarSign,
  CreditCard,
  History,
  Pencil,
  Plus,
  Save,
  Trash2,
  Users,
} from "lucide-react";
import {
  Button,
  ConfirmDialog,
  Drawer,
  EmptyState,
  Field,
  IconButton,
  Input,
  SearchInput,
  Select,
  StatusBadge,
  TableShell,
  Tabs,
  TextArea,
} from "../components/ui";
import { StudentAvatar } from "../components/StudentAvatar";
import {
  ATTENDANCE_CODES,
  CLASS_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
} from "../domain/constants";
import { addDays, isDateOnly, todayDateOnly } from "../domain/dates";
import { useHistoryBackedState } from "../hooks/useHistoryNavigation";
import { confirmDiscard, draftChanged, useUnsavedChanges } from "../hooks/useUnsavedChanges";
import { normalizeSearchText } from "../utils/searchText";
import { getUiLocale, useI18n } from "../i18n";
import "./class-log-mobile.css";

const ATTENDANCE_LABELS = Object.freeze({
  P: "Present",
  A: "Absent",
  L: "Late",
  E: "Excused",
});
const UNASSIGNED_GROUP = "__unassigned__";

const BLOCKING_PAYMENT_STATUSES = new Set([
  PAYMENT_STATUSES.UNKNOWN_STUDENT,
  PAYMENT_STATUSES.REVIEW_CANCELLED,
  PAYMENT_STATUSES.REVIEW_NO_CHARGE,
  PAYMENT_STATUSES.DATE_NEEDED,
  PAYMENT_STATUSES.AMOUNT_NEEDED,
  PAYMENT_STATUSES.FUTURE_PAYMENT_DATE,
]);

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value);
  return [];
}

function nullableNumber(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function effectiveNumber(value, fallback = 0) {
  const number = nullableNumber(value);
  return number === null ? fallback : number;
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function safeToday() {
  return todayDateOnly();
}

function resolveAsOfDate(asOfDate, state) {
  const candidates = [asOfDate, state?.settings?.asOfDate, state?.preferences?.asOfDate];
  return candidates.find(isDateOnly) || safeToday();
}

function mapLookup(mapLike, key) {
  if (!key || !mapLike) return undefined;
  if (mapLike instanceof Map) return mapLike.get(key);
  return mapLike[key];
}

function studentGroupIds(student) {
  if (Array.isArray(student?.groupIds)) return student.groupIds;
  return student?.groupId ? [student.groupId] : [];
}

function studentGroupId(row, student) {
  return row.groupId || studentGroupIds(student)[0] || "";
}

/** Mirrors the calculated columns in the minimal workbook's Class Log sheet. */
function calculateClassLogRow(record, context) {
  const { asOfDate, defaultHours, hourlyRate, studentsById, groupsById } = context;
  const student = mapLookup(studentsById, record.studentId);
  const groupId = studentGroupId(record, student);
  const group = mapLookup(groupsById, groupId);
  const hasRequiredKey = Boolean(record.classDate && record.studentId);
  const hours = effectiveNumber(record.hours, defaultHours);
  const amountPaid = effectiveNumber(record.amountPaid, 0);
  const charge = hasRequiredKey && record.classStatus
    ? roundMoney(record.classStatus === "Cancelled" ? 0 : hours * hourlyRate)
    : 0;

  let paymentStatus = "";
  if (hasRequiredKey) {
    if (!student) paymentStatus = PAYMENT_STATUSES.UNKNOWN_STUDENT;
    else if (record.classStatus === "Cancelled") {
      paymentStatus = amountPaid > 0 ? PAYMENT_STATUSES.REVIEW_CANCELLED : PAYMENT_STATUSES.CANCELLED;
    } else if (charge === 0) {
      paymentStatus = amountPaid > 0 ? PAYMENT_STATUSES.REVIEW_NO_CHARGE : PAYMENT_STATUSES.NO_CHARGE;
    } else if (amountPaid > 0 && !record.paymentDate) {
      paymentStatus = PAYMENT_STATUSES.DATE_NEEDED;
    } else if (record.paymentDate && amountPaid === 0) {
      paymentStatus = PAYMENT_STATUSES.AMOUNT_NEEDED;
    } else if (record.paymentDate && record.paymentDate > asOfDate) {
      paymentStatus = PAYMENT_STATUSES.FUTURE_PAYMENT_DATE;
    } else if (amountPaid === 0) {
      paymentStatus = record.classDate > asOfDate
        ? PAYMENT_STATUSES.SCHEDULED
        : PAYMENT_STATUSES.PENDING;
    } else if (amountPaid < charge) paymentStatus = PAYMENT_STATUSES.PARTIAL;
    else if (amountPaid > charge) paymentStatus = PAYMENT_STATUSES.OVERPAID;
    else if (record.paymentDate < record.classDate || record.classDate > asOfDate) {
      paymentStatus = PAYMENT_STATUSES.PAID_IN_ADVANCE;
    } else paymentStatus = PAYMENT_STATUSES.PAID;
  }

  const amountRecognized = record.paymentDate && record.paymentDate <= asOfDate ? amountPaid : 0;
  const outstanding = !hasRequiredKey || !student || record.classDate > asOfDate
    || record.classStatus === "Cancelled" || charge === 0
    ? 0
    : roundMoney(Math.max(charge - amountRecognized, 0));

  return {
    ...record,
    student,
    studentName: record.studentName || student?.fullName || "Unknown student",
    studentCode: student?.studentCode || student?.code || record.studentCode || "",
    groupId,
    groupName: record.groupName || group?.name || "Unassigned",
    effectiveHours: hours,
    charge,
    amountPaid,
    paymentStatus,
    outstanding,
    overpaid: roundMoney(Math.max(amountPaid - charge, 0)),
  };
}

function attendanceTone(code) {
  if (code === "P") return "success";
  if (code === "L") return "warning";
  if (code === "A") return "danger";
  if (code === "E") return "info";
  return "neutral";
}

function paymentTone(status) {
  if (status === PAYMENT_STATUSES.PAID) return "success";
  if (status === PAYMENT_STATUSES.PAID_IN_ADVANCE) return "info";
  if (status === PAYMENT_STATUSES.PARTIAL || status === PAYMENT_STATUSES.SCHEDULED) return "warning";
  if (status === PAYMENT_STATUSES.CANCELLED || status === PAYMENT_STATUSES.NO_CHARGE) return "neutral";
  if (status === PAYMENT_STATUSES.PENDING || status === PAYMENT_STATUSES.OVERPAID) return "danger";
  if (BLOCKING_PAYMENT_STATUSES.has(status)) return "danger";
  return "neutral";
}

function classStatusTone(status) {
  if (status === "Completed") return "success";
  if (status === "Scheduled") return "info";
  if (status === "Cancelled") return "neutral";
  return "neutral";
}

function makeRosterDraft(classStatus = "Completed") {
  return {
    attendance: classStatus === "Completed" ? "P" : "",
    hours: "",
    amountPaid: "",
    paymentDate: "",
    paymentMethod: "",
    paymentReference: "",
    notes: "",
  };
}

function makeAdvanceDraft(asOfDate, defaultHours, hourlyRate) {
  const firstDate = addDays(asOfDate, 7);
  return {
    studentId: "",
    paymentDate: asOfDate,
    paymentMethod: "Cash",
    paymentReference: `ADV-${asOfDate.replaceAll("-", "")}`,
    notes: "",
    entries: [{
      key: `${firstDate}-0`,
      classDate: firstDate,
      hours: defaultHours,
      amountPaid: roundMoney(defaultHours * hourlyRate),
    }],
  };
}

function persistedRecord(record) {
  return {
    ...(record.id ? { id: record.id } : {}),
    classDate: record.classDate || "",
    studentId: record.studentId || "",
    classStatus: record.classStatus || "Completed",
    attendance: record.attendance || "",
    hours: nullableNumber(record.hours),
    amountPaid: nullableNumber(record.amountPaid),
    paymentDate: record.paymentDate || null,
    paymentMethod: record.paymentMethod || "",
    paymentReference: String(record.paymentReference || "").trim(),
    notes: String(record.notes || "").trim(),
  };
}

function SummaryLine({ label, value, strong = false, tone = "" }) {
  return (
    <div className={`summary-line ${strong ? "is-strong" : ""} ${tone ? `text-${tone}` : ""}`.trim()}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function AttendanceSelect({ value, onChange, label, disabled = false }) {
  return (
    <Select
      className={`attendance-picker attendance-control attendance-${String(ATTENDANCE_LABELS[value] || "none").toLowerCase()}`}
      value={value || ""}
      onChange={(event) => onChange(event.target.value)}
      aria-label={label}
      disabled={disabled}
    >
      <option value="">—</option>
      {ATTENDANCE_CODES.map((code) => (
        <option value={code} key={code}>{ATTENDANCE_LABELS[code]} ({code})</option>
      ))}
    </Select>
  );
}

function ClassControls({ value, groups, hasIndividualStudents, onChange, onAdvance, onSave, saving, canSave }) {
  return (
    <section className="panel class-controls" aria-label="Class details">
      <div className="form-grid class-control-grid">
        <Field label="Class date" required>
          <Input
            type="date"
            value={value.classDate}
            onChange={(event) => onChange("classDate", event.target.value)}
          />
        </Field>
        <Field label="Group" required>
          <Select value={value.groupId} onChange={(event) => onChange("groupId", event.target.value)}>
            <option value="">Choose a group</option>
            {groups.map((group) => <option value={group.id} key={group.id}>{group.name}</option>)}
            {hasIndividualStudents ? <option value={UNASSIGNED_GROUP}>Individual students</option> : null}
          </Select>
        </Field>
        <Field label="Class status" required>
          <Select value={value.classStatus} onChange={(event) => onChange("classStatus", event.target.value)}>
            {CLASS_STATUSES.map((status) => <option value={status} key={status}>{status}</option>)}
          </Select>
        </Field>
        <Field label="Hours" required>
          <Input
            type="number"
            min="0"
            step="0.25"
            value={value.hours}
            onChange={(event) => onChange("hours", event.target.value)}
          />
        </Field>
      </div>
      <div className="class-control-actions">
        <Button icon={CreditCard} onClick={onAdvance}>Advance payment</Button>
        <Button variant="primary" icon={Save} onClick={onSave} disabled={!canSave || saving}>
          {saving ? "Saving…" : "Save class"}
        </Button>
      </div>
    </section>
  );
}

function MobileRosterCards({ rows, classStatus, currency, onChange }) {
  return (
    <section className="mobile-roster-cards" aria-label="Class roster">
      {rows.map((row) => {
        const attendanceDisabled = classStatus !== "Completed";
        const hasMoreDetails = Boolean(row.draft.paymentReference || row.draft.notes);

        return (
          <article className="mobile-roster-card" key={row.studentId}>
            <header className="mobile-roster-card-header">
              <div className="mobile-student-identity">
                <StudentAvatar avatarId={row.avatarId} name={row.studentName} size="tiny" decorative />
                <span className="mobile-student-copy">
                  <strong>{row.studentName}</strong>
                  <span>{row.studentCode || "No ID"}</span>
                </span>
              </div>
              <StatusBadge tone={paymentTone(row.paymentStatus)}>
                {row.paymentStatus || "—"}
              </StatusBadge>
            </header>

            <div className="mobile-roster-field-grid mobile-roster-attendance-grid">
              <Field label="Attendance">
                <AttendanceSelect
                  value={row.draft.attendance}
                  onChange={(next) => onChange(row.studentId, "attendance", next)}
                  label={`Attendance for ${row.studentName}`}
                  disabled={attendanceDisabled}
                />
              </Field>
              <Field label="Hours">
                <Input
                  type="number"
                  min="0"
                  step="0.25"
                  inputMode="decimal"
                  value={row.draft.hours}
                  placeholder={String(row.effectiveHours)}
                  onChange={(event) => onChange(row.studentId, "hours", event.target.value)}
                  aria-label={`Hours for ${row.studentName}; blank uses the class default`}
                />
              </Field>
            </div>

            <dl className="mobile-roster-money-summary">
              <div>
                <dt>Charge</dt>
                <dd>{currency(row.charge)}</dd>
              </div>
              <div className={row.outstanding ? "has-outstanding" : ""}>
                <dt>Outstanding</dt>
                <dd>{currency(row.outstanding)}</dd>
              </div>
            </dl>

            <div className="mobile-roster-field-grid mobile-roster-payment-grid">
              <Field label="Amount paid">
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={row.draft.amountPaid}
                  onChange={(event) => onChange(row.studentId, "amountPaid", event.target.value)}
                  aria-label={`Amount paid by ${row.studentName}`}
                />
              </Field>
              <Field label="Payment date">
                <Input
                  type="date"
                  value={row.draft.paymentDate}
                  onChange={(event) => onChange(row.studentId, "paymentDate", event.target.value)}
                  aria-label={`Payment date for ${row.studentName}`}
                />
              </Field>
              <Field label="Method" className="mobile-payment-method">
                <Select
                  value={row.draft.paymentMethod}
                  onChange={(event) => onChange(row.studentId, "paymentMethod", event.target.value)}
                  aria-label={`Payment method for ${row.studentName}`}
                >
                  <option value="">—</option>
                  {PAYMENT_METHODS.map((method) => <option value={method} key={method}>{method}</option>)}
                </Select>
              </Field>
            </div>

            <details className="mobile-roster-details">
              <summary>
                <span>More details</span>
                <span className="mobile-details-hint">
                  {hasMoreDetails ? "Added" : "Reference and notes"}
                </span>
              </summary>
              <div className="mobile-roster-detail-fields">
                <Field label="Reference">
                  <Input
                    value={row.draft.paymentReference}
                    onChange={(event) => onChange(row.studentId, "paymentReference", event.target.value)}
                    aria-label={`Payment reference for ${row.studentName}`}
                    placeholder="Optional"
                  />
                </Field>
                <Field label="Notes">
                  <TextArea
                    rows="2"
                    value={row.draft.notes}
                    onChange={(event) => onChange(row.studentId, "notes", event.target.value)}
                    aria-label={`Notes for ${row.studentName}`}
                    placeholder="Optional"
                  />
                </Field>
              </div>
            </details>
          </article>
        );
      })}
    </section>
  );
}

function RosterTable({ rows, classStatus, currency, onChange, groupSelected = false, onGoToSetup }) {
  if (!rows.length) {
    return (
      <EmptyState
        icon={Users}
        title={groupSelected ? "This group has no active students" : "Choose a group to load its roster"}
        description={groupSelected
          ? "Add a student to this group in Students, then return here to record the class."
          : "Only active students are included. You can manage enrollment from Students."}
        action={groupSelected && onGoToSetup
          ? <Button variant="primary" onClick={onGoToSetup}>Go to Students</Button>
          : null}
      />
    );
  }

  return (
    <>
      <TableShell label="Class roster" className="roster-table-shell">
        <table className="roster-table">
        <thead>
          <tr>
            <th scope="col" className="sticky-cell">Student</th>
            <th scope="col">Attendance</th>
            <th scope="col" className="numeric number-cell">Charge</th>
            <th scope="col">Amount paid</th>
            <th scope="col">Payment date</th>
            <th scope="col">Method</th>
            <th scope="col">Payment status</th>
            <th scope="col" className="numeric number-cell">Outstanding</th>
            <th scope="col">Reference</th>
            <th scope="col">Notes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const attendanceDisabled = classStatus !== "Completed";
            return (
              <tr key={row.studentId}>
                <th scope="row" className="sticky-cell">
                  <div className="person-cell student-cell">
                    <StudentAvatar avatarId={row.avatarId} name={row.studentName} size="tiny" decorative />
                    <span className="student-cell-copy">
                      <strong>{row.studentName}</strong>
                      <span>{row.studentCode || "No ID"}</span>
                      <label className="hours-exception">
                        <span>Hours</span>
                        <Input
                          type="number"
                          min="0"
                          step="0.25"
                          value={row.draft.hours}
                          placeholder={String(row.effectiveHours)}
                          onChange={(event) => onChange(row.studentId, "hours", event.target.value)}
                          aria-label={`Hours for ${row.studentName}; blank uses the class default`}
                        />
                      </label>
                    </span>
                  </div>
                </th>
                <td>
                  <AttendanceSelect
                    value={row.draft.attendance}
                    onChange={(next) => onChange(row.studentId, "attendance", next)}
                    label={`Attendance for ${row.studentName}`}
                    disabled={attendanceDisabled}
                  />
                </td>
                <td className="numeric number-cell money-cell">{currency(row.charge)}</td>
                <td>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={row.draft.amountPaid}
                    onChange={(event) => onChange(row.studentId, "amountPaid", event.target.value)}
                    aria-label={`Amount paid by ${row.studentName}`}
                  />
                </td>
                <td>
                  <Input
                    type="date"
                    value={row.draft.paymentDate}
                    onChange={(event) => onChange(row.studentId, "paymentDate", event.target.value)}
                    aria-label={`Payment date for ${row.studentName}`}
                  />
                </td>
                <td>
                  <Select
                    value={row.draft.paymentMethod}
                    onChange={(event) => onChange(row.studentId, "paymentMethod", event.target.value)}
                    aria-label={`Payment method for ${row.studentName}`}
                  >
                    <option value="">—</option>
                    {PAYMENT_METHODS.map((method) => <option value={method} key={method}>{method}</option>)}
                  </Select>
                </td>
                <td><StatusBadge tone={paymentTone(row.paymentStatus)}>{row.paymentStatus || "—"}</StatusBadge></td>
                <td className="numeric number-cell money-cell">{currency(row.outstanding)}</td>
                <td>
                  <Input
                    value={row.draft.paymentReference}
                    onChange={(event) => onChange(row.studentId, "paymentReference", event.target.value)}
                    aria-label={`Payment reference for ${row.studentName}`}
                    placeholder="Optional"
                  />
                </td>
                <td>
                  <Input
                    value={row.draft.notes}
                    onChange={(event) => onChange(row.studentId, "notes", event.target.value)}
                    aria-label={`Notes for ${row.studentName}`}
                    placeholder="Optional"
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
        </table>
      </TableShell>
      <MobileRosterCards
        rows={rows}
        classStatus={classStatus}
        currency={currency}
        onChange={onChange}
      />
    </>
  );
}

function ReviewPanel({ classDraft, selectedGroup, rows, summary, issues, currency, saving, onSave }) {
  const attendanceItems = ["P", "L", "E", "A"];
  return (
    <aside className="review-card panel" aria-labelledby="review-heading">
      <div className="panel-header">
        <div>
          <h2 id="review-heading">Review before saving</h2>
          <p>One row will be saved per student.</p>
        </div>
      </div>

      <div className="review-facts">
        <SummaryLine label="Class date" value={classDraft.classDate || "—"} />
        <SummaryLine label="Group" value={selectedGroup?.name || "—"} />
        <SummaryLine
          label="Status"
          value={<StatusBadge tone={classStatusTone(classDraft.classStatus)}>{classDraft.classStatus}</StatusBadge>}
        />
        <SummaryLine label="Hours" value={`${effectiveNumber(classDraft.hours, 0)} hr`} />
        <SummaryLine label="Students" value={rows.length} />
      </div>

      <section className="review-section" aria-labelledby="attendance-summary-heading">
        <h3 id="attendance-summary-heading">Attendance summary</h3>
        {attendanceItems.map((code) => (
          <div className="legend-line" key={code}>
            <span><i className={`legend-dot tone-${attendanceTone(code)}`} />{ATTENDANCE_LABELS[code]}</span>
            <strong>{summary.attendance[code] || 0}</strong>
          </div>
        ))}
      </section>

      <section className="review-section" aria-labelledby="payment-summary-heading">
        <h3 id="payment-summary-heading">Payment summary</h3>
        <SummaryLine label="Total charges" value={currency(summary.charges)} />
        <SummaryLine label="Cash received" value={currency(summary.cash)} />
        <SummaryLine label="Other payments" value={currency(summary.otherPayments)} />
        <SummaryLine label="Total paid" value={currency(summary.paid)} strong />
        <SummaryLine label="Outstanding" value={currency(summary.outstanding)} tone={summary.outstanding ? "danger" : ""} />
        <SummaryLine label="Overpaid" value={currency(summary.overpaid)} tone={summary.overpaid ? "purple" : ""} />
      </section>

      <section className="review-section" aria-labelledby="validation-heading">
        <h3 id="validation-heading">Validation</h3>
        <div className="validation-list">
          {issues.length ? issues.map((issue) => (
            <div className={`validation-banner validation-${issue.blocking ? "error" : "warning"}`} key={issue.key}>
              <AlertTriangle aria-hidden="true" size={17} />
              <span>{issue.message}</span>
            </div>
          )) : (
            <div className="validation-banner validation-success">
              <Check aria-hidden="true" size={17} />
              <span>Ready to save.</span>
            </div>
          )}
        </div>
      </section>

      <Button
        className="review-save-button"
        variant="primary"
        icon={Save}
        onClick={onSave}
        disabled={saving || !rows.length || issues.some((issue) => issue.blocking)}
      >
        {saving ? "Saving…" : "Save class"}
      </Button>
    </aside>
  );
}

function AdvancePaymentDrawer({ open, onClose, students, groupsById, existingRows = [], draft, setDraft, defaultHours, hourlyRate, asOfDate, currency, onSave, saving }) {
  const { t } = useI18n();
  const selectedStudent = students.find((student) => student.id === draft.studentId);
  const selectedGroup = mapLookup(groupsById, studentGroupIds(selectedStudent)[0]);
  const duplicateDates = draft.entries.filter((entry, index, all) => all.findIndex((item) => item.classDate === entry.classDate) !== index);
  const existingDates = draft.entries.filter((entry) => existingRows.some((row) => (
    row.studentId === draft.studentId && row.classDate === entry.classDate
  )));
  const invalidEntries = draft.entries.filter((entry) => (
    !isDateOnly(entry.classDate)
    || entry.classDate <= asOfDate
    || effectiveNumber(entry.hours, -1) < 0
    || effectiveNumber(entry.amountPaid, -1) <= 0
  ));
  const valid = Boolean(
    selectedStudent
    && isDateOnly(draft.paymentDate)
    && draft.paymentDate <= asOfDate
    && draft.paymentMethod
    && draft.paymentReference.trim()
    && draft.entries.length
    && !duplicateDates.length
    && !existingDates.length
    && !invalidEntries.length
  );
  const total = draft.entries.reduce((sum, entry) => sum + effectiveNumber(entry.amountPaid, 0), 0);

  const updateEntry = (key, field, value) => {
    setDraft((current) => ({
      ...current,
      entries: current.entries.map((entry) => {
        if (entry.key !== key) return entry;
        const next = { ...entry, [field]: value };
        if (field === "hours") next.amountPaid = roundMoney(effectiveNumber(value, 0) * hourlyRate);
        return next;
      }),
    }));
  };

  const addEntry = () => {
    setDraft((current) => {
      const lastDate = current.entries.at(-1)?.classDate;
      const nextDate = isDateOnly(lastDate) ? addDays(lastDate, 7) : addDays(asOfDate, 7);
      return {
        ...current,
        entries: [...current.entries, {
          key: `${nextDate}-${Date.now()}`,
          classDate: nextDate,
          hours: defaultHours,
          amountPaid: roundMoney(defaultHours * hourlyRate),
        }],
      };
    });
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Record an advance payment"
      description="Create one scheduled row per future class. Every row will share the same payment reference."
      size="wide"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={CreditCard} onClick={onSave} disabled={!valid || saving}>
            {saving ? "Saving…" : `Save ${draft.entries.length} future ${draft.entries.length === 1 ? "class" : "classes"}`}
          </Button>
        </>
      }
    >
      <div className="drawer-form">
        <div className="form-grid form-grid-2 two-columns">
          <Field label="Student" required>
            <Select value={draft.studentId} onChange={(event) => setDraft((current) => ({ ...current, studentId: event.target.value }))}>
              <option value="">Choose a student</option>
              {students.map((student) => <option key={student.id} value={student.id}>{student.fullName}</option>)}
            </Select>
          </Field>
          <Field label="Group">
            <Input value={selectedGroup?.name || t("Unassigned")} readOnly />
          </Field>
          <Field label="Payment date" required>
            <Input type="date" max={asOfDate} value={draft.paymentDate} onChange={(event) => setDraft((current) => ({ ...current, paymentDate: event.target.value }))} />
          </Field>
          <Field label="Method" required>
            <Select value={draft.paymentMethod} onChange={(event) => setDraft((current) => ({ ...current, paymentMethod: event.target.value }))}>
              <option value="">Choose a method</option>
              {PAYMENT_METHODS.map((method) => <option key={method} value={method}>{method}</option>)}
            </Select>
          </Field>
          <Field label="Shared payment reference" required hint="Use the same receipt or transfer reference for every future class.">
            <Input value={draft.paymentReference} onChange={(event) => setDraft((current) => ({ ...current, paymentReference: event.target.value }))} />
          </Field>
          <Field label="Notes">
            <Input value={draft.notes} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} placeholder="Optional" />
          </Field>
        </div>

        <section className="advance-classes" aria-labelledby="future-classes-heading">
          <div className="panel-header">
            <div>
              <h3 id="future-classes-heading">Future classes</h3>
              <p>Dates must be after {asOfDate}. Amounts are allocated per class.</p>
            </div>
            <Button icon={Plus} onClick={addEntry}>Add class</Button>
          </div>
          <TableShell label="Future classes">
            <table className="data-table">
              <thead><tr><th scope="col">Class date</th><th scope="col">Hours</th><th scope="col">Allocated payment</th><th scope="col" className="numeric number-cell">Charge</th><th scope="col"><span className="sr-only">Remove</span></th></tr></thead>
              <tbody>
                {draft.entries.map((entry) => {
                  const charge = roundMoney(effectiveNumber(entry.hours, 0) * hourlyRate);
                  return (
                    <tr key={entry.key}>
                      <td><Input type="date" min={addDays(asOfDate, 1)} value={entry.classDate} onChange={(event) => updateEntry(entry.key, "classDate", event.target.value)} aria-label="Future class date" /></td>
                      <td><Input type="number" min="0" step="0.25" value={entry.hours} onChange={(event) => updateEntry(entry.key, "hours", event.target.value)} aria-label={`Hours for ${entry.classDate || "future class"}`} /></td>
                      <td><Input type="number" min="0.01" step="0.01" value={entry.amountPaid} onChange={(event) => updateEntry(entry.key, "amountPaid", event.target.value)} aria-label={`Allocated payment for ${entry.classDate || "future class"}`} /></td>
                      <td className="numeric number-cell money-cell">{currency(charge)}</td>
                      <td><IconButton label="Remove future class" icon={Trash2} disabled={draft.entries.length === 1} onClick={() => setDraft((current) => ({ ...current, entries: current.entries.filter((item) => item.key !== entry.key) }))} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableShell>
          <div className="advance-total"><span>Total received</span><strong>{currency(total)}</strong></div>
          {!valid ? (
            <div className="validation-banner validation-warning">
              <AlertTriangle aria-hidden="true" size={17} />
              <span>{existingDates.length
                ? "This student already has a record on one of these dates. Edit it in History instead."
                : "Choose a student, unique future dates, positive allocations, a payment method, and one shared reference."}</span>
            </div>
          ) : null}
        </section>
      </div>
    </Drawer>
  );
}

function EditClassDrawer({ open, onClose, draft, setDraft, students, existingRows = [], context, currency, onSave, saving }) {
  const calculated = draft ? calculateClassLogRow(draft, context) : null;
  const duplicatesAnotherRow = Boolean(draft && existingRows.some((row) => (
    row.id !== draft.id && row.studentId === draft.studentId && row.classDate === draft.classDate
  )));
  const invalid = !draft
    || !isDateOnly(draft.classDate)
    || !draft.studentId
    || effectiveNumber(draft.hours, context.defaultHours) < 0
    || effectiveNumber(draft.amountPaid, 0) < 0
    || (draft.classStatus === "Completed" && !draft.attendance)
    || duplicatesAnotherRow
    || BLOCKING_PAYMENT_STATUSES.has(calculated?.paymentStatus);
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Edit class record"
      description="Calculated charge, status, and outstanding balance update automatically."
      size="wide"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={Save} onClick={onSave} disabled={invalid || saving}>{saving ? "Saving…" : "Save changes"}</Button>
        </>
      }
    >
      {draft ? (
        <div className="drawer-form">
          <div className="form-grid form-grid-2 two-columns">
            <Field label="Student" required>
              <Select value={draft.studentId} onChange={(event) => setDraft((current) => ({ ...current, studentId: event.target.value }))}>
                {students.map((student) => <option value={student.id} key={student.id}>{student.fullName}</option>)}
              </Select>
            </Field>
            <Field label="Class date" required><Input type="date" value={draft.classDate || ""} onChange={(event) => setDraft((current) => ({ ...current, classDate: event.target.value }))} /></Field>
            <Field label="Class status" required>
              <Select value={draft.classStatus || "Completed"} onChange={(event) => setDraft((current) => ({ ...current, classStatus: event.target.value, attendance: event.target.value === "Completed" ? (current.attendance || "P") : "" }))}>
                {CLASS_STATUSES.map((status) => <option value={status} key={status}>{status}</option>)}
              </Select>
            </Field>
            <Field label="Attendance" required={draft.classStatus === "Completed"}>
              <AttendanceSelect value={draft.attendance} onChange={(attendance) => setDraft((current) => ({ ...current, attendance }))} label="Attendance" disabled={draft.classStatus !== "Completed"} />
            </Field>
            <Field label="Hours" hint={`Blank uses the ${context.defaultHours}-hour default.`}><Input type="number" min="0" step="0.25" value={draft.hours ?? ""} onChange={(event) => setDraft((current) => ({ ...current, hours: event.target.value }))} /></Field>
            <Field label="Amount paid"><Input type="number" min="0" step="0.01" value={draft.amountPaid ?? ""} onChange={(event) => setDraft((current) => ({ ...current, amountPaid: event.target.value }))} /></Field>
            <Field label="Payment date"><Input type="date" value={draft.paymentDate || ""} onChange={(event) => setDraft((current) => ({ ...current, paymentDate: event.target.value }))} /></Field>
            <Field label="Method">
              <Select value={draft.paymentMethod || ""} onChange={(event) => setDraft((current) => ({ ...current, paymentMethod: event.target.value }))}>
                <option value="">—</option>{PAYMENT_METHODS.map((method) => <option value={method} key={method}>{method}</option>)}
              </Select>
            </Field>
            <Field label="Payment reference"><Input value={draft.paymentReference || ""} onChange={(event) => setDraft((current) => ({ ...current, paymentReference: event.target.value }))} /></Field>
            <Field label="Notes"><TextArea rows="3" value={draft.notes || ""} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} /></Field>
          </div>
          <div className="summary-grid edit-summary">
            <SummaryLine label="Charge" value={currency(calculated.charge)} />
            <SummaryLine label="Payment status" value={<StatusBadge tone={paymentTone(calculated.paymentStatus)}>{calculated.paymentStatus || "—"}</StatusBadge>} />
            <SummaryLine label="Outstanding" value={currency(calculated.outstanding)} />
          </div>
          {invalid ? <div className="validation-banner validation-error"><AlertTriangle aria-hidden="true" size={17} /><span>{duplicatesAnotherRow ? "This student already has a class record on that date." : "Complete the required fields and resolve the payment warning before saving."}</span></div> : null}
        </div>
      ) : null}
    </Drawer>
  );
}

function HistoryView({ rows, groups, students, context, currency, actions, registerNavigationBlocker }) {
  const [filters, setFilters] = useState({ search: "", groupId: "", classStatus: "", paymentStatus: "", dateFrom: "", dateTo: "" });
  const [editDraft, setEditDraft] = useState(null);
  const [deleteRow, setDeleteRow] = useState(null);
  const [saving, setSaving] = useState(false);
  const editBaselineRef = useRef(null);
  const editDirty = Boolean(editDraft) && draftChanged(editDraft, editBaselineRef.current);

  useUnsavedChanges(registerNavigationBlocker, editDirty, "Discard your unsaved class-record changes?");

  const paymentStatuses = useMemo(() => [...new Set(rows.map((row) => row.paymentStatus).filter(Boolean))].sort(), [rows]);
  const filteredRows = useMemo(() => {
    const needle = normalizeSearchText(filters.search);
    return rows.filter((row) => {
      if (filters.groupId === UNASSIGNED_GROUP && row.groupId) return false;
      if (filters.groupId && filters.groupId !== UNASSIGNED_GROUP && row.groupId !== filters.groupId) return false;
      if (filters.classStatus && row.classStatus !== filters.classStatus) return false;
      if (filters.paymentStatus && row.paymentStatus !== filters.paymentStatus) return false;
      if (filters.dateFrom && row.classDate < filters.dateFrom) return false;
      if (filters.dateTo && row.classDate > filters.dateTo) return false;
      if (!needle) return true;
      return [row.studentName, row.studentCode, row.groupName, row.paymentReference, row.notes]
        .some((value) => normalizeSearchText(value).includes(needle));
    }).sort((left, right) => (
      String(right.classDate).localeCompare(String(left.classDate))
      || String(left.studentName).localeCompare(String(right.studentName))
    ));
  }, [filters, rows]);

  const updateFilter = (field, value) => setFilters((current) => ({ ...current, [field]: value }));
  const openEdit = (row) => {
    const next = { ...row };
    editBaselineRef.current = next;
    setEditDraft(next);
  };
  const closeEdit = () => {
    if (!confirmDiscard(editDirty, "Discard your unsaved class-record changes?")) return false;
    editBaselineRef.current = null;
    setEditDraft(null);
    return true;
  };
  const saveEdit = async () => {
    if (!editDraft || !actions?.upsertClassLog) return;
    setSaving(true);
    try {
      const saved = await Promise.resolve(actions.upsertClassLog(persistedRecord(editDraft)));
      if (saved) {
        editBaselineRef.current = null;
        setEditDraft(null);
      }
    } finally {
      setSaving(false);
    }
  };
  const confirmDelete = async () => {
    if (!deleteRow || !actions?.deleteClassLog) return;
    const deleted = await Promise.resolve(actions.deleteClassLog(deleteRow.id));
    if (deleted) setDeleteRow(null);
  };

  return (
    <>
      <section className="panel history-panel">
        <div className="filter-bar" aria-label="Class history filters">
          <SearchInput value={filters.search} onChange={(event) => updateFilter("search", event.target.value)} placeholder="Search student, reference, or note" />
          <Select value={filters.groupId} onChange={(event) => updateFilter("groupId", event.target.value)} aria-label="Filter by group">
            <option value="">All groups</option><option value={UNASSIGNED_GROUP}>Unassigned</option>{groups.map((group) => <option value={group.id} key={group.id}>{group.name}</option>)}
          </Select>
          <Select value={filters.classStatus} onChange={(event) => updateFilter("classStatus", event.target.value)} aria-label="Filter by class status">
            <option value="">All class statuses</option>{CLASS_STATUSES.map((status) => <option value={status} key={status}>{status}</option>)}
          </Select>
          <Select value={filters.paymentStatus} onChange={(event) => updateFilter("paymentStatus", event.target.value)} aria-label="Filter by payment status">
            <option value="">All payment statuses</option>{paymentStatuses.map((status) => <option value={status} key={status}>{status}</option>)}
          </Select>
          <Field label="From"><Input type="date" value={filters.dateFrom} onChange={(event) => updateFilter("dateFrom", event.target.value)} /></Field>
          <Field label="To"><Input type="date" value={filters.dateTo} onChange={(event) => updateFilter("dateTo", event.target.value)} /></Field>
        </div>
        <div className="panel-header history-count">
          <div><h2>Class history</h2><p>{filteredRows.length} of {rows.length} records</p></div>
        </div>
        {filteredRows.length ? (
          <TableShell label="Class history" className="history-table-shell">
            <table className="history-table">
              <thead><tr><th scope="col">Class date</th><th scope="col">Student</th><th scope="col">Group</th><th scope="col">Class</th><th scope="col">Attendance</th><th scope="col" className="numeric number-cell">Hours</th><th scope="col" className="numeric number-cell">Charge</th><th scope="col" className="numeric number-cell">Paid</th><th scope="col">Payment status</th><th scope="col" className="numeric number-cell">Outstanding</th><th scope="col">Reference</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {filteredRows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.classDate}</td>
                    <td><div className="person-cell"><StudentAvatar avatarId={row.student?.avatarId} name={row.studentName} size="tiny" decorative /><span><strong>{row.studentName}</strong><span className="cell-subtitle">{row.studentCode}</span></span></div></td>
                    <td>{row.groupName || "Unassigned"}</td>
                    <td><StatusBadge tone={classStatusTone(row.classStatus)}>{row.classStatus}</StatusBadge></td>
                    <td>{row.attendance ? <StatusBadge tone={attendanceTone(row.attendance)}>{ATTENDANCE_LABELS[row.attendance] || row.attendance}</StatusBadge> : "—"}</td>
                    <td className="numeric number-cell">{row.effectiveHours}</td>
                    <td className="numeric number-cell money-cell">{currency(row.charge)}</td>
                    <td className="numeric number-cell money-cell">{currency(row.amountPaid)}</td>
                    <td><StatusBadge tone={paymentTone(row.paymentStatus)}>{row.paymentStatus || "—"}</StatusBadge></td>
                    <td className="numeric number-cell money-cell">{currency(row.outstanding)}</td>
                    <td>{row.paymentReference || "—"}</td>
                    <td><div className="row-actions"><IconButton label={`Edit ${row.studentName}'s class on ${row.classDate}`} icon={Pencil} onClick={() => openEdit(row)} /><IconButton label={`Delete ${row.studentName}'s class on ${row.classDate}`} icon={Trash2} onClick={() => setDeleteRow(row)} /></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableShell>
        ) : (
          <EmptyState icon={History} title="No matching class records" description="Try clearing one or more filters." action={Object.values(filters).some(Boolean) ? <Button onClick={() => setFilters({ search: "", groupId: "", classStatus: "", paymentStatus: "", dateFrom: "", dateTo: "" })}>Clear filters</Button> : null} />
        )}
      </section>

      <EditClassDrawer open={Boolean(editDraft)} onClose={closeEdit} draft={editDraft} setDraft={setEditDraft} students={students} existingRows={rows} context={context} currency={currency} onSave={saveEdit} saving={saving} />
      <ConfirmDialog
        open={Boolean(deleteRow)}
        title="Delete class record?"
        description={deleteRow ? `${deleteRow.studentName} · ${deleteRow.classDate}. This removes its attendance and payment entry.` : ""}
        confirmLabel="Delete record"
        onConfirm={confirmDelete}
        onClose={() => setDeleteRow(null)}
        busy={saving}
      />
    </>
  );
}

export default function ClassLog({ state = {}, derived = {}, asOfDate, actions = {}, intent, clearIntent, navigate, registerNavigationBlocker }) {
  const groups = useMemo(() => asArray(state.groups), [state.groups]);
  const students = useMemo(() => asArray(state.students), [state.students]);
  const classLogs = useMemo(() => asArray(state.classLog ?? state.classLogs), [state.classLog, state.classLogs]);
  const settings = state.settings || {};
  const currentAsOfDate = resolveAsOfDate(asOfDate, state);
  const defaultHours = effectiveNumber(settings.defaultClassHours ?? derived.defaultClassHours, 2);
  const hourlyRate = effectiveNumber(settings.hourlyRate ?? derived.hourlyRate, 50);
  const currencyCode = settings.currency || derived.currency || "MXN";
  const currency = useMemo(() => {
    const formatter = new Intl.NumberFormat(getUiLocale(), { style: "currency", currency: currencyCode, maximumFractionDigits: 2 });
    return (value) => formatter.format(effectiveNumber(value, 0));
  }, [currencyCode]);

  const fallbackStudentsById = useMemo(() => new Map(students.map((student) => [student.id, student])), [students]);
  const fallbackGroupsById = useMemo(() => new Map(groups.map((group) => [group.id, group])), [groups]);
  const studentsById = derived.studentsById || fallbackStudentsById;
  const groupsById = derived.groupsById || fallbackGroupsById;
  const context = useMemo(() => ({
    asOfDate: currentAsOfDate,
    defaultHours,
    hourlyRate,
    studentsById,
    groupsById,
  }), [currentAsOfDate, defaultHours, groupsById, hourlyRate, studentsById]);

  const sourceRows = Array.isArray(derived.classLogRows) ? derived.classLogRows : classLogs;
  const historyRows = useMemo(() => sourceRows.map((record) => {
    const calculated = calculateClassLogRow(record, context);
    return {
      ...calculated,
      studentName: record.studentName || calculated.studentName,
      groupName: record.groupName || calculated.groupName,
      charge: Number.isFinite(record.charge) ? record.charge : calculated.charge,
      paymentStatus: record.paymentStatus || calculated.paymentStatus,
      outstanding: Number.isFinite(record.outstanding) ? record.outstanding : calculated.outstanding,
    };
  }), [context, sourceRows]);

  const [mode, setMode] = useState("new");
  const [classDraft, setClassDraft] = useState({ groupId: "", classDate: currentAsOfDate, classStatus: "Completed", hours: defaultHours });
  const [rosterDrafts, setRosterDrafts] = useState({});
  const [advanceOpen, setAdvanceOpen] = useState(false);
  const [advanceDraft, setAdvanceDraft] = useState(() => makeAdvanceDraft(currentAsOfDate, defaultHours, hourlyRate));
  const [saving, setSaving] = useState(false);
  const classBaselineRef = useRef({
    classDraft: { groupId: "", classDate: currentAsOfDate, classStatus: "Completed", hours: defaultHours },
    rosterDrafts: {},
  });
  const advanceBaselineRef = useRef(advanceDraft);
  const classDirty = draftChanged({ classDraft, rosterDrafts }, classBaselineRef.current);
  const advanceDirty = advanceOpen && draftChanged(advanceDraft, advanceBaselineRef.current);

  useUnsavedChanges(registerNavigationBlocker, classDirty || advanceDirty, "Discard your unsaved class and payment changes?");

  const changeMode = useHistoryBackedState({
    key: "class-log-mode",
    value: mode,
    onChange: (nextMode) => {
      if (nextMode === "history") {
        const nextClassDraft = { groupId: "", classDate: currentAsOfDate, classStatus: "Completed", hours: defaultHours };
        classBaselineRef.current = { classDraft: nextClassDraft, rosterDrafts: {} };
        setClassDraft(nextClassDraft);
        setRosterDrafts({});
      }
      setMode(nextMode);
    },
    defaultValue: "new",
    allowedValues: ["new", "history"],
    canChange: ({ from, to }) => from !== "new" || from === to || confirmDiscard(classDirty, "Discard your unsaved class changes?"),
  });

  useEffect(() => {
    if (intent === "new-class") {
      changeMode("new");
      clearIntent?.();
    } else if (intent === "class-history") {
      changeMode("history");
      clearIntent?.();
    } else if (intent === "advance-payment") {
      changeMode("new");
      const nextAdvance = makeAdvanceDraft(currentAsOfDate, defaultHours, hourlyRate);
      advanceBaselineRef.current = nextAdvance;
      setAdvanceDraft(nextAdvance);
      setAdvanceOpen(true);
      clearIntent?.();
    }
  }, [changeMode, clearIntent, currentAsOfDate, defaultHours, hourlyRate, intent]);

  const activeStudents = useMemo(() => students
    .filter((student) => {
      if (student.status === "Inactive") return false;
      const groupIds = studentGroupIds(student);
      if (classDraft.groupId === UNASSIGNED_GROUP) return Boolean(student.isIndividual) || groupIds.length === 0;
      return groupIds.includes(classDraft.groupId);
    })
    .sort((left, right) => String(left.fullName).localeCompare(String(right.fullName))), [classDraft.groupId, students]);
  const activeStudentOptions = useMemo(() => students
    .filter((student) => student.status !== "Inactive")
    .sort((left, right) => String(left.fullName).localeCompare(String(right.fullName))), [students]);

  useEffect(() => {
    setRosterDrafts((current) => Object.fromEntries(activeStudents.map((student) => [
      student.id,
      current[student.id] || makeRosterDraft(classDraft.classStatus),
    ])));
  }, [activeStudents, classDraft.classStatus]);

  const rosterRows = useMemo(() => activeStudents.map((student) => {
    const draft = rosterDrafts[student.id] || makeRosterDraft(classDraft.classStatus);
    const record = persistedRecord({
      classDate: classDraft.classDate,
      studentId: student.id,
      groupId: classDraft.groupId === UNASSIGNED_GROUP ? "" : classDraft.groupId,
      classStatus: classDraft.classStatus,
      attendance: draft.attendance,
      hours: draft.hours === "" ? classDraft.hours : draft.hours,
      amountPaid: draft.amountPaid,
      paymentDate: draft.paymentDate,
      paymentMethod: draft.paymentMethod,
      paymentReference: draft.paymentReference,
      notes: draft.notes,
    });
    return { ...calculateClassLogRow(record, context), draft, studentName: student.fullName, studentCode: student.studentCode || student.code, avatarId: student.avatarId };
  }), [activeStudents, classDraft, context, rosterDrafts]);

  const summary = useMemo(() => rosterRows.reduce((total, row) => {
    total.charges += row.charge;
    total.paid += row.amountPaid;
    total.outstanding += row.outstanding;
    total.overpaid += row.overpaid;
    if (row.draft.paymentMethod === "Cash") total.cash += row.amountPaid;
    else total.otherPayments += row.amountPaid;
    if (row.draft.attendance) total.attendance[row.draft.attendance] += 1;
    return total;
  }, { charges: 0, paid: 0, outstanding: 0, overpaid: 0, cash: 0, otherPayments: 0, attendance: { P: 0, A: 0, L: 0, E: 0 } }), [rosterRows]);

  const issues = useMemo(() => {
    const result = [];
    if (!classDraft.groupId) result.push({ key: "group", blocking: true, message: "Choose a group or individual students." });
    if (!isDateOnly(classDraft.classDate)) result.push({ key: "date", blocking: true, message: "Choose a valid class date." });
    if (effectiveNumber(classDraft.hours, -1) < 0) result.push({ key: "hours", blocking: true, message: "Hours cannot be negative." });
    if (classDraft.groupId && !rosterRows.length) result.push({ key: "roster", blocking: true, message: "This group has no active students." });
    const missingAttendance = rosterRows.filter((row) => classDraft.classStatus === "Completed" && !row.draft.attendance).length;
    if (missingAttendance) result.push({ key: "attendance", blocking: true, message: `Choose attendance for ${missingAttendance} ${missingAttendance === 1 ? "student" : "students"}.` });
    const blockingPaymentRows = rosterRows.filter((row) => BLOCKING_PAYMENT_STATUSES.has(row.paymentStatus));
    if (blockingPaymentRows.length) result.push({ key: "payment", blocking: true, message: `${blockingPaymentRows.length} payment ${blockingPaymentRows.length === 1 ? "entry needs" : "entries need"} attention.` });
    const duplicateCount = rosterRows.filter((row) => classLogs.some((saved) => saved.classDate === row.classDate && saved.studentId === row.studentId)).length;
    if (duplicateCount) result.push({ key: "duplicates", blocking: true, message: `${duplicateCount} ${duplicateCount === 1 ? "student already has" : "students already have"} a record on this date. Edit it in History instead.` });
    const outstandingCount = rosterRows.filter((row) => row.outstanding > 0).length;
    if (outstandingCount) result.push({ key: "outstanding", blocking: false, message: `${outstandingCount} ${outstandingCount === 1 ? "student has" : "students have"} an outstanding balance.` });
    const missingMethodCount = rosterRows.filter((row) => row.amountPaid > 0 && !row.draft.paymentMethod).length;
    if (missingMethodCount) result.push({ key: "method", blocking: false, message: `${missingMethodCount} paid ${missingMethodCount === 1 ? "entry has" : "entries have"} no payment method.` });
    const overpaidCount = rosterRows.filter((row) => row.overpaid > 0).length;
    if (overpaidCount) result.push({ key: "overpaid", blocking: false, message: `${overpaidCount} ${overpaidCount === 1 ? "payment is" : "payments are"} above the class charge.` });
    const lateCount = summary.attendance.L;
    if (lateCount) result.push({ key: "late", blocking: false, message: `${lateCount} ${lateCount === 1 ? "student is" : "students are"} marked late.` });
    const excusedCount = summary.attendance.E;
    if (excusedCount) result.push({ key: "excused", blocking: false, message: `${excusedCount} ${excusedCount === 1 ? "student is" : "students are"} excused.` });
    return result;
  }, [classDraft, classLogs, rosterRows, summary.attendance.E, summary.attendance.L]);

  const setClassField = (field, value) => {
    setClassDraft((current) => {
      const next = { ...current, [field]: value };
      if (field === "classStatus") {
        setRosterDrafts((drafts) => Object.fromEntries(Object.entries(drafts).map(([studentId, draft]) => [studentId, {
          ...draft,
          attendance: value === "Completed" ? (draft.attendance || "P") : "",
        }])));
      }
      if (field === "groupId") setRosterDrafts({});
      return next;
    });
  };
  const setRosterField = (studentId, field, value) => setRosterDrafts((current) => ({
    ...current,
    [studentId]: { ...(current[studentId] || makeRosterDraft(classDraft.classStatus)), [field]: value },
  }));

  const markAllPresent = () => setRosterDrafts((current) => Object.fromEntries(activeStudents.map((student) => [student.id, {
    ...(current[student.id] || makeRosterDraft(classDraft.classStatus)), attendance: "P",
  }])));
  const markAllPaid = () => setRosterDrafts((current) => Object.fromEntries(rosterRows.map((row) => [row.studentId, {
    ...(current[row.studentId] || makeRosterDraft(classDraft.classStatus)),
    amountPaid: row.charge,
    paymentDate: classDraft.classDate > currentAsOfDate ? currentAsOfDate : classDraft.classDate,
    paymentMethod: current[row.studentId]?.paymentMethod || "Cash",
  }])));

  const saveClass = async () => {
    if (!actions?.addClassLogs || !rosterRows.length || issues.some((issue) => issue.blocking)) return;
    setSaving(true);
    try {
      const saved = await Promise.resolve(actions.addClassLogs(rosterRows.map((row) => persistedRecord(row))));
      if (saved) {
        const nextRosterDrafts = Object.fromEntries(activeStudents.map((student) => [student.id, makeRosterDraft(classDraft.classStatus)]));
        classBaselineRef.current = { classDraft, rosterDrafts: nextRosterDrafts };
        setRosterDrafts(nextRosterDrafts);
      }
    } finally {
      setSaving(false);
    }
  };

  const openAdvance = () => {
    const nextAdvance = makeAdvanceDraft(currentAsOfDate, defaultHours, hourlyRate);
    advanceBaselineRef.current = nextAdvance;
    setAdvanceDraft(nextAdvance);
    setAdvanceOpen(true);
  };
  const closeAdvance = () => {
    if (!confirmDiscard(advanceDirty, "Discard this advance-payment draft?")) return false;
    setAdvanceOpen(false);
    return true;
  };
  const saveAdvance = async () => {
    if (!actions?.addClassLogs || !advanceDraft.studentId) return;
    setSaving(true);
    try {
      const count = advanceDraft.entries.length;
      const records = advanceDraft.entries.map((entry, index) => persistedRecord({
        classDate: entry.classDate,
        studentId: advanceDraft.studentId,
        groupId: studentGroupIds(studentsById.get(advanceDraft.studentId))[0] || "",
        classStatus: "Scheduled",
        attendance: "",
        hours: entry.hours,
        amountPaid: entry.amountPaid,
        paymentDate: advanceDraft.paymentDate,
        paymentMethod: advanceDraft.paymentMethod,
        paymentReference: advanceDraft.paymentReference,
        notes: advanceDraft.notes
          ? `${advanceDraft.notes} · Advance ${index + 1} of ${count}`
          : `Advance ${index + 1} of ${count}`,
      }));
      const saved = await Promise.resolve(actions.addClassLogs(records));
      if (saved) {
        advanceBaselineRef.current = advanceDraft;
        setAdvanceOpen(false);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="feature-page class-log-page">
      <div className="page-toolbar">
        <Tabs
          value={mode}
          onChange={changeMode}
          ariaLabel="Class Log views"
          items={[{ value: "new", label: "New class" }, { value: "history", label: "History" }]}
        />
        <div className="page-toolbar-meta"><CalendarDays aria-hidden="true" size={17} /><span>Balances calculated through {currentAsOfDate}</span></div>
      </div>

      {mode === "history" ? (
        <HistoryView rows={historyRows} groups={groups} students={students} context={context} currency={currency} actions={actions} registerNavigationBlocker={registerNavigationBlocker} />
      ) : (
        <div className="entry-layout">
          <main className="entry-main">
            <ClassControls
              value={classDraft}
              groups={groups}
              hasIndividualStudents={activeStudentOptions.some((student) => student.isIndividual || studentGroupIds(student).length === 0)}
              onChange={setClassField}
              onAdvance={openAdvance}
              onSave={saveClass}
              saving={saving}
              canSave={rosterRows.length > 0 && !issues.some((issue) => issue.blocking)}
            />
            <div className="roster-toolbar">
              <div className="roster-actions">
                <Button icon={Check} onClick={markAllPresent} disabled={!rosterRows.length || classDraft.classStatus !== "Completed"}>Mark all present</Button>
                <Button icon={CircleDollarSign} onClick={markAllPaid} disabled={!rosterRows.length || classDraft.classStatus === "Cancelled"}>Mark all paid</Button>
              </div>
              <span className="roster-count"><Users aria-hidden="true" size={17} />{rosterRows.length} {rosterRows.length === 1 ? "student" : "students"}</span>
            </div>
            <RosterTable
              rows={rosterRows}
              classStatus={classDraft.classStatus}
              currency={currency}
              onChange={setRosterField}
              groupSelected={Boolean(classDraft.groupId)}
              onGoToSetup={navigate ? () => navigate("students") : undefined}
            />
            {rosterRows.length ? (
              <section className="panel totals-bar" aria-label="Class totals">
                <div className="pricing-note"><CircleDollarSign aria-hidden="true" /><span>Charges use {currency(hourlyRate)} per hour. Blank student hours use the {defaultHours}-hour class default.</span></div>
                <div className="totals-values">
                  <SummaryLine label="Charges" value={currency(summary.charges)} />
                  <SummaryLine label="Paid" value={currency(summary.paid)} />
                  <SummaryLine label="Outstanding" value={currency(summary.outstanding)} tone={summary.outstanding ? "danger" : ""} />
                  <SummaryLine label="Overpaid" value={currency(summary.overpaid)} tone={summary.overpaid ? "purple" : ""} />
                </div>
              </section>
            ) : null}
          </main>
          <div className="entry-sidebar">
            <ReviewPanel classDraft={classDraft} selectedGroup={classDraft.groupId === UNASSIGNED_GROUP ? { name: "Individual students" } : mapLookup(groupsById, classDraft.groupId)} rows={rosterRows} summary={summary} issues={issues} currency={currency} saving={saving} onSave={saveClass} />
          </div>
        </div>
      )}

      <AdvancePaymentDrawer
        open={advanceOpen}
        onClose={closeAdvance}
        students={activeStudentOptions}
        groupsById={groupsById}
        existingRows={historyRows}
        draft={advanceDraft}
        setDraft={setAdvanceDraft}
        defaultHours={defaultHours}
        hourlyRate={hourlyRate}
        asOfDate={currentAsOfDate}
        currency={currency}
        onSave={saveAdvance}
        saving={saving}
      />
    </div>
  );
}

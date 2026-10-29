import { Plus, Trash2, X } from "lucide-react";
import { useI18n } from "../i18n/index.jsx";
import {
  Button,
  DurationStepper,
  Field,
  FieldRow,
  IconButton,
  Input,
  MoneyInput,
  MultiSelect,
  Segmented,
  Select,
  Switch,
  TextArea,
} from "../components/ui";
import { AvatarPicker } from "../components/StudentAvatar";
import { createStableId, DAY_OPTIONS } from "../domain";
import { addDays } from "../domain/dates";
import { groupBillingFor, periodOf } from "../domain/monthlyBilling";
import { formatHours, formatMoney, formatShortDate, monthLong } from "../utils/displayFormat";
import {
  adjustmentStart,
  applyFromFor,
  applyFromOptions,
  billingChanges,
  billingTermChanged,
  feeSuggestion,
  monthlyTotal,
  nextDueDates,
  switchCredits,
} from "./communityModel";

function capitalize(text) {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

/** Add or edit a student: identity, avatar, enrollment, own rate and contact. */
export function StudentEditor({ draft, setDraft, groups, defaultRate }) {
  const { t, locale } = useI18n();
  const activeGroups = groups.filter((group) => group.status !== "Inactive" || draft.groupIds.includes(group.id));
  const selectedGroups = draft.groupIds.map((id) => groups.find((group) => group.id === id)).filter(Boolean);
  const inheritedRate =
    selectedGroups.length === 1 && Number.isFinite(selectedGroups[0].hourlyRate)
      ? selectedGroups[0].hourlyRate
      : defaultRate;
  const customRate = Number.isFinite(draft.customHourlyRate);
  return (
    <form id="student-editor" className="editor-form" onSubmit={(event) => event.preventDefault()}>
      <div className="form-grid">
        <Field label={t("Full name")} required>
          <Input value={draft.fullName} onChange={(event) => setDraft({ ...draft, fullName: event.target.value })} />
        </Field>
        <Field label={t("Student ID")} required>
          <Input value={draft.code} onChange={(event) => setDraft({ ...draft, code: event.target.value })} />
        </Field>
      </div>
      <AvatarPicker value={draft.avatarId} onChange={(avatarId) => setDraft({ ...draft, avatarId })} />
      <div className="field-rows">
        <FieldRow label={t("Groups")}>
          <MultiSelect
            aria-label={t("Assign groups")}
            value={draft.groupIds}
            options={activeGroups.map((group) => ({ value: group.id, label: group.name, meta: group.subject || "" }))}
            onChange={(groupIds) => setDraft((current) => ({ ...current, groupIds }))}
            placeholder={t("Choose groups")}
            emptyMessage={t("No groups match")}
            variant="group"
          />
        </FieldRow>
        <FieldRow label={t("Individual classes")} hint={t("Individual, groups, or both")}>
          <Switch
            label={t("Individual classes")}
            checked={draft.isIndividual}
            onChange={(isIndividual) => setDraft({ ...draft, isIndividual })}
          />
        </FieldRow>
        <FieldRow
          label={t("Own rate")}
          hint={
            customRate
              ? t("Overrides the group rate for this student.")
              : selectedGroups.length > 1
                ? t("Uses each group rate")
                : t("{p0} / hour inherited", { p0: formatMoney(inheritedRate, locale) })
          }
        >
          <Switch
            label={t("Override inherited rate")}
            checked={customRate}
            onChange={(checked) => setDraft({ ...draft, customHourlyRate: checked ? inheritedRate : null })}
          />
          {customRate ? (
            <MoneyInput
              label={t("Custom hourly rate")}
              value={draft.customHourlyRate}
              suffix={t("/ hour")}
              onChange={(value) => setDraft({ ...draft, customHourlyRate: value === "" ? 0 : Number(value) })}
            />
          ) : null}
        </FieldRow>
        <FieldRow label={t("Status")}>
          <Segmented
            tone="soft"
            value={draft.status}
            label={t("Status")}
            onChange={(status) => setDraft({ ...draft, status })}
            items={[
              { value: "Active", label: "Active" },
              { value: "Inactive", label: "Inactive" },
            ]}
          />
        </FieldRow>
      </div>
      <h3 className="overline editor-section">{t("Contact information")}</h3>
      <div className="form-grid">
        <Field label={t("Student email")}>
          <Input
            type="email"
            inputMode="email"
            autoComplete="email"
            value={draft.studentEmail}
            onChange={(event) => setDraft({ ...draft, studentEmail: event.target.value })}
          />
        </Field>
        <Field label={t("Guardian phone")}>
          <Input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={draft.guardianPhone}
            onChange={(event) => setDraft({ ...draft, guardianPhone: event.target.value })}
          />
        </Field>
        <Field label={t("Student phone")}>
          <Input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={draft.phone}
            onChange={(event) => setDraft({ ...draft, phone: event.target.value })}
          />
        </Field>
        <Field label={t("Parent / tutor details")} hint={t("Name or other useful contact details")}>
          <Input
            value={draft.guardianContact}
            onChange={(event) => setDraft({ ...draft, guardianContact: event.target.value })}
          />
        </Field>
      </div>
      <Field label={t("Notes")}>
        <TextArea
          rows="3"
          value={draft.notes}
          onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
        />
      </Field>
    </form>
  );
}

/** Group identity and its weekly times; billing comes from BillingFields. */
export function GroupEditor({ draft, setDraft, defaultHours, defaultRate, children = null }) {
  const { t, locale } = useI18n();
  const addSchedule = () =>
    setDraft((current) => ({
      ...current,
      weeklySchedule: [
        ...current.weeklySchedule,
        { id: createStableId("slot"), dayOfWeek: 1, startTime: "16:00", durationHours: defaultHours },
      ],
    }));
  const updateSchedule = (id, patch) =>
    setDraft((current) => ({
      ...current,
      weeklySchedule: current.weeklySchedule.map((slot) => (slot.id === id ? { ...slot, ...patch } : slot)),
    }));
  const removeSchedule = (id) =>
    setDraft((current) => ({ ...current, weeklySchedule: current.weeklySchedule.filter((slot) => slot.id !== id) }));
  return (
    <form className="editor-form" onSubmit={(event) => event.preventDefault()}>
      <Field label={t("Group name")} required>
        <Input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
      </Field>
      <div className="form-grid">
        <Field label={t("Grade")}>
          <Input value={draft.grade} onChange={(event) => setDraft({ ...draft, grade: event.target.value })} />
        </Field>
        <Field label={t("Subject")}>
          <Input value={draft.subject} onChange={(event) => setDraft({ ...draft, subject: event.target.value })} />
        </Field>
      </div>
      <section className="schedule-editor" aria-labelledby="weekly-schedule-heading">
        <div className="block-head">
          <div>
            <h3 className="overline" id="weekly-schedule-heading">
              {t("Weekly schedule")}
            </h3>
            <small className="muted">{t("Add every regular meeting time for this group.")}</small>
          </div>
          <Button icon={Plus} onClick={addSchedule}>
            {t("Add time")}
          </Button>
        </div>
        {draft.weeklySchedule.map((slot) => (
          <div className="schedule-slot" key={slot.id}>
            <Field label={t("Day")}>
              <Select
                value={String(slot.dayOfWeek)}
                onChange={(event) => updateSchedule(slot.id, { dayOfWeek: Number(event.target.value) })}
              >
                {DAY_OPTIONS.map((day) => (
                  <option value={day.value} key={day.value}>
                    {t(day.label)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("Time")}>
              <Input
                type="time"
                value={slot.startTime}
                onChange={(event) => updateSchedule(slot.id, { startTime: event.target.value })}
              />
            </Field>
            <Field label={t("Duration")}>
              <DurationStepper
                label={t("Class length")}
                minutes={Math.round((Number(slot.durationHours) || 0) * 60) || 60}
                onChange={(minutes) => updateSchedule(slot.id, { durationHours: minutes / 60 })}
              />
            </Field>
            <IconButton label={t("Remove meeting time")} icon={Trash2} onClick={() => removeSchedule(slot.id)} />
          </div>
        ))}
        {/* A new group has no manual classes, so the reassurance only applies when editing one. */}
        {!draft.weeklySchedule.length && draft.id ? (
          <p className="muted">{t("No recurring times yet. Existing manual classes remain unchanged.")}</p>
        ) : null}
      </section>
      {children}
      <div className="form-grid">
        <Field label={t("Schedule note / room")}>
          <Input
            value={draft.schedule}
            onChange={(event) => setDraft({ ...draft, schedule: event.target.value })}
            placeholder={t("Optional room or legacy schedule note")}
          />
        </Field>
        {!draft.weeklySchedule.length ? (
          <Field label={t("Planned sessions / month")}>
            <Input
              type="number"
              min="0"
              value={draft.plannedSessionsPerMonth}
              onChange={(event) => setDraft({ ...draft, plannedSessionsPerMonth: Number(event.target.value) })}
            />
          </Field>
        ) : null}
      </div>
      <Field label={t("Assistant / contact")}>
        <TextArea
          rows="2"
          value={draft.assistantContact}
          onChange={(event) => setDraft({ ...draft, assistantContact: event.target.value })}
        />
      </Field>
      <Field label={t("Notes")}>
        <TextArea
          rows="3"
          value={draft.notes}
          onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
        />
      </Field>
      <p className="muted editor-hint">
        {Number.isFinite(draft.hourlyRate)
          ? t("{p0} / hour", { p0: formatMoney(draft.hourlyRate, locale) })
          : t("{p0} / hour inherited", { p0: formatMoney(defaultRate, locale) })}{" "}
        · {formatHours(defaultHours, locale)}
      </p>
    </form>
  );
}

const NTH_OPTIONS = [
  { value: "1", label: "1st" },
  { value: "2", label: "2nd" },
  { value: "3", label: "3rd" },
  { value: "4", label: "4th" },
  { value: "last", label: "last (class)" },
];

/**
 * «el día 5» / «en la clase 1.ª» as two selects. With `inherit` the first one also offers the group's
 * own date, and choosing it hands back null.
 */
function DueSelects({ due, onChange, labels, inherit = false }) {
  const { t } = useI18n();
  const type = due?.type || (inherit ? "group" : "dayOfMonth");
  return (
    <>
      <Select
        small
        aria-label={labels.type}
        value={type}
        onChange={(event) =>
          onChange(
            event.target.value === "group"
              ? null
              : event.target.value === "nthClass"
                ? { type: "nthClass", nth: 1 }
                : { type: "dayOfMonth", day: 5 },
          )
        }
      >
        {inherit ? <option value="group">{t("due like the group")}</option> : null}
        <option value="dayOfMonth">{t(inherit ? "due on day" : "on day")}</option>
        <option value="nthClass">{t(inherit ? "due at class" : "at class")}</option>
      </Select>
      {type === "dayOfMonth" ? (
        <Select
          small
          aria-label={labels.day}
          value={String(due.day)}
          onChange={(event) => onChange({ type: "dayOfMonth", day: Number(event.target.value) })}
        >
          {Array.from({ length: 28 }, (_, index) => (
            <option key={index + 1} value={String(index + 1)}>
              {String(index + 1)}
            </option>
          ))}
        </Select>
      ) : type === "nthClass" ? (
        <Select
          small
          aria-label={labels.nth}
          value={String(due.nth)}
          onChange={(event) =>
            onChange({ type: "nthClass", nth: event.target.value === "last" ? "last" : Number(event.target.value) })
          }
        >
          {NTH_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {t(option.label)}
            </option>
          ))}
        </Select>
      ) : null}
    </>
  );
}

// «Octubre (este mes)», «Noviembre», «Enero 2027»: the year only when it is not this one.
function monthOption(month, asOf, locale, t) {
  const name = capitalize(monthLong(`${month}-01`, locale));
  const label = month.slice(0, 4) === asOf.slice(0, 4) ? name : `${name} ${month.slice(0, 4)}`;
  return month === periodOf(asOf) ? `${label} (${t("this month")})` : label;
}

/**
 * «Aplica desde»: shown once the arrangement is monthly or changes. The hint says what happens to the
 * months around the chosen one; switching to monthly in this month lists what each student owes.
 */
function startChoice(state, group, members, draft, asOf) {
  const latest = groupBillingFor(group);
  const changed = billingTermChanged(group, draft);
  if (!changed && latest?.mode !== "monthly") return null;
  const period = periodOf(asOf);
  const from = applyFromFor(group, draft, asOf);
  const monthly = draft.mode === "monthly";
  const wasMonthly = groupBillingFor(group, from)?.mode === "monthly";
  const values = { month: from };
  let hint = "";
  if (!monthly) {
    hint = "Monthly fees end in {last}; per-class charges start in {month}.";
    values.last = periodOf(addDays(`${from}-01`, -1));
  } else if (!changed && from === (latest?.effectiveFrom || "")) {
    hint = from > period ? "Monthly fees start in {month}; until then classes are charged per class." : "";
  } else if (wasMonthly && changed) {
    hint =
      from > period
        ? "The new fee starts in {month}."
        : "The new fee applies from {month}; months already paid stay as they are.";
  } else if (from === period) {
    hint = "The {month} fee is created and what they already paid per class is discounted:";
  } else if (from < period) {
    hint = "Monthly fees from {month} on are created; what was already paid per class those months is discounted.";
  } else {
    hint = "Monthly fees start in {month}; until then classes are charged per class.";
  }
  return {
    from,
    options: applyFromOptions(group, draft, asOf),
    hint,
    values,
    credits: monthly && !wasMonthly && from === period ? switchCredits(state, group, members, draft, asOf, from) : [],
  };
}

/**
 * «Forma de cobro» as rows: per class with its rate, or monthly with fee, due date,
 * per-student adjustments and, for an existing group (`chooseStart`), the month it applies from.
 */
export function BillingFields({ draft, setDraft, group, members = [], state, asOf, defaultRate, chooseStart = false }) {
  const { t, locale } = useI18n();
  const monthly = draft.mode === "monthly";
  const rate = Number.isFinite(draft.hourlyRate) ? draft.hourlyRate : defaultRate;
  const slots = group?.weeklySchedule || [];
  const hours = slots.length
    ? slots.reduce((sum, slot) => sum + (Number(slot.durationHours) || 0), 0) / slots.length
    : Number(state.settings?.defaultClassHours) || 0;
  const perClass = Math.round(hours * (Number(rate) || 0) * 100) / 100;
  const suggestion = group?.id ? feeSuggestion(state, { ...group, hourlyRate: draft.hourlyRate }, asOf) : null;
  const due = draft.due || { type: "dayOfMonth", day: 5 };
  const nextDues = monthly && group ? nextDueDates(state, group, draft, asOf) : [];
  const adjustedIds = Object.keys(draft.adjustments || {}).filter((id) => members.some((student) => student.id === id));
  const unadjusted = members.filter((student) => !adjustedIds.includes(student.id));
  const groupFeePayers = members.filter(
    (student) => !adjustedIds.includes(student.id) || draft.adjustments[student.id].mode === "group",
  ).length;
  const totals = monthlyTotal(state, group, members, draft);
  const setAdjustment = (id, value) =>
    setDraft((current) => {
      const adjustments = { ...current.adjustments };
      if (value) adjustments[id] = value;
      else delete adjustments[id];
      return { ...current, adjustments };
    });
  const start = chooseStart && group?.id ? startChoice(state, group, members, draft, asOf) : null;
  // Changing how a student pays never rewrites the months before it applies.
  const adjustmentsFrom =
    chooseStart && monthly && group?.id && Object.keys(billingChanges(group, members, draft, asOf).overrides).length
      ? adjustmentStart(group, draft, asOf)
      : "";
  return (
    <div className="field-rows billing-fields">
      <FieldRow label={t("Billing")}>
        <Segmented
          tone="soft"
          value={draft.mode}
          label={t("Billing")}
          onChange={(mode) => setDraft({ ...draft, mode })}
          items={[
            { value: "perClass", label: "Per class" },
            { value: "monthly", label: "Monthly" },
          ]}
        />
      </FieldRow>
      {!monthly ? (
        <FieldRow
          label={t("Rate")}
          hint={
            hours
              ? t("Class of {hours} = {amount} per student", {
                  hours: formatHours(hours, locale),
                  amount: formatMoney(perClass, locale),
                })
              : ""
          }
        >
          <MoneyInput
            label={t("Hourly rate")}
            value={draft.hourlyRate ?? ""}
            placeholder={String(defaultRate ?? "")}
            suffix={t("/ hour")}
            onChange={(value) => setDraft({ ...draft, hourlyRate: value === "" ? null : Number(value) })}
          />
        </FieldRow>
      ) : (
        <>
          <FieldRow label={t("Fee")}>
            <MoneyInput
              label={t("Monthly fee per student")}
              value={draft.monthlyFee ?? ""}
              suffix={t("/ month")}
              onChange={(value) => setDraft({ ...draft, monthlyFee: value === "" ? null : Number(value) })}
            />
            {suggestion?.fee ? (
              <span className="field-row-hint">
                {t("Suggested {fee} ({classes} classes × {perClass})", {
                  fee: formatMoney(suggestion.fee, locale),
                  classes: suggestion.classes,
                  perClass: formatMoney(suggestion.perClass, locale),
                })}{" "}
                <button
                  type="button"
                  className="link-button"
                  onClick={() => setDraft({ ...draft, monthlyFee: suggestion.fee })}
                >
                  {t("Use")}
                </button>
              </span>
            ) : null}
          </FieldRow>
          <FieldRow label={t("Due")}>
            <DueSelects
              due={due}
              onChange={(next) => setDraft((current) => ({ ...current, due: next }))}
              labels={{ type: t("How it falls due"), day: t("Day of the month"), nth: t("Which class") }}
            />
            <span className="field-row-hint">{t(due.type === "dayOfMonth" ? "of each month" : "of the month")}</span>
            {nextDues.length ? (
              <span className="field-row-hint">
                · {t("next: {dates}", { dates: nextDues.map((date) => formatShortDate(date, locale)).join(", ") })}
              </span>
            ) : null}
          </FieldRow>
          {members.length ? (
            <FieldRow label={t("Students")}>
              <div className="billing-adjustments">
                <span className="field-row-hint">
                  {t(
                    adjustedIds.length === 1
                      ? "{group} pay the group fee · {count} with an adjustment:"
                      : "{group} pay the group fee · {count} with adjustments:",
                    { group: groupFeePayers, count: adjustedIds.length },
                  )}
                </span>
                {adjustedIds.map((id) => {
                  const student = members.find((item) => item.id === id);
                  const adjustment = draft.adjustments[id];
                  const ownDue = adjustment.mode === "perClass" ? null : adjustment.due || null;
                  const ownDues = ownDue && group ? nextDueDates(state, group, { ...draft, due: ownDue }, asOf, 1) : [];
                  return (
                    <div className="billing-adjustment" key={id}>
                      <b>{student.fullName}</b>
                      <Select
                        small
                        aria-label={t("How {name} pays", { name: student.fullName })}
                        value={adjustment.mode}
                        onChange={(event) =>
                          setAdjustment(id, {
                            mode: event.target.value,
                            fee: event.target.value === "customFee" ? (adjustment.fee ?? draft.monthlyFee ?? 0) : null,
                            due: event.target.value === "perClass" ? null : adjustment.due || null,
                          })
                        }
                      >
                        <option value="group">{t("Group fee")}</option>
                        <option value="customFee">{t("Other fee")}</option>
                        <option value="perClass">{t("Per class")}</option>
                      </Select>
                      {adjustment.mode === "customFee" ? (
                        <MoneyInput
                          label={t("Fee for {name}", { name: student.fullName })}
                          value={adjustment.fee ?? ""}
                          onChange={(value) =>
                            setAdjustment(id, { ...adjustment, fee: value === "" ? null : Number(value) })
                          }
                        />
                      ) : adjustment.mode === "perClass" ? (
                        <span className="field-row-hint">
                          {t("{amount} per class attended", { amount: formatMoney(perClass, locale) })}
                        </span>
                      ) : null}
                      {/* Monthly payers may fall due on their own day or class instead of the group's. */}
                      {adjustment.mode !== "perClass" ? (
                        <span className="billing-adjustment-due">
                          <DueSelects
                            inherit
                            due={ownDue}
                            onChange={(next) => setAdjustment(id, { ...adjustment, due: next })}
                            labels={{
                              type: t("When {name} pays", { name: student.fullName }),
                              day: t("Day {name} pays", { name: student.fullName }),
                              nth: t("Class {name} pays at", { name: student.fullName }),
                            }}
                          />
                          {ownDues.length ? (
                            <span className="field-row-hint">
                              {t("next: {date}", { date: formatShortDate(ownDues[0], locale) })}
                            </span>
                          ) : null}
                        </span>
                      ) : null}
                      <IconButton
                        className="billing-remove"
                        label={t("Remove adjustment for {name}", { name: student.fullName })}
                        icon={X}
                        onClick={() => setAdjustment(id, null)}
                      />
                    </div>
                  );
                })}
                {unadjusted.length ? (
                  <Select
                    small
                    className="billing-add"
                    aria-label={t("Adjust for a student")}
                    placeholder={t("+ Adjust for a student")}
                    value=""
                    onChange={(event) =>
                      event.target.value &&
                      setAdjustment(event.target.value, { mode: "customFee", fee: draft.monthlyFee ?? 0 })
                    }
                  >
                    <option value="">{t("+ Adjust for a student")}</option>
                    {unadjusted.map((student) => (
                      <option key={student.id} value={student.id}>
                        {student.fullName}
                      </option>
                    ))}
                  </Select>
                ) : null}
                {adjustmentsFrom ? (
                  <span className="field-row-hint">
                    {t("Student changes apply from {month}; earlier months stay as they were.", {
                      month: monthLong(`${adjustmentsFrom}-01`, locale),
                    })}
                  </span>
                ) : null}
              </div>
            </FieldRow>
          ) : null}
        </>
      )}
      {start ? (
        <FieldRow label={t("Applies from")}>
          <div className="billing-adjustments">
            <Select
              small
              aria-label={t("Applies from")}
              value={start.from}
              onChange={(event) => setDraft((current) => ({ ...current, applyFrom: event.target.value }))}
            >
              {start.from === "" ? <option value="">{t("Since it started")}</option> : null}
              {start.options.map((month) => (
                <option key={month} value={month}>
                  {monthOption(month, asOf, locale, t)}
                </option>
              ))}
            </Select>
            {start.hint ? (
              <span className="field-row-hint">
                {t(
                  start.hint,
                  Object.fromEntries(
                    Object.entries(start.values).map(([key, month]) => [key, monthLong(`${month}-01`, locale)]),
                  ),
                )}
              </span>
            ) : null}
            {start.credits.length ? (
              <div className="billing-credits">
                {start.credits.map((item) => (
                  <span key={item.student.id}>
                    {item.student.fullName.split(" ")[0]} {formatMoney(item.fee, locale)} −{" "}
                    {formatMoney(item.paid, locale)} = <b>{formatMoney(item.amount, locale)}</b>
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </FieldRow>
      ) : null}
      {/* With no students yet the per-class total is the rate's own hint («Clase de 2 h = $250 por alumno»). */}
      {!monthly && !members.length ? null : (
        <FieldRow label={t(monthly ? "Per month" : "Per class")}>
          {monthly ? (
            <>
              <span className="billing-total">{formatMoney(totals.total, locale)}</span>
              <span className="field-row-hint">
                {t(totals.monthly === 1 ? "{count} monthly fee" : "{count} monthly fees", { count: totals.monthly })}
                {totals.perClass ? ` + ${t("{count} per class", { count: totals.perClass })}` : ""}
              </span>
            </>
          ) : (
            <>
              <span className="billing-total">{formatMoney(perClass * members.length, locale)}</span>
              <span className="field-row-hint">
                {t(members.length === 1 ? "{count} student × {amount}" : "{count} students × {amount}", {
                  count: members.length,
                  amount: formatMoney(perClass, locale),
                })}
              </span>
            </>
          )}
        </FieldRow>
      )}
    </div>
  );
}

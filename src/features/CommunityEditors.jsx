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
import { periodOf, nextPeriod } from "../domain/monthlyBilling";
import { formatHours, formatMoney, formatShortDate, monthLong } from "../utils/displayFormat";
import { feeSuggestion, monthlyTotal, nextDueDates, switchCredits } from "./communityModel";

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
        {!draft.weeklySchedule.length ? (
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
 * «Forma de cobro» as rows: per class with its rate, or monthly with fee, due date,
 * per-student adjustments and, when an existing group switches, from which month.
 */
export function BillingFields({
  draft,
  setDraft,
  group,
  members = [],
  state,
  asOf,
  defaultRate,
  applyFrom = "next",
  setApplyFrom = undefined,
  switching = false,
}) {
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
  const totals = monthlyTotal(state, group, members, draft);
  const setAdjustment = (id, value) =>
    setDraft((current) => {
      const adjustments = { ...current.adjustments };
      if (value) adjustments[id] = value;
      else delete adjustments[id];
      return { ...current, adjustments };
    });
  const thisMonth = monthLong(`${periodOf(asOf)}-01`, locale);
  const nextMonth = monthLong(`${nextPeriod(periodOf(asOf))}-01`, locale);
  const credits = switching && applyFrom === "current" ? switchCredits(state, group, members, draft, asOf) : [];
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
            <Select
              small
              aria-label={t("How it falls due")}
              value={due.type}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  due:
                    event.target.value === "nthClass" ? { type: "nthClass", nth: 1 } : { type: "dayOfMonth", day: 5 },
                })
              }
            >
              <option value="dayOfMonth">{t("on day")}</option>
              <option value="nthClass">{t("at class")}</option>
            </Select>
            {due.type === "dayOfMonth" ? (
              <>
                <Select
                  small
                  aria-label={t("Day of the month")}
                  value={String(due.day)}
                  onChange={(event) =>
                    setDraft({ ...draft, due: { type: "dayOfMonth", day: Number(event.target.value) } })
                  }
                >
                  {Array.from({ length: 28 }, (_, index) => (
                    <option key={index + 1} value={String(index + 1)}>
                      {String(index + 1)}
                    </option>
                  ))}
                </Select>
                <span className="field-row-hint">{t("of each month")}</span>
              </>
            ) : (
              <>
                <Select
                  small
                  aria-label={t("Which class")}
                  value={String(due.nth)}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      due: {
                        type: "nthClass",
                        nth: event.target.value === "last" ? "last" : Number(event.target.value),
                      },
                    })
                  }
                >
                  {NTH_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {t(option.label)}
                    </option>
                  ))}
                </Select>
                <span className="field-row-hint">{t("of the month")}</span>
              </>
            )}
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
                    { group: members.length - adjustedIds.length, count: adjustedIds.length },
                  )}
                </span>
                {adjustedIds.map((id) => {
                  const student = members.find((item) => item.id === id);
                  const adjustment = draft.adjustments[id];
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
                          })
                        }
                      >
                        <option value="perClass">{t("Per class")}</option>
                        <option value="customFee">{t("Other fee")}</option>
                      </Select>
                      {adjustment.mode === "customFee" ? (
                        <MoneyInput
                          label={t("Fee for {name}", { name: student.fullName })}
                          value={adjustment.fee ?? ""}
                          onChange={(value) =>
                            setAdjustment(id, { mode: "customFee", fee: value === "" ? null : Number(value) })
                          }
                        />
                      ) : (
                        <span className="field-row-hint">
                          {t("{amount} per class attended", { amount: formatMoney(perClass, locale) })}
                        </span>
                      )}
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
              </div>
            </FieldRow>
          ) : null}
          {switching && setApplyFrom ? (
            <FieldRow label={t("Apply from")}>
              <div className="billing-adjustments">
                <Segmented
                  tone="soft"
                  value={applyFrom}
                  label={t("Apply from")}
                  onChange={setApplyFrom}
                  items={[
                    { value: "next", label: capitalize(nextMonth), raw: true },
                    { value: "current", label: "This month" },
                  ]}
                />
                <span className="field-row-hint">
                  {applyFrom === "current"
                    ? t("The {month} fee is created and what they already paid per class is discounted:", {
                        month: thisMonth,
                      })
                    : t("{month} is still charged per class. Monthly fees start in {next}.", {
                        month: thisMonth,
                        next: nextMonth,
                      })}
                </span>
                {credits.length ? (
                  <div className="billing-credits">
                    {credits.map((item) => (
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
        </>
      )}
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
            <span className="billing-total">{formatMoney(perClass * Math.max(members.length, 1), locale)}</span>
            <span className="field-row-hint">
              {members.length
                ? t(members.length === 1 ? "{count} student × {amount}" : "{count} students × {amount}", {
                    count: members.length,
                    amount: formatMoney(perClass, locale),
                  })
                : t("per student, no students yet")}
            </span>
          </>
        )}
      </FieldRow>
    </div>
  );
}

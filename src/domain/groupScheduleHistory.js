import { isDateOnly } from "./dates.js";

function slots(value) {
  return (Array.isArray(value) ? value : []).map((slot) => ({
    id: String(slot?.id || "").trim(),
    dayOfWeek: Number(slot?.dayOfWeek),
    startTime: String(slot?.startTime || "").trim(),
    durationHours: Number(slot?.durationHours),
  }));
}

/** Each snapshot is the weekly schedule before `until` (exclusive). The current editor stays unchanged. */
export function normalizeGroupScheduleHistory(value) {
  return (Array.isArray(value) ? value : [])
    .filter((item) => isDateOnly(item?.until) && Array.isArray(item.weeklySchedule))
    .map((item) => ({ until: item.until, weeklySchedule: slots(item.weeklySchedule) }))
    .sort((a, b) => a.until.localeCompare(b.until))
    .filter((item, index, all) => !index || item.until !== all[index - 1].until);
}

export function preserveGroupSchedule(previous, next, date) {
  const history = normalizeGroupScheduleHistory(previous?.scheduleHistory);
  if (JSON.stringify(slots(previous?.weeklySchedule)) !== JSON.stringify(slots(next.weeklySchedule))) {
    // Several edits on the same day keep the schedule from before the first edit that day.
    if (!history.some((item) => item.until === date)) {
      history.push({ until: date, weeklySchedule: slots(previous?.weeklySchedule) });
    }
  }
  const { scheduleHistory: _draftHistory, ...fields } = next;
  return history.length ? { ...fields, scheduleHistory: normalizeGroupScheduleHistory(history) } : fields;
}

/** Recorded classes and exceptions may still refer to slots removed from the current timetable. */
export function groupScheduleSlots(group) {
  return [
    ...(group?.weeklySchedule || []),
    ...normalizeGroupScheduleHistory(group?.scheduleHistory).flatMap((item) => item.weeklySchedule),
  ];
}

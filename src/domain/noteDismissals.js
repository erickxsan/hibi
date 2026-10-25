// Home notices the teacher marked as seen («Antes de empezar» and «Para atender»). Each notice gets keys
// built from what caused it (the newest unpaid class, the newest absence, the grade, the month, each
// unrecorded class), so a seen notice stays hidden until something new happens and then comes back on
// its own. Stored in settings so it syncs across devices.

const KEEP_DAYS = 180;
const MAX_ENTRIES = 1000;

/** Stable key of a student's note, or "" for notes that cannot be dismissed. */
export function noteKey(studentId, note) {
  if (!studentId || !note) return "";
  switch (note.kind) {
    case "owes":
      return note.latest ? `owes:${studentId}:${note.latest}` : "";
    case "absences":
      return note.lastAbsence ? `absences:${studentId}:${note.lastAbsence}` : "";
    case "ungraded":
      return `ungraded:${studentId}:${note.gradeId || note.assessment}`;
    case "monthlyPending":
      return `monthly:${studentId}:${note.period}`;
    default:
      return "";
  }
}

/** A notice is seen when it has keys and every one of them was marked as seen. */
export function allSeen(dismissedNotes, keys) {
  return Boolean(keys.length && dismissedNotes && keys.every((key) => Object.hasOwn(dismissedNotes, key)));
}

function daysBefore(date, days) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}

/**
 * Marks keys as seen (`dismissed`) or shows them again, dropping entries older than ~6 months so the
 * record never grows without bound. Values are the date the note was marked as seen.
 */
export function updateDismissedNotes(dismissedNotes, keys, dismissed, today) {
  const cutoff = daysBefore(today, KEEP_DAYS);
  const next = Object.fromEntries(
    Object.entries(dismissedNotes || {}).filter(([, date]) => typeof date === "string" && date >= cutoff),
  );
  for (const key of keys.filter(Boolean)) {
    if (dismissed) next[key] = today;
    else delete next[key];
  }
  const entries = Object.entries(next);
  if (entries.length <= MAX_ENTRIES) return next;
  return Object.fromEntries(entries.sort(([, left], [, right]) => right.localeCompare(left)).slice(0, MAX_ENTRIES));
}

/** Keeps only `{ key: "YYYY-MM-DD" }` pairs from stored settings. */
export function normalizeDismissedNotes(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(([key, date]) => key && typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)),
  );
}

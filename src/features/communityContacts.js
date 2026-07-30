export const CONTACT_VIEWS = Object.freeze({
  STUDENT_EMAIL: "studentEmail",
  GUARDIAN_PHONE: "guardianPhone",
  STUDENT_PHONE: "studentPhone",
});

function clean(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

export function extractLegacyGuardianPhone(value) {
  const text = clean(value);
  if (!text) return "";
  const candidates = text.match(/\+?(?:\d[\s().-]*){7,}/g) || [];
  return candidates.map((candidate) => candidate.trim()).find((candidate) => candidate.replace(/\D/g, "").length >= 7) || "";
}

export function contactForStudent(student, view) {
  if (view === CONTACT_VIEWS.GUARDIAN_PHONE) {
    const direct = clean(student?.guardianPhone ?? student?.parentPhone);
    const legacy = direct ? "" : extractLegacyGuardianPhone(student?.guardianContact);
    return { value: direct || legacy, inferred: Boolean(legacy) };
  }
  if (view === CONTACT_VIEWS.STUDENT_PHONE) {
    return { value: clean(student?.phone ?? student?.studentPhone), inferred: false };
  }
  return { value: clean(student?.studentEmail ?? student?.email), inferred: false };
}

export function primaryContactForStudent(student) {
  const priority = [
    [CONTACT_VIEWS.STUDENT_EMAIL, "Student email"],
    [CONTACT_VIEWS.GUARDIAN_PHONE, "Guardian phone"],
    [CONTACT_VIEWS.STUDENT_PHONE, "Student phone"],
  ];
  for (const [view, label] of priority) {
    const contact = contactForStudent(student, view);
    if (contact.value) return { ...contact, view, label };
  }
  return { value: "", inferred: false, view: CONTACT_VIEWS.STUDENT_EMAIL, label: "No contact" };
}

export function groupContactRows(students, view, { missingOnly = false } = {}) {
  const rows = (Array.isArray(students) ? students : []).map((student) => {
    const contact = contactForStudent(student, view);
    return { student, ...contact, available: Boolean(contact.value) };
  });
  return missingOnly ? rows.filter((row) => !row.available) : rows;
}

export function uniqueAvailableContacts(rows) {
  const seen = new Set();
  const contacts = [];
  for (const row of rows || []) {
    const value = clean(row?.value);
    if (!value) continue;
    const key = value.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    contacts.push(value);
  }
  return contacts;
}

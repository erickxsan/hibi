function clean(value) {
  return String(value ?? "").trim();
}

function normalizedName(value) {
  return clean(value).toLowerCase();
}

export function normalizeClassSessionIdentity(value, studentId = "") {
  const key = clean(value);
  if (!key) return null;

  const parts = key.split("|");
  if (parts.length !== 3) return key;

  const owner = clean(parts[1]);
  if (owner === "__individual__") parts[1] = `s:${clean(studentId)}`;
  else if (owner && !owner.startsWith("g:") && !owner.startsWith("s:")) parts[1] = `g:${owner}`;
  return parts.map(clean).join("|");
}

/**
 * Group-scoped reports only accept an explicit group owner in the session key.
 * Legacy grades without a parseable owner stay available in student/global views
 * but are not attributed to every group on the student's current roster.
 */
export function classSessionGroupId(value, studentId = "") {
  const session = normalizeClassSessionIdentity(value, studentId);
  if (!session) return null;

  const parts = session.split("|");
  if (parts.length !== 3 || !parts[0] || !parts[2] || !parts[1].startsWith("g:")) return null;
  return clean(parts[1].slice(2)) || null;
}

export function gradeGroupId(record = {}) {
  return classSessionGroupId(record.classSessionKey, record.studentId);
}

export function classSessionIdentity(item = {}) {
  const owner = item.groupId ? `g:${clean(item.groupId)}` : `s:${clean(item.studentId)}`;
  return `${clean(item.classDate ?? item.date)}|${owner}|${clean(item.startTime)}`;
}

export function classRecordIdentity(record = {}) {
  const studentId = clean(record.studentId);
  const classDate = clean(record.classDate);
  const startTime = clean(record.startTime);
  return studentId && classDate && startTime ? [studentId, classDate, startTime].join("\u0000") : null;
}

export function gradeIdentity(record = {}) {
  const studentId = clean(record.studentId);
  const session = normalizeClassSessionIdentity(record.classSessionKey, studentId);
  return studentId && session ? [studentId, session].join("\u0000") : null;
}

export function workspaceEntityIdentity(collection, record = {}) {
  let identity = null;
  if (collection === "groups") identity = normalizedName(record.name);
  else if (collection === "students") identity = normalizedName(record.code);
  else if (collection === "classLog") identity = classRecordIdentity(record);
  else if (collection === "grades") identity = gradeIdentity(record);
  return identity ? `${collection}:${identity}` : null;
}

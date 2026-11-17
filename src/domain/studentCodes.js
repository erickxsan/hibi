/**
 * The next free «HIBI-001»-style student IDs. Codes are compared the way validation compares them
 * (trimmed, case-insensitive), so a generated ID never collides with one already in use.
 */
export function nextStudentCodes(students, count) {
  const used = new Set(
    (Array.isArray(students) ? students : []).map((student) =>
      String(student?.code || "")
        .trim()
        .toLocaleLowerCase(),
    ),
  );
  const codes = [];
  let candidate = 1;
  while (codes.length < count) {
    const code = `HIBI-${String(candidate).padStart(3, "0")}`;
    if (!used.has(code.toLocaleLowerCase())) codes.push(code);
    candidate += 1;
  }
  return codes;
}

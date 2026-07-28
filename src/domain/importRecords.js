import { importState, serializeState } from "./storage.js";

export const IMPORT_COLLECTIONS = [
  "groups",
  "students",
  "grades",
  "classLog",
  "classSchedules",
  "scheduleExceptions",
  "scheduleChanges",
];

const COLLECTION_LABELS = {
  groups: "Groups",
  students: "Students",
  grades: "Grades",
  classLog: "Class records",
  classSchedules: "Class schedules",
  scheduleExceptions: "Schedule exceptions",
  scheduleChanges: "Schedule changes",
};

function normalizedText(value) {
  return String(value ?? "").trim().toLocaleLowerCase();
}

function stableValue(value, key = "") {
  if (Array.isArray(value)) {
    const items = value.map((item) => stableValue(item));
    return key === "groupIds" || key === "daysOfWeek" ? items.sort() : items;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((childKey) => [childKey, stableValue(value[childKey], childKey)]));
  }
  return value;
}

function comparable(record) {
  const { id: _id, ...fields } = record;
  return JSON.stringify(stableValue(fields));
}

function businessKey(collection, record) {
  switch (collection) {
    case "groups":
      return normalizedText(record.name) || null;
    case "students":
      return normalizedText(record.code) || null;
    case "grades":
      return [record.studentId, record.date, normalizedText(record.assessment), normalizedText(record.category), record.maxScore ?? ""]
        .join("\u0000");
    case "classLog":
      return [record.studentId, record.classDate, record.startTime || ""].join("\u0000");
    case "classSchedules":
      return [record.format, record.groupId || record.studentId, record.recurrence, record.startDate, record.startTime, [...(record.daysOfWeek || [])].sort().join(",")]
        .join("\u0000");
    case "scheduleExceptions":
      return [record.scheduleSlotId, record.occurrenceDate, record.classDate, record.startTime].join("\u0000");
    case "scheduleChanges":
      return [record.scheduleSlotId, record.effectiveFrom, record.dayOfWeek, record.startTime].join("\u0000");
    default:
      return null;
  }
}

function recordLabel(collection, record, context) {
  if (collection === "groups") return record.name || "Unnamed group";
  if (collection === "students") return record.fullName || record.code || "Unnamed student";
  const student = context.studentsById.get(record.studentId);
  if (collection === "grades") return `${student?.fullName || "Student"} · ${record.assessment || record.date}`;
  if (collection === "classLog") return `${student?.fullName || "Student"} · ${record.classDate}${record.startTime ? ` ${record.startTime}` : ""}`;
  if (collection === "classSchedules") return `${record.format === "individual" ? student?.fullName || "Individual" : context.groupsById.get(record.groupId)?.name || "Group"} · ${record.startDate} ${record.startTime}`;
  if (collection === "scheduleExceptions") return `Exception · ${record.occurrenceDate || record.classDate}`;
  return `Schedule change · ${record.effectiveFrom}`;
}

function remapRecord(collection, source, groupIdMap, studentIdMap) {
  const record = { ...source };
  if (record.groupId) record.groupId = groupIdMap.get(record.groupId) || record.groupId;
  if (record.studentId) record.studentId = studentIdMap.get(record.studentId) || record.studentId;
  if (Array.isArray(record.groupIds)) {
    record.groupIds = [...new Set(record.groupIds.map((id) => groupIdMap.get(id) || id))];
  }
  if (collection === "groups" && Array.isArray(record.weeklySchedule)) {
    record.weeklySchedule = record.weeklySchedule.map((slot) => ({ ...slot }));
  }
  if (Array.isArray(record.daysOfWeek)) record.daysOfWeek = [...record.daysOfWeek];
  return record;
}

function emptyCollectionSummary() {
  return { added: 0, duplicates: 0, conflicts: 0, updated: 0, kept: 0 };
}

/**
 * Builds a deterministic, non-destructive import candidate. Current settings
 * and every current record are retained unless a conflict is explicitly set
 * to `use-imported`; even then the stable existing ID is preserved.
 */
export function buildImportPlan(currentInput, importedInput, decisions = {}) {
  const current = importState(serializeState(currentInput));
  const imported = importState(serializeState(importedInput));
  const candidate = { ...current };
  for (const collection of IMPORT_COLLECTIONS) candidate[collection] = [...current[collection]];

  const entries = [];
  const groupIdMap = new Map();
  const studentIdMap = new Map();
  const context = {
    groupsById: new Map(current.groups.map((item) => [item.id, item])),
    studentsById: new Map(current.students.map((item) => [item.id, item])),
  };

  for (const collection of IMPORT_COLLECTIONS) {
    const currentItems = candidate[collection];
    const byId = new Map(currentItems.map((item) => [item.id, item]));
    const byBusinessKey = new Map();
    for (const item of currentItems) {
      const key = businessKey(collection, item);
      if (key && !byBusinessKey.has(key)) byBusinessKey.set(key, item);
    }

    imported[collection].forEach((source, index) => {
      const importedId = source.id;
      const remapped = remapRecord(collection, source, groupIdMap, studentIdMap);
      const key = businessKey(collection, remapped);
      const existing = byId.get(remapped.id) || (key ? byBusinessKey.get(key) : null);
      const entryKey = `${collection}:${importedId || index}:${existing?.id || "new"}`;
      let status = "new";
      let reason = "New record";
      let decision = "add";

      if (existing) {
        remapped.id = existing.id;
        if (comparable(existing) === comparable(remapped)) {
          status = "duplicate";
          reason = "Exact duplicate";
          decision = "skip";
        } else {
          status = "conflict";
          reason = byId.has(importedId) ? "Same stable ID, different information" : "Same identifying information, different details";
          decision = decisions[entryKey] === "use-imported" ? "use-imported" : "keep-current";
        }
      }

      const finalId = existing?.id || remapped.id;
      if (collection === "groups") groupIdMap.set(importedId, finalId);
      if (collection === "students") studentIdMap.set(importedId, finalId);

      const entry = {
        key: entryKey,
        collection,
        collectionLabel: COLLECTION_LABELS[collection],
        label: recordLabel(collection, remapped, context),
        status,
        reason,
        decision,
        existingId: existing?.id || null,
        importedId,
      };
      entries.push(entry);

      if (status === "new") {
        currentItems.push(remapped);
        byId.set(remapped.id, remapped);
        if (key && !byBusinessKey.has(key)) byBusinessKey.set(key, remapped);
      } else if (status === "conflict" && decision === "use-imported") {
        const existingIndex = currentItems.findIndex((item) => item.id === existing.id);
        currentItems[existingIndex] = remapped;
        byId.set(remapped.id, remapped);
        if (key) byBusinessKey.set(key, remapped);
      }

      if (collection === "groups") context.groupsById.set(finalId, status === "conflict" && decision !== "use-imported" ? existing : remapped);
      if (collection === "students") context.studentsById.set(finalId, status === "conflict" && decision !== "use-imported" ? existing : remapped);
    });
  }

  const canonicalCandidate = importState(serializeState(candidate));
  const byCollection = Object.fromEntries(IMPORT_COLLECTIONS.map((collection) => [collection, emptyCollectionSummary()]));
  const summary = { added: 0, duplicates: 0, conflicts: 0, updated: 0, kept: 0, byCollection };
  for (const entry of entries) {
    const collectionSummary = byCollection[entry.collection];
    if (entry.status === "new") {
      summary.added += 1;
      collectionSummary.added += 1;
    } else if (entry.status === "duplicate") {
      summary.duplicates += 1;
      collectionSummary.duplicates += 1;
    } else {
      summary.conflicts += 1;
      collectionSummary.conflicts += 1;
      if (entry.decision === "use-imported") {
        summary.updated += 1;
        collectionSummary.updated += 1;
      } else {
        summary.kept += 1;
        collectionSummary.kept += 1;
      }
    }
  }

  const signature = JSON.stringify(entries.map(({ key, status, existingId }) => [key, status, existingId]));
  return { candidate: canonicalCandidate, entries, summary, signature };
}


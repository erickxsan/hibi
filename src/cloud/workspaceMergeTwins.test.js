import { describe, expect, it } from "vitest";
import {
  createClassLogRow,
  createGrade,
  createGroup,
  createScheduleException,
  createStarterState,
  createStudent,
  normalizeState,
  validateState,
} from "../domain/index.js";
import { calculateOutstanding } from "../domain/calculations.js";
import { twinKey } from "../domain/recordTwins.js";
import { describeOperation, mergeWorkspaceStates } from "./workspaceMerge.js";

// Thursday's class of the group: the tablet and the phone record it without seeing each other (audit B2, F4c).
const DATE = "2026-11-12";
const SESSION = `${DATE}|g:g|16:00`;

function base(extra = {}) {
  return normalizeState({
    ...createStarterState({ settings: { asOfDate: "2026-11-13", hourlyRate: 100 } }),
    groups: [createGroup({ id: "g", name: "Grupo", hourlyRate: 100 }), createGroup({ id: "h", name: "Otro" })],
    students: ["ana", "beto"].map((id) =>
      createStudent({ id, code: id, fullName: id, groupIds: ["g", "h"], status: "Active" }),
    ),
    ...extra,
  });
}

const present = { attendance: "P", appliedCharge: 200, paymentState: "Pending" };
const paid = { ...present, amountPaid: 200, paymentState: "Paid", paymentDate: DATE, paymentMethod: "Cash" };
const absent = { attendance: "A", appliedCharge: 0, paymentState: "" };
const unmarked = { attendance: null, appliedCharge: 0, paymentState: "" };

function row(id, studentId, marks = {}, overrides = {}) {
  return createClassLogRow({
    id,
    studentId,
    groupId: "g",
    classDate: DATE,
    startTime: "16:00",
    classTitle: "Grupo",
    classStatus: "Completed",
    hours: 2,
    appliedHourlyRate: 100,
    amountPaid: 0,
    paymentDate: null,
    ...marks,
    ...overrides,
  });
}

const withRows = (state, ...rows) => ({ ...state, classLog: [...state.classLog, ...rows] });
const keysOf = (state, collection = "classLog") => state[collection].map((item) => twinKey(collection, item));
const rowOf = (state, studentId) => state.classLog.filter((item) => item.studentId === studentId);

describe("the same class saved on two devices (twin records)", () => {
  it("F4c: keeps one row per student and sends contradicting marks to review instead of hiding a paid class", () => {
    const start = base();
    const tablet = withRows(start, row("tab-ana", "ana", paid), row("tab-beto", "beto", present));
    const phone = withRows(start, row("pho-ana", "ana", present), row("pho-beto", "beto", absent));

    const merged = mergeWorkspaceStates({ base: start, local: tablet, remote: phone });
    expect(merged.state.classLog.map(({ id }) => id)).toEqual(["pho-ana", "pho-beto"]);
    expect(merged.conflicts).toEqual([
      {
        collection: "classLog",
        entityId: "tab-ana",
        kind: "duplicate",
        // A field empty on one side (paymentDate) takes the other side's value: it is not a contradiction.
        fields: ["amountPaid", "paymentState", "paymentMethod"],
        twinId: "pho-ana",
      },
      {
        collection: "classLog",
        entityId: "tab-beto",
        kind: "duplicate",
        fields: ["attendance", "appliedCharge", "paymentState"],
        twinId: "pho-beto",
      },
    ]);

    // «Conservar la versión de este dispositivo»: the tablet's marks on the phone's records, nothing else added.
    const kept = mergeWorkspaceStates({ base: start, local: tablet, remote: phone, prefer: "local" });
    expect(kept.state.classLog.map(({ id }) => id)).toEqual(["pho-ana", "pho-beto"]);
    expect(rowOf(kept.state, "ana")[0]).toMatchObject({ ...paid, id: "pho-ana" });
    expect(rowOf(kept.state, "beto")[0]).toMatchObject({ ...present, id: "pho-beto" });
    expect(calculateOutstanding(kept.state, rowOf(kept.state, "ana")[0], "2026-11-13")).toBe(0);
    expect(validateState(kept.state).warnings.filter((item) => item.code === "duplicate_student_class")).toEqual([]);
  });

  it("folds identical saves silently, keeping the cloud's ids", () => {
    const start = base();
    const tablet = withRows(start, row("tab-ana", "ana", paid), row("tab-beto", "beto", absent));
    const phone = withRows(start, row("pho-ana", "ana", paid), row("pho-beto", "beto", absent));
    const merged = mergeWorkspaceStates({ base: start, local: tablet, remote: phone });
    expect(merged).toEqual({ state: phone, conflicts: [] });
  });

  it("takes the marks of the side that has them when the other saved the class unmarked", () => {
    const start = base();
    const marked = withRows(start, row("tab-ana", "ana", paid), row("tab-beto", "beto", absent));
    const blank = withRows(start, row("pho-ana", "ana", unmarked), row("pho-beto", "beto", unmarked));

    const onto = mergeWorkspaceStates({ base: start, local: marked, remote: blank });
    expect(onto.conflicts).toEqual([]);
    expect(onto.state.classLog).toEqual([
      { ...marked.classLog[0], id: "pho-ana" },
      { ...marked.classLog[1], id: "pho-beto" },
    ]);

    const under = mergeWorkspaceStates({ base: start, local: blank, remote: marked });
    expect(under).toEqual({ state: marked, conflicts: [] });
  });

  it("does not invent twins for rows without a start time", () => {
    const start = base();
    const tablet = withRows(start, row("tab-ana", "ana", paid, { startTime: "" }));
    const phone = withRows(start, row("pho-ana", "ana", present, { startTime: "" }));
    const merged = mergeWorkspaceStates({ base: start, local: tablet, remote: phone });
    expect(merged.conflicts).toEqual([]);
    expect(merged.state.classLog.map(({ id }) => id)).toEqual(["pho-ana", "tab-ana"]);
  });

  it("sends a class cancelled on one device and recorded on the other to review", () => {
    const start = base();
    const cancelled = withRows(start, row("tab-ana", "ana", { ...unmarked, classStatus: "Cancelled" }));
    const recorded = withRows(start, row("pho-ana", "ana", paid));
    const merged = mergeWorkspaceStates({ base: start, local: cancelled, remote: recorded });
    expect(merged.state.classLog.map(({ id }) => id)).toEqual(["pho-ana"]);
    expect(merged.conflicts[0]).toMatchObject({ kind: "duplicate", twinId: "pho-ana" });
    expect(merged.conflicts[0].fields).toEqual(
      expect.arrayContaining(["classStatus", "appliedCharge", "amountPaid", "paymentState"]),
    );
  });

  it("keeps the recorded rows when the other device removed the scheduled class", () => {
    const start = base();
    const recorded = withRows(start, row("tab-ana", "ana", paid));
    const removed = {
      ...start,
      scheduleExceptions: [
        createScheduleException({
          id: "x",
          sourceGroupId: "g",
          groupId: "g",
          occurrenceDate: DATE,
          status: "Cancelled",
        }),
      ],
    };
    const merged = mergeWorkspaceStates({ base: start, local: recorded, remote: removed });
    expect(merged.conflicts).toEqual([]);
    expect(merged.state.classLog).toEqual(recorded.classLog);
    expect(merged.state.scheduleExceptions).toEqual(removed.scheduleExceptions);
  });

  it("leaves duplicates already stored, and pairs this device saved knowingly, as they were", () => {
    const stored = withRows(base(), row("old-1", "ana", paid), row("old-2", "ana", present));
    // Such a workspace still loads (no lockout); validation flags the pair, which is how to find them.
    const validation = validateState(stored);
    expect(validation.valid).toBe(true);
    expect(validation.warnings.filter((item) => item.code === "duplicate_student_class")).toHaveLength(1);
    const edited = {
      ...stored,
      classLog: stored.classLog.map((item) => (item.id === "old-2" ? { ...item, notes: "Late" } : item)),
    };
    const elsewhere = { ...stored, settings: { ...stored.settings, hourlyRate: 120 } };
    const merged = mergeWorkspaceStates({ base: stored, local: edited, remote: elsewhere });
    expect(merged.conflicts).toEqual([]);
    expect(merged.state.classLog).toEqual(edited.classLog);

    // A row of another group at the same time, saved while this device saw the first one.
    const individual = withRows(base(), row("ind", "ana", paid, { groupId: "" }));
    const second = withRows(individual, row("grp", "ana", present, { groupId: "h" }));
    const rebased = mergeWorkspaceStates({
      base: individual,
      local: second,
      remote: { ...individual, settings: { ...individual.settings, hourlyRate: 120 } },
    });
    expect(rebased.conflicts).toEqual([]);
    expect(rebased.state.classLog.map(({ id }) => id)).toEqual(["ind", "grp"]);
  });

  it("lands a later offline edit of the folded record, and its lost-payment mark, on the record that stayed", () => {
    const start = base();
    const created = withRows(start, row("tab-ana", "ana", present));
    const cloud = withRows(start, row("pho-ana", "ana", present));
    // The first queued edit created the row; the cloud already had the same class.
    const first = mergeWorkspaceStates({ base: start, local: created, remote: cloud });
    expect(first).toEqual({ state: cloud, conflicts: [] });

    // The second queued edit marked that row paid and the class as a lost payment (references by class id).
    const edited = {
      ...created,
      classLog: created.classLog.map((item) => ({ ...item, ...paid })),
      students: created.students.map((student) =>
        student.id === "ana"
          ? { ...student, lostPayments: [{ kind: "class", classId: "tab-ana", lostAt: DATE }] }
          : student,
      ),
    };
    const second = mergeWorkspaceStates({ base: created, local: edited, remote: first.state });
    expect(second.conflicts).toEqual([]);
    expect(second.state.classLog).toEqual([{ ...edited.classLog[0], id: "pho-ana" }]);
    expect(second.state.students.find((student) => student.id === "ana").lostPayments).toEqual([
      { kind: "class", classId: "pho-ana", lostAt: DATE },
    ]);

    // Without a twin the edit of a removed record is still a decision.
    const gone = mergeWorkspaceStates({ base: created, local: edited, remote: start });
    expect(gone.conflicts).toEqual([{ collection: "classLog", entityId: "tab-ana", kind: "edit-delete", fields: [] }]);
  });

  it("does the same for the grade of one assignment, and keeps grades of different assignments", () => {
    const start = base();
    const grade = (id, overrides) =>
      createGrade({
        id,
        date: DATE,
        studentId: "ana",
        assessment: "Quiz 1",
        score: 8,
        maxScore: 10,
        classSessionKey: SESSION,
        ...overrides,
      });
    const tablet = { ...start, grades: [grade("tab-q")] };
    const same = mergeWorkspaceStates({ base: start, local: tablet, remote: { ...start, grades: [grade("pho-q")] } });
    expect(same.conflicts).toEqual([]);
    expect(same.state.grades.map(({ id }) => id)).toEqual(["pho-q"]);

    const other = mergeWorkspaceStates({
      base: start,
      local: tablet,
      remote: { ...start, grades: [grade("pho-q", { score: 6 })] },
    });
    expect(other.conflicts).toEqual([
      { collection: "grades", entityId: "tab-q", kind: "duplicate", fields: ["score"], twinId: "pho-q" },
    ]);
    expect(
      mergeWorkspaceStates({ base: start, local: tablet, remote: other.state, prefer: "local" }).state.grades,
    ).toEqual([grade("pho-q")]);

    const apart = mergeWorkspaceStates({
      base: start,
      local: tablet,
      remote: { ...start, grades: [grade("pho-t", { assessment: "Tarea" })] },
    });
    expect(apart.conflicts).toEqual([]);
    expect(apart.state.grades.map(({ id }) => id)).toEqual(["pho-t", "tab-q"]);
  });

  it("describes a twin conflict against the cloud's record of the same class", () => {
    const start = base();
    const tablet = withRows(start, row("tab-ana", "ana", paid));
    const phone = withRows(start, row("pho-ana", "ana", present));
    const { changes } = describeOperation({ previousState: start, state: tablet }, phone);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      collection: "classLog",
      entityId: "tab-ana",
      kind: "create",
      conflict: "duplicate",
      before: null,
      cloud: phone.classLog[0],
    });
    expect(changes[0].fields.map(({ field, local, cloud, conflict }) => [field, local, cloud, conflict])).toEqual([
      ["amountPaid", 200, 0, true],
      ["paymentState", "Paid", "Pending", true],
      ["paymentDate", DATE, null, false],
      ["paymentMethod", "Cash", "", true],
    ]);
  });

  it("never adds a twin nor drops a mark without review, for any pair of concurrent saves", () => {
    // Small deterministic generator: both devices create rows for a few students, dates and times.
    let seed = 7;
    const random = (n) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const markings = [paid, present, absent, unmarked, { ...unmarked, classStatus: "Cancelled" }];
    const times = ["16:00", "17:00", ""];
    // Like the Classes screen, a device never adds a second row for a class it can see.
    const create = (prefix, state) => {
      const rows = [];
      const taken = new Set(state.classLog.map((item) => `${item.studentId}|${item.startTime}`));
      for (let index = 0; index < 4; index += 1) {
        const studentId = ["ana", "beto"][random(2)];
        const startTime = times[random(3)];
        const key = `${studentId}|${startTime}`;
        if (startTime && taken.has(key)) continue;
        taken.add(key);
        rows.push(row(`${prefix}-${index}`, studentId, markings[random(markings.length)], { startTime }));
      }
      return withRows(state, ...rows);
    };
    for (let round = 0; round < 200; round += 1) {
      const start = random(2) ? base() : withRows(base(), row("stored", "ana", present));
      const local = create("l", start);
      const remote = create("r", start);
      for (const prefer of ["none", "local"]) {
        const { state, conflicts } = mergeWorkspaceStates({ base: start, local, remote, prefer });
        const keys = keysOf(state).filter(Boolean);
        expect(new Set(keys).size).toBe(keys.length);
        if (prefer === "local" || conflicts.length) continue;
        // Without a review, every mark from either device is in the result.
        for (const item of [...local.classLog, ...remote.classLog]) {
          const key = twinKey("classLog", item);
          const kept = key
            ? state.classLog.find((other) => twinKey("classLog", other) === key)
            : state.classLog.find((other) => other.id === item.id);
          if (item.attendance || item.amountPaid > 0 || item.classStatus === "Cancelled") {
            expect(kept).toMatchObject({
              attendance: item.attendance,
              amountPaid: item.amountPaid,
              classStatus: item.classStatus,
            });
          }
        }
      }
    }
  });
});

// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { canonicalStudent, useClassManager } from "./useClassManager.js";
import { createGroup, createStarterState, createStudent } from "../domain/index.js";
import { deriveMonthlyCharges } from "../domain/monthlyBilling.js";
import { markLost } from "../domain/lostPayments.js";

const AS_OF = "2026-10-21";
const FEE = { studentId: "luna", kind: "monthly", groupId: "g-month", period: "2026-10" };
const CLASS = { studentId: "diego", kind: "class", classId: "old-class" };

function workspace() {
  const state = createStarterState({ settings: { onboardingVersion: 2, asOfDate: AS_OF } });
  state.groups = [
    createGroup({
      id: "g-month",
      name: "Prepa",
      billing: { mode: "monthly", monthlyFee: 800, due: { type: "dayOfMonth", day: 5 }, effectiveFrom: "2026-10" },
    }),
    createGroup({ id: "g-class", name: "Sec", hourlyRate: 125 }),
  ];
  state.students = [
    createStudent({ id: "luna", code: "L-1", fullName: "Luna Ortiz", groupIds: ["g-month"] }),
    createStudent({ id: "diego", code: "D-1", fullName: "Diego Mora", groupIds: ["g-class"] }),
  ];
  state.classLog = [
    {
      id: "old-class",
      classDate: "2026-08-12",
      studentId: "diego",
      groupId: "g-class",
      startTime: "17:00",
      classStatus: "Completed",
      attendance: "P",
      hours: 2,
      appliedHourlyRate: 125,
      appliedCharge: 250,
      amountPaid: 0,
      paymentState: "Pending",
      paymentDate: null,
      paymentMethod: "",
      paymentReference: "",
      notes: "",
    },
  ];
  return state;
}

function setup(state = workspace()) {
  const persistence = { initialState: state, mode: "cloud", save: vi.fn(async (next) => next) };
  const hook = renderHook(() => useClassManager({ persistence }));
  const manager = () => hook.result.current;
  const student = (id) => manager().state.students.find((item) => item.id === id);
  const undo = async () => {
    const toast = manager().toasts.at(-1);
    expect(toast.action.label).toBe("Undo");
    await act(async () => {
      await toast.action.run();
    });
  };
  return { manager, student, undo };
}

describe("giving up on debts through the manager", () => {
  it("marks a debt today and takes the mark back from the notice", async () => {
    const { manager, student, undo } = setup();
    await act(async () => {
      expect(await manager().actions.giveUpPayments([FEE], "Lost")).toBe(true);
    });
    expect(student("luna").lostPayments).toEqual([
      { kind: "monthly", groupId: "g-month", period: "2026-10", lostAt: AS_OF },
    ]);
    await undo();
    expect(student("luna")).not.toHaveProperty("lostPayments");
  });

  it("undoing a recovery restores the day it was first given up", async () => {
    const { manager, student, undo } = setup(markLost(workspace(), [FEE], "2026-10-10"));
    await act(async () => {
      await manager().actions.recoverPayments([{ ...FEE, lostAt: "2026-10-10" }], "Recovered");
    });
    expect(student("luna")).not.toHaveProperty("lostPayments");
    await undo();
    expect(student("luna").lostPayments[0].lostAt).toBe("2026-10-10");
  });

  it("pays a class in full and puts it back exactly as it was", async () => {
    const { manager, undo } = setup();
    await act(async () => {
      await manager().actions.markClassPaid("old-class", "Paid");
    });
    expect(manager().state.classLog[0]).toMatchObject({
      amountPaid: 250,
      paymentDate: AS_OF,
      paymentMethod: "Cash",
      paymentState: "Paid",
    });
    await undo();
    expect(manager().state.classLog[0]).toMatchObject({ amountPaid: 0, paymentDate: null, paymentState: "Pending" });
  });

  it("leaves alone a class that was already paid, with its real payment day", async () => {
    const state = workspace();
    state.classLog[0] = {
      ...state.classLog[0],
      amountPaid: 250,
      paymentDate: "2026-10-01",
      paymentMethod: "Transfer",
      paymentState: "Paid",
    };
    const { manager } = setup(state);
    await act(async () => {
      expect(await manager().actions.markClassPaid("old-class", "Paid")).toBe(false);
    });
    expect(manager().state.classLog[0]).toMatchObject({ paymentDate: "2026-10-01", paymentMethod: "Transfer" });
  });

  it("takes back only the fee payment the notice speaks of", async () => {
    const { manager, student, undo } = setup();
    const fee = { studentId: "luna", groupId: "g-month", period: "2026-10" };
    await act(async () => {
      await manager().actions.payFee(fee, 300, "First");
      await manager().actions.payFee(fee, 200, "Second");
    });
    expect(
      student("luna")
        .monthlyPayments.map((item) => item.amount)
        .sort(),
    ).toEqual([200, 300]);
    await undo();
    expect(student("luna").monthlyPayments.map((item) => item.amount)).toEqual([300]);
    const charge = deriveMonthlyCharges(manager().state, AS_OF).find((item) => item.studentId === "luna");
    expect(charge.balance).toBe(500);
  });

  it("does not offer anything when the save fails", async () => {
    const persistence = {
      initialState: workspace(),
      mode: "cloud",
      save: vi.fn(async () => {
        throw new Error("offline");
      }),
    };
    const hook = renderHook(() => useClassManager({ persistence }));
    await act(async () => {
      expect(await hook.result.current.actions.giveUpPayments([CLASS], "Lost")).toBe(false);
    });
    await waitFor(() => expect(hook.result.current.toasts.some((toast) => toast.action)).toBe(false));
  });
});

describe("saving a student around payments and marks", () => {
  it("keeps the marks through the student's canonical form and a save", async () => {
    const state = markLost(workspace(), [FEE], "2026-10-10");
    expect(canonicalStudent(state.students[0]).lostPayments).toEqual(state.students[0].lostPayments);
    const { manager, student } = setup(state);
    await act(async () => {
      await manager().actions.upsertStudent({ ...student("luna"), notes: "Llega tarde" });
    });
    expect(student("luna")).toMatchObject({ notes: "Llega tarde" });
    expect(student("luna").lostPayments).toEqual(state.students[0].lostPayments);
  });

  it("never lets an old draft take back a payment or a mark made after it", async () => {
    const { manager, student } = setup();
    const draft = { ...student("luna"), notes: "Escrito antes" };
    await act(async () => {
      await manager().actions.payFee({ studentId: "luna", groupId: "g-month", period: "2026-10" }, 300, "Paid");
      await manager().actions.giveUpPayments([FEE], "Lost");
    });
    await act(async () => {
      await manager().actions.upsertStudent(draft);
    });
    expect(student("luna").notes).toBe("Escrito antes");
    expect(student("luna").monthlyPayments.map((item) => item.amount)).toEqual([300]);
    expect(student("luna").lostPayments).toHaveLength(1);
  });

  it("does not reprice a class given up after the draft with a new rate was opened", async () => {
    const { manager, student } = setup();
    const draft = { ...student("diego"), customHourlyRate: 200 };
    await act(async () => {
      await manager().actions.giveUpPayments([CLASS], "Lost");
      await manager().actions.upsertStudent(draft);
    });
    expect(student("diego").customHourlyRate).toBe(200);
    expect(manager().state.classLog[0].appliedCharge).toBe(250);
    expect(student("diego").lostPayments).toHaveLength(1);
  });

  it("does not bring back a mark recovered after the draft was opened", async () => {
    const { manager, student } = setup(markLost(workspace(), [FEE], "2026-10-10"));
    const draft = { ...student("luna"), notes: "Escrito antes" };
    await act(async () => {
      await manager().actions.recoverPayments([FEE], "Recovered");
      await manager().actions.upsertStudent(draft);
    });
    expect(student("luna")).not.toHaveProperty("lostPayments");
  });
});

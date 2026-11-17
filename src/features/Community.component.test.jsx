// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGroup, createStarterState, createStudent } from "../domain";
import { useClassManager } from "../hooks/useClassManager";
import { I18nProvider } from "../i18n";
import { LANGUAGE_STORAGE_KEY } from "../i18n/translations";
import Community from "./Community";

const AS_OF = "2026-10-21";

function row(id, classDate, studentId, attendance, amountPaid, groupId = "g1") {
  return {
    id,
    classDate,
    studentId,
    groupId,
    startTime: "16:00",
    scheduleSlotId: "slot-mon",
    scheduleOccurrenceDate: classDate,
    classStatus: "Completed",
    attendance,
    hours: 2,
    appliedHourlyRate: 75,
    appliedCharge: attendance === "A" ? 0 : 150,
    amountPaid,
    paymentState: attendance === "A" ? "" : amountPaid ? "Paid" : "Pending",
    paymentDate: amountPaid ? classDate : null,
    paymentMethod: amountPaid ? "Cash" : "",
    paymentReference: "",
    notes: "",
  };
}

function communityState() {
  const state = createStarterState({
    settings: { onboardingVersion: 2, onboardingStep: 9, asOfDate: AS_OF, hourlyRate: 100, defaultClassHours: 2 },
  });
  state.groups = [
    createGroup({
      id: "g1",
      name: "Primaria 5A",
      hourlyRate: 75,
      weeklySchedule: [
        { id: "slot-mon", dayOfWeek: 1, startTime: "16:00", durationHours: 2 },
        { id: "slot-thu", dayOfWeek: 4, startTime: "16:00", durationHours: 2 },
      ],
    }),
    createGroup({ id: "g-old", name: "Inglés", status: "Inactive", archivedAt: "2026-09-30" }),
  ];
  state.students = [
    createStudent({
      id: "s1",
      code: "LUN-1",
      fullName: "Luna López",
      groupIds: ["g1"],
      avatarId: "rabbit",
      studentEmail: "luna@example.com",
    }),
    createStudent({
      id: "s2",
      code: "DIE-2",
      fullName: "Diego Soto",
      groupIds: ["g1"],
      avatarId: "bear",
      guardianPhone: "55 0100 0104",
    }),
    createStudent({ id: "s3", code: "CAM-3", fullName: "Camila Torres", isIndividual: true, avatarId: "cat" }),
    createStudent({ id: "s4", code: "OLD-4", fullName: "Rubén Paz", status: "Inactive", groupIds: ["g1"] }),
  ];
  state.classLog = [
    row("r1", "2026-10-05", "s1", "A", 0),
    row("r2", "2026-10-05", "s2", "P", 150),
    row("r3", "2026-10-12", "s1", "A", 0),
    row("r4", "2026-10-12", "s2", "P", 150),
    row("r5", "2026-10-19", "s1", "P", 0),
    row("r6", "2026-10-19", "s2", "P", 150),
  ];
  return state;
}

// Luna also came on Monday, September 7 (unpaid); Diego's first class is October 5.
function backdatableState() {
  const state = communityState();
  state.classLog = [row("r0", "2026-09-07", "s1", "P", 0), ...state.classLog];
  return state;
}

// Monthly since October; Bea was added on October 20 with a full first month and has no class yet.
function newcomerState() {
  const state = communityState();
  state.groups[0].billing = {
    mode: "monthly",
    monthlyFee: 900,
    due: { type: "dayOfMonth", day: 5 },
    effectiveFrom: "2026-10",
  };
  state.students.push(
    createStudent({
      id: "s5",
      code: "BEA-5",
      fullName: "Bea Ruiz",
      groupIds: ["g1"],
      avatarId: "cat",
      billingByGroup: { g1: { mode: "group", joinedOn: "2026-10-20", firstMonthAmount: 900 } },
    }),
  );
  return state;
}

function Harness({ persistence, compactView = false }) {
  const manager = useClassManager({ persistence });
  return (
    <I18nProvider>
      <Community
        {...manager}
        openPage={vi.fn()}
        registerNavigationBlocker={() => () => {}}
        initialView={compactView ? "students" : undefined}
      />
    </I18nProvider>
  );
}

function setup(state = communityState()) {
  const persistence = { initialState: state, mode: "cloud", save: vi.fn(async (next) => next) };
  const view = render(<Harness persistence={persistence} />);
  return { persistence, view, saved: () => persistence.save.mock.calls.at(-1)?.[0] };
}

function setCompact(matches) {
  window.matchMedia.mockImplementation((query) => ({
    matches,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

afterEach(() => {
  localStorage.removeItem(LANGUAGE_STORAGE_KEY);
  setCompact(false);
  vi.useRealTimers();
});

describe("Community students", () => {
  it("puts students with something pending first and shows the month in the detail", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("tab", { name: "Students" }));
    const list = screen.getByRole("navigation", { name: "Students" });
    const names = within(list)
      .getAllByRole("button", { name: /^Open / })
      .map((button) => button.getAttribute("aria-label"));
    expect(names.slice(0, 1)).toEqual(["Open Luna López"]);
    // The row names the group only; the attendance warning lives in the detail.
    expect(within(list).queryByText(/missed 2 of 3/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open Luna López" }));
    const detail = screen.getByRole("region", { name: "Luna López" });
    expect(within(detail).getByText("Missed 2 of 3")).toBeInTheDocument();
    // Every recent class is in Primaria 5A: the header names the group once and the table drops the column.
    expect(within(detail).getByRole("table")).not.toHaveTextContent("Primaria 5A");
    expect(within(detail).queryByRole("columnheader", { name: "Group" })).not.toBeInTheDocument();
  });

  it("edits a student only through «Edit student», which also holds deactivate and delete", async () => {
    const user = userEvent.setup();
    const { saved, persistence } = setup();
    await user.click(screen.getByRole("button", { name: "Open Diego Soto" }));
    const detail = screen.getByRole("region", { name: "Diego Soto" });
    // One editor: the card has no inline form and no second link.
    expect(within(detail).queryByRole("textbox")).not.toBeInTheDocument();
    expect(within(detail).queryByRole("button", { name: "Edit enrollment and rate" })).not.toBeInTheDocument();
    expect(within(detail).queryByRole("button", { name: "Deactivate student" })).not.toBeInTheDocument();
    await user.click(within(detail).getByRole("button", { name: "Edit student" }));
    const editor = await screen.findByRole("dialog", { name: "Edit student" });
    fireEvent.change(within(editor).getByLabelText("Notes"), { target: { value: "Likes drawings" } });
    await user.click(within(editor).getByRole("button", { name: "Save student" }));
    await waitFor(() => expect(saved().students.find((s) => s.id === "s2").notes).toBe("Likes drawings"));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit student" })).not.toBeInTheDocument());

    await user.click(
      within(screen.getByRole("region", { name: "Diego Soto" })).getByRole("button", { name: "Edit student" }),
    );
    const again = await screen.findByRole("dialog", { name: "Edit student" });
    expect(within(again).getByRole("button", { name: "Delete student" })).toBeInTheDocument();
    // Something typed in the editor is asked about before «Deactivate» drops it.
    fireEvent.change(within(again).getByLabelText("Notes"), { target: { value: "Typed, not saved" } });
    await user.click(within(again).getByRole("button", { name: "Deactivate student" }));
    const discard = await screen.findByRole("alertdialog", { name: "Discard your unsaved student changes?" });
    await user.click(within(discard).getByRole("button", { name: "Keep editing" }));
    expect(screen.queryByRole("dialog", { name: "Deactivate Diego Soto?" })).not.toBeInTheDocument();
    expect(within(again).getByLabelText("Notes")).toHaveValue("Typed, not saved");
    await user.click(within(again).getByRole("button", { name: "Deactivate student" }));
    await user.click(
      within(await screen.findByRole("alertdialog", { name: "Discard your unsaved student changes?" })).getByRole(
        "button",
        { name: "Discard changes" },
      ),
    );
    const dialog = await screen.findByRole("dialog", { name: "Deactivate Diego Soto?" });
    await user.click(within(dialog).getByRole("button", { name: "Deactivate student" }));
    await waitFor(() => expect(saved().students.find((s) => s.id === "s2").status).toBe("Inactive"));
    const archive = screen.getByRole("button", { name: "Inactive students · 2" });
    expect(archive).toHaveAttribute("aria-expanded", "false");
    await user.click(archive);
    const reactivate = within(document.getElementById("community-archived-students")).getAllByRole("button", {
      name: "Reactivate",
    });
    persistence.save.mockClear();
    await user.click(reactivate[0]);
    await waitFor(() => expect(persistence.save).toHaveBeenCalled());
  });

  it("creates students with the next free ID, one after another, and prices only individual classes", async () => {
    const user = userEvent.setup();
    const { saved } = setup();
    await user.click(screen.getByRole("button", { name: "Add student" }));
    const drawer = await screen.findByRole("dialog", { name: "Add student" });
    expect(within(drawer).getByText("ID HIBI-001")).toBeInTheDocument();
    expect(within(drawer).queryByRole("radio", { name: "Inactive" })).not.toBeInTheDocument();
    fireEvent.change(within(drawer).getByLabelText(/Full name/), { target: { value: "Nora León" } });
    await user.click(within(drawer).getByRole("switch", { name: "Individual classes" }));
    fireEvent.change(within(drawer).getByLabelText("Price of their individual classes"), { target: { value: "120" } });
    await user.click(within(drawer).getByRole("button", { name: "Save and add another" }));
    await waitFor(() =>
      expect(saved().students.find((s) => s.code === "HIBI-001")).toMatchObject({
        fullName: "Nora León",
        isIndividual: true,
        individualHourlyRate: 120,
      }),
    );
    // The form stays open, blank, with the next ID.
    const next = screen.getByRole("dialog", { name: "Add student" });
    await waitFor(() => expect(within(next).getByText("ID HIBI-002")).toBeInTheDocument());
    expect(within(next).getByLabelText(/Full name/)).toHaveValue("");
    await user.click(within(next).getByRole("button", { name: "Change student ID" }));
    fireEvent.change(within(next).getByLabelText(/Student ID/), { target: { value: "NEW-2" } });
    fireEvent.change(within(next).getByLabelText(/Full name/), { target: { value: "Pablo Ríos" } });
    await user.click(within(next).getByRole("button", { name: "Save student" }));
    await waitFor(() => expect(saved().students.find((s) => s.code === "NEW-2").fullName).toBe("Pablo Ríos"));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Add student" })).not.toBeInTheDocument());
  });
});

describe("Community debts", () => {
  function owing() {
    const state = communityState();
    state.groups.push(
      createGroup({
        id: "g-fee",
        name: "Prepa",
        billing: { mode: "monthly", monthlyFee: 800, due: { type: "dayOfMonth", day: 5 }, effectiveFrom: "2026-09" },
      }),
      createGroup({
        id: "g-fee2",
        name: "Sec",
        billing: { mode: "monthly", monthlyFee: 500, due: { type: "dayOfMonth", day: 5 }, effectiveFrom: "2026-10" },
      }),
    );
    state.students.push(
      createStudent({ id: "s9", code: "RO-9", fullName: "Rosa Peña", groupIds: ["g-fee", "g-fee2"], avatarId: "owl" }),
    );
    return state;
  }
  const rosa = (saved) => saved().students.find((student) => student.id === "s9");

  it("keeps a debt given up when the student is edited afterwards", async () => {
    const user = userEvent.setup();
    const { saved } = setup(owing());
    await user.click(screen.getAllByRole("button", { name: "Open Rosa Peña" })[0]);
    await user.click(screen.getByRole("button", { name: /^Mark as lost: September/ }));
    await waitFor(() => expect(rosa(saved).lostPayments).toHaveLength(1));
    await user.click(screen.getByRole("button", { name: "Edit student" }));
    const editor = await screen.findByRole("dialog", { name: "Edit student" });
    fireEvent.change(within(editor).getByLabelText("Notes"), { target: { value: "Paga en efectivo" } });
    await user.click(within(editor).getByRole("button", { name: "Save student" }));
    await waitFor(() => expect(rosa(saved).notes).toBe("Paga en efectivo"));
    expect(rosa(saved).lostPayments).toHaveLength(1);
  });

  it("records one payment for a double tap while the cloud answers", async () => {
    const { saved, persistence } = setup(owing());
    fireEvent.click(screen.getAllByRole("button", { name: "Open Rosa Peña" })[0]);
    let finish;
    persistence.save.mockImplementationOnce(
      (next) =>
        new Promise((resolve) => {
          finish = () => resolve(next);
        }),
    );
    const debts = document.querySelector(".debts");
    const [pay] = within(debts).getAllByRole("button", { name: /^Mark paid/ });
    fireEvent.click(pay);
    fireEvent.click(pay);
    await waitFor(() => expect(finish).toBeTypeOf("function"));
    finish();
    await waitFor(() => expect(rosa(saved).monthlyPayments).toHaveLength(1));
    expect(persistence.save).toHaveBeenCalledTimes(1);
  });

  it("names the group of each debt when the student owes in several", async () => {
    const user = userEvent.setup();
    setup(owing());
    await user.click(screen.getAllByRole("button", { name: "Open Rosa Peña" })[0]);
    expect(screen.getByRole("button", { name: "Mark as lost: October · Prepa" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark as lost: October · Sec" })).toBeInTheDocument();
  });
});

describe("Community groups", () => {
  it("changes the group's icon and color from its header, and goes back to its initials", async () => {
    const user = userEvent.setup();
    const { saved } = setup();
    const group = () => saved().groups.find((item) => item.id === "g1");
    await user.click(screen.getByRole("tab", { name: "Groups" }));
    await user.click(screen.getByRole("button", { name: "Open Primaria 5A" }));
    await user.click(screen.getByRole("button", { name: "Change the icon of Primaria 5A" }));
    const picker = await screen.findByRole("dialog", { name: "Group icon" });
    expect(within(picker).getByRole("radio", { name: "Initials" })).toBeChecked();
    await user.click(within(picker).getByRole("radio", { name: "Book" }));
    await waitFor(() => expect(group().iconId).toBe("book"));
    await user.click(within(picker).getByRole("radio", { name: "Indigo" }));
    await waitFor(() => expect(group()).toMatchObject({ iconId: "book", colorId: "indigo" }));
    expect(within(picker).getByRole("radio", { name: "Book" })).toBeChecked();
    await user.click(within(picker).getByRole("radio", { name: "Initials" }));
    await waitFor(() => expect(group()).not.toHaveProperty("iconId"));
    expect(group().colorId).toBe("indigo");
    // A badge change is visible at once: no «Group updated» notice.
    expect(screen.queryByText("Group updated")).not.toBeInTheDocument();
  });

  it("lists the members with one contact each, and switches the group to monthly from this month", async () => {
    const user = userEvent.setup();
    const { saved } = setup();
    await user.click(screen.getByRole("tab", { name: "Groups" }));
    await user.click(screen.getByRole("button", { name: "Open Primaria 5A" }));
    // The group configures; attendance by class and who owes are tracked in Seguimiento.
    expect(screen.queryByRole("table", { name: "Attendance by class" })).not.toBeInTheDocument();
    const directory = screen.getByRole("table", { name: "Group directory" });
    expect(within(directory).getByRole("row", { name: "Open Luna López" })).toHaveTextContent("luna@example.com");
    expect(within(directory).getByRole("row", { name: "Open Diego Soto" })).toHaveTextContent("Tutor · 55 0100 0104");
    expect(within(directory).queryByText(/Owes/)).not.toBeInTheDocument();
    expect(screen.getByText("Per class · $75 per hour")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Edit billing" }));
    await user.click(screen.getByRole("button", { name: "Monthly" }));
    fireEvent.change(screen.getByLabelText("Monthly fee per student"), { target: { value: "1200" } });
    await user.click(screen.getByRole("combobox", { name: "Applies from" }));
    await user.click(screen.getByRole("option", { name: /\(this month\)/ }));
    expect(screen.getByText(/Diego \$1,200 − \$450 =/)).toBeInTheDocument();
    await user.click(screen.getByRole("combobox", { name: "Different price for a student" }));
    await user.click(screen.getByRole("option", { name: "Luna López" }));
    await user.click(screen.getByRole("combobox", { name: "How Luna López pays" }));
    await user.click(screen.getByRole("option", { name: "Per class" }));
    await user.click(screen.getByRole("button", { name: "Save billing" }));
    await waitFor(() =>
      expect(saved().groups.find((g) => g.id === "g1").billing).toMatchObject({
        mode: "monthly",
        monthlyFee: 1200,
        effectiveFrom: "2026-10",
      }),
    );
    expect(saved().groups.find((g) => g.id === "g1").billing.history).toBeUndefined();
    expect(saved().students.find((s) => s.id === "s1").billingByGroup).toEqual({
      g1: { mode: "perClass", effectiveFrom: "2026-10" },
    });
  });

  it("lets one student of a monthly group fall due on another day", async () => {
    const user = userEvent.setup();
    const state = communityState();
    state.groups[0].billing = {
      mode: "monthly",
      monthlyFee: 900,
      due: { type: "dayOfMonth", day: 5 },
      effectiveFrom: "2026-10",
    };
    const { saved } = setup(state);
    await user.click(screen.getByRole("tab", { name: "Groups" }));
    await user.click(screen.getByRole("button", { name: "Open Primaria 5A" }));
    await user.click(screen.getByRole("button", { name: "Edit billing" }));
    await user.click(screen.getByRole("combobox", { name: "Different price for a student" }));
    await user.click(screen.getByRole("option", { name: "Diego Soto" }));
    await user.click(screen.getByRole("combobox", { name: "How Diego Soto pays" }));
    await user.click(screen.getByRole("option", { name: "Group fee" }));
    expect(screen.queryByLabelText("Fee for Diego Soto")).not.toBeInTheDocument();
    await user.click(screen.getByRole("combobox", { name: "When Diego Soto pays" }));
    await user.click(screen.getByRole("option", { name: "due on day" }));
    await user.click(screen.getByRole("combobox", { name: "Day Diego Soto pays" }));
    await user.click(screen.getByRole("option", { name: "20" }));
    expect(screen.getByText(/^The rest pay \$/)).toBeInTheDocument();
    // The change starts this month: September keeps the group's due day.
    expect(
      screen.getByText("Student changes apply from October; earlier months stay as they were."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save billing" }));
    await waitFor(() =>
      expect(saved().students.find((s) => s.id === "s2").billingByGroup).toEqual({
        g1: { mode: "group", due: { type: "dayOfMonth", day: 20 }, effectiveFrom: "2026-10" },
      }),
    );
    expect(saved().groups.find((g) => g.id === "g1").billing.due).toEqual({ type: "dayOfMonth", day: 5 });
  });

  it("says a switch to per class starts next month, after the month already billed monthly", async () => {
    const user = userEvent.setup();
    const state = communityState();
    state.groups[0].billing = {
      mode: "monthly",
      monthlyFee: 900,
      due: { type: "dayOfMonth", day: 5 },
      effectiveFrom: "2026-10",
    };
    const { saved } = setup(state);
    await user.click(screen.getByRole("tab", { name: "Groups" }));
    await user.click(screen.getByRole("button", { name: "Open Primaria 5A" }));
    await user.click(screen.getByRole("button", { name: "Edit billing" }));
    await user.click(screen.getByRole("combobox", { name: "Different price for a student" }));
    await user.click(screen.getByRole("option", { name: "Diego Soto" }));
    await user.click(screen.getByRole("combobox", { name: "How Diego Soto pays" }));
    await user.click(screen.getByRole("option", { name: "Per class" }));
    // October was lived with the fee: only the per-class switch waits, so the general line is gone.
    expect(screen.getByText("$150 per class attended from November")).toBeInTheDocument();
    expect(screen.queryByText(/Student changes apply from/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("combobox", { name: "Different price for a student" }));
    await user.click(screen.getByRole("option", { name: "Luna López" }));
    expect(
      screen.getByText("Student changes apply from October; earlier months stay as they were."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save billing" }));
    await waitFor(() =>
      expect(saved().students.find((s) => s.id === "s2").billingByGroup).toEqual({
        g1: { mode: "perClass", effectiveFrom: "2026-11" },
      }),
    );
    expect(saved().students.find((s) => s.id === "s1").billingByGroup).toEqual({
      g1: { mode: "customFee", fee: 900, effectiveFrom: "2026-10" },
    });
    // Saved: nothing is pending, so the row no longer names a month.
    await waitFor(() => expect(screen.queryByRole("button", { name: "Save billing" })).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Edit billing" }));
    expect(await screen.findByText("$150 per class attended")).toBeInTheDocument();
  });

  it("lets a student added this month with nothing recorded pay per class from this month", async () => {
    const user = userEvent.setup();
    const { saved } = setup(newcomerState());
    await user.click(screen.getByRole("tab", { name: "Groups" }));
    await user.click(screen.getByRole("button", { name: "Open Primaria 5A" }));
    await user.click(screen.getByRole("button", { name: "Edit billing" }));
    await user.click(screen.getByRole("combobox", { name: "Different price for a student" }));
    await user.click(screen.getByRole("option", { name: "Bea Ruiz" }));
    await user.click(screen.getByRole("combobox", { name: "How Bea Ruiz pays" }));
    await user.click(screen.getByRole("option", { name: "Per class" }));
    // Joining stamped October with a full first month, but nothing shows she lived it paying monthly.
    expect(screen.getByText("$150 per class attended")).toBeInTheDocument();
    expect(screen.queryByText(/per class attended from/)).not.toBeInTheDocument();
    expect(
      screen.getByText("Student changes apply from October; earlier months stay as they were."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save billing" }));
    await waitFor(() =>
      expect(saved().students.find((s) => s.id === "s5").billingByGroup).toEqual({
        g1: { mode: "perClass", effectiveFrom: "2026-10", joinedOn: "2026-10-20", firstMonthAmount: 900 },
      }),
    );
  });

  it("says what a backdated monthly start costs and saves who joined after it began", async () => {
    const user = userEvent.setup();
    const { saved } = setup(backdatableState());
    await user.click(screen.getByRole("tab", { name: "Groups" }));
    await user.click(screen.getByRole("button", { name: "Open Primaria 5A" }));
    await user.click(screen.getByRole("button", { name: "Edit billing" }));
    await user.click(screen.getByRole("button", { name: "Monthly" }));
    fireEvent.change(screen.getByLabelText("Monthly fee per student"), { target: { value: "1200" } });
    await user.click(screen.getByRole("combobox", { name: "Applies from" }));
    // The group's first class is September 7: no earlier month is offered.
    expect(screen.queryByRole("option", { name: "August" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: "September" }));
    // Luna: September and October; Diego joined October 5: October less the $450 he paid per class.
    expect(
      screen.getByText(
        "3 fees are created already overdue ($3,150) and unpaid classes in those months ($300) stop being charged.",
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save billing" }));
    await waitFor(() =>
      expect(saved().groups.find((g) => g.id === "g1").billing).toMatchObject({
        mode: "monthly",
        effectiveFrom: "2026-09",
      }),
    );
    expect(saved().students.find((s) => s.id === "s1").billingByGroup).toEqual({
      g1: { mode: "group", joinedOn: "2026-09-07" },
    });
    expect(saved().students.find((s) => s.id === "s2").billingByGroup).toEqual({
      g1: { mode: "group", joinedOn: "2026-10-05" },
    });
    // Rubén is archived with nothing on record: reactivating him decides.
    expect(saved().students.find((s) => s.id === "s4").billingByGroup).toBeUndefined();
  });

  it("says a switch to per class waits for a month already paid in advance", async () => {
    const user = userEvent.setup();
    const state = newcomerState();
    const diego = state.students.find((s) => s.id === "s2");
    diego.monthlyPayments = [{ id: "nov", groupId: "g1", period: "2026-11", amount: 900, paidAt: "2026-10-20" }];
    const { saved } = setup(state);
    await user.click(screen.getByRole("tab", { name: "Groups" }));
    await user.click(screen.getByRole("button", { name: "Open Primaria 5A" }));
    await user.click(screen.getByRole("button", { name: "Edit billing" }));
    await user.click(screen.getByRole("combobox", { name: "Different price for a student" }));
    await user.click(screen.getByRole("option", { name: "Diego Soto" }));
    await user.click(screen.getByRole("combobox", { name: "How Diego Soto pays" }));
    await user.click(screen.getByRole("option", { name: "Per class" }));
    // November is paid already: per class starts after it.
    expect(screen.getByText("$150 per class attended from December")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save billing" }));
    await waitFor(() =>
      expect(saved().students.find((s) => s.id === "s2").billingByGroup).toEqual({
        g1: { mode: "perClass", effectiveFrom: "2026-12" },
      }),
    );
  });

  it("says how many fees already owed a backdated save stops charging", async () => {
    // Monthly since October with Bea added on October 20 (owing October since the 20th); Luna came on
    // September 7. One save moves «Aplica desde» to September and sets Bea per class from October.
    const state = newcomerState();
    state.classLog = [row("r0", "2026-09-07", "s1", "P", 0), ...state.classLog];
    const user = userEvent.setup();
    setup(state);
    await user.click(screen.getByRole("tab", { name: "Groups" }));
    await user.click(screen.getByRole("button", { name: "Open Primaria 5A" }));
    await user.click(screen.getByRole("button", { name: "Edit billing" }));
    await user.click(screen.getByRole("combobox", { name: "Different price for a student" }));
    await user.click(screen.getByRole("option", { name: "Bea Ruiz" }));
    await user.click(screen.getByRole("combobox", { name: "How Bea Ruiz pays" }));
    await user.click(screen.getByRole("option", { name: "Per class" }));
    await user.click(screen.getByRole("combobox", { name: "Applies from" }));
    await user.click(screen.getByRole("option", { name: "September" }));
    expect(
      screen.getByText(
        "1 fee is created already overdue ($900) and unpaid classes in those months ($150) stop being charged. 1 fee already owed stops being charged ($900).",
      ),
    ).toBeInTheDocument();
  });

  it("asks before archiving, then shows the archived history and reactivates", async () => {
    const user = userEvent.setup();
    const { saved } = setup();
    await user.click(screen.getByRole("tab", { name: "Groups" }));
    await user.click(screen.getByRole("button", { name: "Open Primaria 5A" }));
    await user.click(screen.getByRole("button", { name: "Edit group" }));
    await user.click(
      within(await screen.findByRole("dialog", { name: "Primaria 5A" })).getByRole("button", {
        name: /^Archive group/,
      }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Archive group Primaria 5A?" });
    expect(dialog).toHaveTextContent("3 recorded classes");
    expect(dialog).toHaveTextContent("$150 to collect");
    await user.click(within(dialog).getByRole("button", { name: "Archive group" }));
    await waitFor(() => expect(saved().groups.find((g) => g.id === "g1").status).toBe("Inactive"));
    await user.click(await screen.findByRole("button", { name: /Primaria 5A Archived on/ }));
    const detail = screen.getByRole("region", { name: "Archived group details" });
    expect(detail).toHaveTextContent("Luna López");
    await user.click(within(detail).getByRole("button", { name: "View history" }));
    expect(within(detail).getByText("Classes and payments")).toBeInTheDocument();
    await user.click(within(detail).getByRole("button", { name: "Reactivate group" }));
    await waitFor(() => expect(saved().groups.find((g) => g.id === "g1").status).toBe("Active"));
  });

  it("adds and removes members at once from «Change members»", async () => {
    // The app works on the real date, so the join date only matches AS_OF with a pinned clock.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${AS_OF}T12:00:00`));
    const user = userEvent.setup();
    const state = communityState();
    state.groups[0].billing = {
      mode: "monthly",
      monthlyFee: 900,
      due: { type: "dayOfMonth", day: 5 },
      effectiveFrom: "2026-10",
    };
    const { saved } = setup(state);
    await user.click(screen.getByRole("tab", { name: "Groups" }));
    await user.click(screen.getByRole("button", { name: "Open Primaria 5A" }));
    await user.click(screen.getByRole("button", { name: "Change members" }));
    const sheet = await screen.findByRole("dialog", { name: "Primaria 5A" });
    // Members first, then everyone else; inactive students are not offered.
    expect(
      within(sheet)
        .getAllByRole("checkbox")
        .map((box) => box.checked),
    ).toEqual([true, true, false]);
    expect(within(sheet).queryByText("Rubén Paz")).not.toBeInTheDocument();
    await user.click(within(sheet).getByRole("checkbox", { name: /Camila Torres/ }));
    await user.click(within(sheet).getByRole("checkbox", { name: /Diego Soto/ }));
    await user.click(within(sheet).getByRole("button", { name: "Save members · 2" }));
    await waitFor(() =>
      expect(saved().students.find((s) => s.id === "s3")).toMatchObject({
        groupIds: ["g1"],
        billingByGroup: { g1: { mode: "group", joinedOn: AS_OF } },
      }),
    );
    expect(saved().students.find((s) => s.id === "s2")).toMatchObject({
      groupIds: [],
      billingByGroup: { g1: { mode: "group", leftOn: AS_OF } },
    });
    expect(saved().students.find((s) => s.id === "s1").groupIds).toEqual(["g1"]);
  });

  it("says what a deleted group keeps and cancels, then deletes it for good", async () => {
    const user = userEvent.setup();
    const { saved } = setup();
    await user.click(screen.getByRole("tab", { name: "Groups" }));
    await user.click(screen.getByRole("button", { name: "Open Primaria 5A" }));
    await user.click(screen.getByRole("button", { name: "Edit group" }));
    await user.click(
      within(await screen.findByRole("dialog", { name: "Primaria 5A" })).getByRole("button", {
        name: /^Delete group/,
      }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Delete Primaria 5A?" });
    expect(dialog).toHaveTextContent("Luna and Diego stay in Hibi, without this group.");
    expect(dialog).toHaveTextContent("The $450 you already collected is kept in your history.");
    expect(dialog).toHaveTextContent("Its 3 recorded classes stay in each student's history.");
    // Luna's class of October 19 was never paid.
    expect(dialog).toHaveTextContent("The $150 this group has to collect is cancelled");
    await user.click(within(dialog).getByRole("button", { name: "Delete for good" }));
    await waitFor(() => expect(saved().groups.find((g) => g.id === "g1").deletedAt).toBe(AS_OF));
    expect(saved().students.find((s) => s.id === "s1")).toMatchObject({
      groupIds: [],
      lostPayments: [expect.objectContaining({ kind: "class", classId: "r5" })],
    });
    // Its history still counts, but it is not listed with the archived groups.
    expect(screen.queryByRole("button", { name: "Open Primaria 5A" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archived groups · 1" })).toBeInTheDocument();
  });

  it("offers archiving instead of deleting", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("tab", { name: "Groups" }));
    await user.click(screen.getByRole("button", { name: "Open Primaria 5A" }));
    await user.click(screen.getByRole("button", { name: "Edit group" }));
    await user.click(
      within(await screen.findByRole("dialog", { name: "Primaria 5A" })).getByRole("button", {
        name: /^Delete group/,
      }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Delete Primaria 5A?" });
    await user.click(within(dialog).getByRole("button", { name: "Archive instead" }));
    expect(await screen.findByRole("dialog", { name: "Archive group Primaria 5A?" })).toBeInTheDocument();
  });

  it("asks what the first month of the new group costs when a paid student changes group", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${AS_OF}T12:00:00`));
    const user = userEvent.setup();
    const state = communityState();
    const monthly = (monthlyFee) => ({
      mode: "monthly",
      monthlyFee,
      due: { type: "dayOfMonth", day: 5 },
      effectiveFrom: "2026-10",
    });
    state.groups[0].billing = monthly(900);
    state.groups.push(
      createGroup({
        id: "g2",
        name: "Secundaria",
        weeklySchedule: state.groups[0].weeklySchedule,
        billing: monthly(1000),
      }),
    );
    // Diego paid October in Primaria 5A and moves to Secundaria (1,000 a month) on the 21st.
    state.students[1].monthlyPayments = [
      { id: "p1", groupId: "g1", period: "2026-10", amount: 900, paidAt: "2026-10-05" },
    ];
    const { saved } = setup(state);
    await user.click(screen.getByRole("button", { name: "Open Diego Soto" }));
    await user.click(screen.getByRole("button", { name: "Edit student" }));
    const editor = await screen.findByRole("dialog", { name: "Edit student" });
    await user.click(within(editor).getByRole("button", { name: "Remove Primaria 5A" }));
    await user.click(within(editor).getByRole("combobox", { name: "Assign groups" }));
    await user.click(await screen.findByRole("option", { name: /Secundaria/ }));
    await user.click(within(editor).getByRole("button", { name: "Save student" }));

    const sheet = await screen.findByRole("dialog", { name: "To Secundaria" });
    const credit = within(sheet).getByRole("radio", { name: /Count what was paid/ });
    expect(credit).toHaveAttribute("aria-checked", "true");
    expect(credit).toHaveTextContent("Count what was paid · $100");
    expect(credit).toHaveTextContent("The $900 paid in Primaria 5A counts toward October.");
    expect(within(sheet).getByRole("radio", { name: /Full month/ })).toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: "Save student" }));
    await waitFor(() =>
      expect(saved().students.find((s) => s.id === "s2")).toMatchObject({
        groupIds: ["g2"],
        billingByGroup: {
          g1: { leftOn: AS_OF },
          g2: { mode: "group", joinedOn: AS_OF, firstMonthAmount: 100 },
        },
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit student" })).not.toBeInTheDocument());
  });

  it("keeps the editor open when the group-change question is closed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${AS_OF}T12:00:00`));
    const user = userEvent.setup();
    const state = communityState();
    const billing = { mode: "monthly", monthlyFee: 900, due: { type: "dayOfMonth", day: 5 }, effectiveFrom: "2026-10" };
    state.groups[0].billing = billing;
    state.groups.push(
      createGroup({ id: "g2", name: "Secundaria", weeklySchedule: state.groups[0].weeklySchedule, billing }),
    );
    state.students[1].monthlyPayments = [
      { id: "p1", groupId: "g1", period: "2026-10", amount: 900, paidAt: "2026-10-05" },
    ];
    const { persistence } = setup(state);
    await user.click(screen.getByRole("button", { name: "Open Diego Soto" }));
    await user.click(screen.getByRole("button", { name: "Edit student" }));
    const editor = await screen.findByRole("dialog", { name: "Edit student" });
    await user.click(within(editor).getByRole("button", { name: "Remove Primaria 5A" }));
    await user.click(within(editor).getByRole("combobox", { name: "Assign groups" }));
    await user.click(await screen.findByRole("option", { name: /Secundaria/ }));
    persistence.save.mockClear();
    await user.click(within(editor).getByRole("button", { name: "Save student" }));
    const sheet = await screen.findByRole("dialog", { name: "To Secundaria" });
    // Same fee: the difference is nothing, so «$0 now» is not offered twice.
    expect(within(sheet).getByRole("radio", { name: /Count what was paid/ })).toHaveTextContent("$0");
    expect(within(sheet).queryByRole("radio", { name: /\$0 now/ })).not.toBeInTheDocument();
    await user.click(within(sheet).getByRole("radio", { name: /Full month/ }));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "To Secundaria" })).not.toBeInTheDocument());
    expect(screen.getByRole("dialog", { name: "Edit student" })).toBeInTheDocument();
    expect(persistence.save).not.toHaveBeenCalled();
    // Asked again, it starts from the credit once more.
    await user.click(within(editor).getByRole("button", { name: "Save student" }));
    const again = await screen.findByRole("dialog", { name: "To Secundaria" });
    expect(within(again).getByRole("radio", { name: /Count what was paid/ })).toHaveAttribute("aria-checked", "true");
  });

  it("creates a monthly group from the drawer", async () => {
    const user = userEvent.setup();
    const { saved } = setup();
    await user.click(screen.getByRole("button", { name: "Create group" }));
    const drawer = await screen.findByRole("dialog", { name: "Create group" });
    fireEvent.change(within(drawer).getByLabelText(/Group name/), { target: { value: "Prepa" } });
    await user.click(within(drawer).getByRole("button", { name: "Monthly" }));
    fireEvent.change(within(drawer).getByLabelText("Monthly fee per student"), { target: { value: "1000" } });
    await user.click(within(drawer).getByRole("button", { name: "Create group" }));
    await waitFor(() =>
      expect(saved().groups.find((g) => g.name === "Prepa").billing).toMatchObject({
        mode: "monthly",
        monthlyFee: 1000,
      }),
    );
  });
});

describe("Community on a phone", () => {
  it("opens students and groups in sheets and edits billing in a second sheet", async () => {
    setCompact(true);
    localStorage.setItem(LANGUAGE_STORAGE_KEY, "es");
    const user = userEvent.setup();
    const { saved } = setup();
    expect(screen.getByRole("heading", { name: "Con pendientes" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Abrir Luna López" }));
    const sheet = await screen.findByRole("dialog", { name: "Luna López" });
    expect(within(sheet).getByText("Clases de octubre")).toBeInTheDocument();
    expect(within(sheet).getByRole("link", { name: "Escribir correo" })).toHaveAttribute(
      "href",
      "mailto:luna@example.com",
    );
    await user.click(within(sheet).getByRole("button", { name: "Cerrar" }));
    await user.click(screen.getByRole("button", { name: "Grupos" }));
    await user.click(screen.getByRole("button", { name: "Abrir Primaria 5A" }));
    const group = await screen.findByRole("dialog", { name: "Primaria 5A" });
    await user.click(within(group).getByRole("button", { name: "Editar cobro" }));
    await waitFor(() => expect(screen.getAllByRole("dialog")).toHaveLength(2));
    const billing = screen.getAllByRole("dialog").at(-1);
    fireEvent.change(within(billing).getByLabelText("Tarifa por hora"), { target: { value: "80" } });
    await user.click(within(billing).getByRole("button", { name: "Guardar cobro" }));
    await waitFor(() => expect(saved().groups.find((g) => g.id === "g1").hourlyRate).toBe(80));
  });

  async function openBillingSheet(user) {
    setCompact(true);
    localStorage.setItem(LANGUAGE_STORAGE_KEY, "es");
    const result = setup();
    await user.click(screen.getByRole("button", { name: "Grupos" }));
    await user.click(screen.getByRole("button", { name: "Abrir Primaria 5A" }));
    const group = await screen.findByRole("dialog", { name: "Primaria 5A" });
    await user.click(within(group).getByRole("button", { name: "Editar cobro" }));
    await waitFor(() => expect(screen.getAllByRole("dialog")).toHaveLength(2));
    return { ...result, billing: () => screen.getAllByRole("dialog").at(-1) };
  }

  it("edits the name from «Editar» in the group sheet, where archive and delete also live", async () => {
    setCompact(true);
    localStorage.setItem(LANGUAGE_STORAGE_KEY, "es");
    const user = userEvent.setup();
    const { saved } = setup();
    await user.click(screen.getByRole("button", { name: "Grupos" }));
    await user.click(screen.getByRole("button", { name: "Abrir Primaria 5A" }));
    const group = await screen.findByRole("dialog", { name: "Primaria 5A" });
    expect(within(group).getByRole("button", { name: "Abrir Diego Soto" })).toHaveTextContent("Tutor · 55 0100 0104");
    expect(within(group).getByRole("button", { name: /Ver asistencia y pagos en Seguimiento/ })).toBeInTheDocument();
    await user.click(within(group).getByRole("button", { name: "Editar" }));
    await waitFor(() => expect(screen.getAllByRole("dialog")).toHaveLength(2));
    const editor = screen.getAllByRole("dialog").at(-1);
    expect(within(editor).getByRole("button", { name: /^Archivar grupo/ })).toBeInTheDocument();
    expect(within(editor).getByRole("button", { name: /^Eliminar grupo/ })).toBeInTheDocument();
    fireEvent.change(within(editor).getByLabelText(/Nombre del grupo/), { target: { value: "Primaria 5B" } });
    await user.click(within(editor).getByRole("button", { name: "Guardar grupo" }));
    await waitFor(() => expect(saved().groups.find((g) => g.id === "g1").name).toBe("Primaria 5B"));
  });

  it("asks before «Atrás» drops an unsaved billing change", async () => {
    const user = userEvent.setup();
    const { billing } = await openBillingSheet(user);
    await user.click(within(billing()).getByRole("button", { name: "Mensual" }));
    await user.click(within(billing()).getByRole("button", { name: "Atrás" }));
    const question = await screen.findByRole("alertdialog", { name: "¿Descartar los cambios sin guardar del grupo?" });
    await user.click(within(question).getByRole("button", { name: "Descartar cambios" }));
    await waitFor(() => expect(screen.getAllByRole("dialog")).toHaveLength(1));
    const group = screen.getByRole("dialog", { name: "Primaria 5A" });
    await user.click(within(group).getByRole("button", { name: "Editar cobro" }));
    await waitFor(() => expect(screen.getAllByRole("dialog")).toHaveLength(2));
    expect(within(billing()).getByRole("button", { name: "Por clase" })).toHaveAttribute("aria-pressed", "true");
  });

  it("says in the billing sheet when a student's switch to per class starts", async () => {
    setCompact(true);
    localStorage.setItem(LANGUAGE_STORAGE_KEY, "es");
    const user = userEvent.setup();
    const state = communityState();
    state.groups[0].billing = {
      mode: "monthly",
      monthlyFee: 900,
      due: { type: "dayOfMonth", day: 5 },
      effectiveFrom: "2026-10",
    };
    const { saved } = setup(state);
    await user.click(screen.getByRole("button", { name: "Grupos" }));
    await user.click(screen.getByRole("button", { name: "Abrir Primaria 5A" }));
    const group = await screen.findByRole("dialog", { name: "Primaria 5A" });
    await user.click(within(group).getByRole("button", { name: "Editar cobro" }));
    await waitFor(() => expect(screen.getAllByRole("dialog")).toHaveLength(2));
    const billing = () => screen.getAllByRole("dialog").at(-1);
    await user.click(within(billing()).getByRole("combobox", { name: "Precio distinto para un alumno" }));
    await user.click(screen.getByRole("option", { name: "Diego Soto" }));
    await user.click(within(billing()).getByRole("combobox", { name: "Cómo paga Diego Soto" }));
    await user.click(screen.getByRole("option", { name: "Por clase" }));
    expect(within(billing()).getByText("$150 por clase asistida desde noviembre")).toBeInTheDocument();
    await user.click(within(billing()).getByRole("button", { name: "Guardar cobro" }));
    await waitFor(() =>
      expect(saved().students.find((s) => s.id === "s2").billingByGroup).toEqual({
        g1: { mode: "perClass", effectiveFrom: "2026-11" },
      }),
    );
  });

  it("lets a student added this month pay per class from this month in the billing sheet", async () => {
    setCompact(true);
    localStorage.setItem(LANGUAGE_STORAGE_KEY, "es");
    const user = userEvent.setup();
    const { saved } = setup(newcomerState());
    await user.click(screen.getByRole("button", { name: "Grupos" }));
    await user.click(screen.getByRole("button", { name: "Abrir Primaria 5A" }));
    const group = await screen.findByRole("dialog", { name: "Primaria 5A" });
    await user.click(within(group).getByRole("button", { name: "Editar cobro" }));
    await waitFor(() => expect(screen.getAllByRole("dialog")).toHaveLength(2));
    const billing = () => screen.getAllByRole("dialog").at(-1);
    await user.click(within(billing()).getByRole("combobox", { name: "Precio distinto para un alumno" }));
    await user.click(screen.getByRole("option", { name: "Bea Ruiz" }));
    await user.click(within(billing()).getByRole("combobox", { name: "Cómo paga Bea Ruiz" }));
    await user.click(screen.getByRole("option", { name: "Por clase" }));
    expect(within(billing()).getByText("$150 por clase asistida")).toBeInTheDocument();
    expect(within(billing()).queryByText(/por clase asistida desde/)).not.toBeInTheDocument();
    await user.click(within(billing()).getByRole("button", { name: "Guardar cobro" }));
    await waitFor(() =>
      expect(saved().students.find((s) => s.id === "s5").billingByGroup.g1).toMatchObject({
        mode: "perClass",
        effectiveFrom: "2026-10",
      }),
    );
  });

  it("says in the billing sheet what a backdated monthly start costs, only while it is backdated", async () => {
    setCompact(true);
    localStorage.setItem(LANGUAGE_STORAGE_KEY, "es");
    const user = userEvent.setup();
    const { saved } = setup(backdatableState());
    await user.click(screen.getByRole("button", { name: "Grupos" }));
    await user.click(screen.getByRole("button", { name: "Abrir Primaria 5A" }));
    const group = await screen.findByRole("dialog", { name: "Primaria 5A" });
    await user.click(within(group).getByRole("button", { name: "Editar cobro" }));
    await waitFor(() => expect(screen.getAllByRole("dialog")).toHaveLength(2));
    const billing = () => screen.getAllByRole("dialog").at(-1);
    await user.click(within(billing()).getByRole("button", { name: "Mensual" }));
    fireEvent.change(within(billing()).getByLabelText("Cuota mensual por alumno"), { target: { value: "1200" } });
    const sentence = /cuotas ya vencidas/;
    expect(within(billing()).queryByText(sentence)).not.toBeInTheDocument();
    await user.click(within(billing()).getByRole("combobox", { name: "Aplica desde" }));
    expect(screen.queryByRole("option", { name: "Agosto" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: "Septiembre" }));
    expect(
      within(billing()).getByText(
        "Se crean 3 cuotas ya vencidas ($3,150) y las clases sin pagar de esos meses ($300) dejan de cobrarse.",
      ),
    ).toBeInTheDocument();
    // This month instead: the usual list of what each one owes, and no backdated sentence.
    await user.click(within(billing()).getByRole("combobox", { name: "Aplica desde" }));
    await user.click(screen.getByRole("option", { name: /\(este mes\)/ }));
    expect(within(billing()).queryByText(sentence)).not.toBeInTheDocument();
    await user.click(within(billing()).getByRole("combobox", { name: "Aplica desde" }));
    await user.click(screen.getByRole("option", { name: "Septiembre" }));
    await user.click(within(billing()).getByRole("button", { name: "Guardar cobro" }));
    await waitFor(() =>
      expect(saved().students.find((s) => s.id === "s2").billingByGroup).toEqual({
        g1: { mode: "group", joinedOn: "2026-10-05" },
      }),
    );
    expect(saved().groups.find((g) => g.id === "g1").billing.effectiveFrom).toBe("2026-09");
  });
});

describe("Community unsaved changes", () => {
  it("asks in-app before closing a dirty drawer and keeps it open on «Keep editing»", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(globalThis, "confirm");
    setup();
    await user.click(screen.getByRole("button", { name: "Add student" }));
    const drawer = await screen.findByRole("dialog", { name: "Add student" });
    await user.click(within(drawer).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Add student" })).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Add student" }));
    const again = await screen.findByRole("dialog", { name: "Add student" });
    fireEvent.change(within(again).getByLabelText(/Full name/), { target: { value: "Nora León" } });
    await user.click(within(again).getByRole("button", { name: "Cancel" }));
    const question = await screen.findByRole("alertdialog", { name: "Discard your unsaved student changes?" });
    await user.click(within(question).getByRole("button", { name: "Keep editing" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(screen.getByRole("dialog", { name: "Add student" })).toBeInTheDocument();

    await user.click(
      within(screen.getByRole("dialog", { name: "Add student" })).getByRole("button", { name: "Cancel" }),
    );
    const second = await screen.findByRole("alertdialog", { name: "Discard your unsaved student changes?" });
    await user.click(within(second).getByRole("button", { name: "Discard changes" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Add student" })).not.toBeInTheDocument());
    expect(confirm).not.toHaveBeenCalled();
  });

  it("asks in-app before closing an edited billing drawer", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: "View group Primaria 5A" }));
    await user.click(screen.getByRole("button", { name: "Edit billing" }));
    await user.click(screen.getByRole("button", { name: "Monthly" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    const question = await screen.findByRole("alertdialog", { name: "Discard your unsaved group changes?" });
    await user.click(within(question).getByRole("button", { name: "Keep editing" }));
    expect(screen.getByRole("button", { name: "Monthly" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(
      within(await screen.findByRole("alertdialog", { name: "Discard your unsaved group changes?" })).getByRole(
        "button",
        { name: "Discard changes" },
      ),
    );
    await waitFor(() => expect(screen.queryByRole("button", { name: "Save billing" })).not.toBeInTheDocument());
  });
});

describe("Community audit fixes", () => {
  it("names each «Ver grupo» button after its group", () => {
    setup();
    const button = screen.getByRole("button", { name: "View group Primaria 5A" });
    expect(button).toHaveTextContent("View group");
    expect(
      screen.getAllByRole("button", { name: /^View group / }).map((item) => item.getAttribute("aria-label")),
    ).toEqual(["View group Primaria 5A"]);
  });

  it("shows students of an archived group under it and leaves them out of the active count", async () => {
    const state = communityState();
    state.students.push(
      createStudent({ id: "s5", code: "ANA-5", fullName: "Ana Ruiz", groupIds: ["g-old"], avatarId: "fox" }),
    );
    setup(state);
    // Luna, Diego and Camila are active; Ana only belongs to an archived group.
    expect(screen.getByText(/3 active students in 1 group/)).toBeInTheDocument();
    const list = screen.getByRole("navigation", { name: "Students" });
    const archived = within(list).getByText("In archived groups").closest(".list-group");
    expect(within(archived).getByRole("button", { name: "Open Ana Ruiz" })).toHaveTextContent("Inglés (archived)");
    const loose = within(list).getByText("Individual and without a group").closest(".list-group");
    expect(within(loose).queryByRole("button", { name: "Open Ana Ruiz" })).not.toBeInTheDocument();
    expect(within(loose).getByRole("button", { name: "Open Camila Torres" })).toBeInTheDocument();
  });

  it("brings the student card into view when it is below the fold", async () => {
    const user = userEvent.setup();
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      top: 2600,
      bottom: 3400,
      left: 0,
      right: 600,
      width: 600,
      height: 800,
      x: 0,
      y: 2600,
      toJSON: () => ({}),
    });
    try {
      setup();
      await user.click(screen.getByRole("button", { name: "Open Diego Soto" }));
      expect(scrollIntoView).toHaveBeenCalledWith({ block: "start" });
      scrollIntoView.mockClear();
      rect.mockReturnValue({
        top: 16,
        bottom: 700,
        left: 0,
        right: 600,
        width: 600,
        height: 684,
        x: 0,
        y: 16,
        toJSON: () => ({}),
      });
      await user.click(screen.getByRole("button", { name: "Open Luna López" }));
      expect(scrollIntoView).not.toHaveBeenCalled();
    } finally {
      rect.mockRestore();
      delete Element.prototype.scrollIntoView;
    }
  });
});

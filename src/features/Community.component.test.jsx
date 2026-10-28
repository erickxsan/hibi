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

  it("saves contact details, deactivates and reactivates from the archive", async () => {
    const user = userEvent.setup();
    const { saved, persistence } = setup();
    await user.click(screen.getByRole("button", { name: "Open Diego Soto" }));
    fireEvent.change(screen.getByLabelText("Short notes"), { target: { value: "Likes drawings" } });
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(saved().students.find((s) => s.id === "s2").notes).toBe("Likes drawings"));
    await user.click(screen.getByRole("button", { name: "Deactivate student" }));
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

  it("creates and edits a student through the drawer", async () => {
    const user = userEvent.setup();
    const { saved } = setup();
    await user.click(screen.getByRole("button", { name: "Add student" }));
    const drawer = await screen.findByRole("dialog", { name: "Add student" });
    fireEvent.change(within(drawer).getByLabelText(/Student ID/), { target: { value: "NEW-1" } });
    fireEvent.change(within(drawer).getByLabelText(/Full name/), { target: { value: "Nora León" } });
    await user.click(within(drawer).getByRole("switch", { name: "Override inherited rate" }));
    fireEvent.change(within(drawer).getByLabelText("Custom hourly rate"), { target: { value: "120" } });
    await user.click(within(drawer).getByRole("button", { name: "Save student" }));
    await waitFor(() =>
      expect(saved().students.find((s) => s.code === "NEW-1")).toMatchObject({
        fullName: "Nora León",
        customHourlyRate: 120,
      }),
    );
    await user.click(screen.getByRole("button", { name: "Edit enrollment and rate" }));
    const editor = await screen.findByRole("dialog", { name: "Edit student" });
    await user.click(within(editor).getByRole("button", { name: "Inactive" }));
    await user.click(within(editor).getByRole("button", { name: "Save student" }));
    await waitFor(() => expect(saved().students.find((s) => s.code === "NEW-1").status).toBe("Inactive"));
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

  it("shows the attendance grid and directory, and switches the group to monthly from this month", async () => {
    const user = userEvent.setup();
    const { saved } = setup();
    await user.click(screen.getByRole("tab", { name: "Groups" }));
    await user.click(screen.getByRole("button", { name: "Open Primaria 5A" }));
    const grid = screen.getByRole("table", { name: "Attendance by class" });
    expect(within(grid).getAllByRole("cell", { name: /Luna López.*Absent/ })).toHaveLength(2);
    await user.click(within(grid).getByRole("button", { name: "Luna" }));
    expect(within(grid).getByRole("button", { name: "Luna" })).toHaveAttribute("aria-pressed", "true");
    const directory = screen.getByRole("table", { name: "Group directory" });
    expect(within(directory).getByText("luna@example.com")).toBeInTheDocument();
    expect(within(directory).getByText("Tutor · 55 0100 0104")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Monthly" }));
    fireEvent.change(screen.getByLabelText("Monthly fee per student"), { target: { value: "1200" } });
    await user.click(screen.getByRole("button", { name: "This month" }));
    expect(screen.getByText(/Diego \$1,200 − \$450 =/)).toBeInTheDocument();
    await user.click(screen.getByRole("combobox", { name: "Adjust for a student" }));
    await user.click(screen.getByRole("option", { name: "Luna López" }));
    await user.click(screen.getByRole("combobox", { name: "How Luna López pays" }));
    await user.click(screen.getByRole("option", { name: "Per class" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(saved().groups.find((g) => g.id === "g1").billing).toMatchObject({
        mode: "monthly",
        monthlyFee: 1200,
        effectiveFrom: "2026-10",
        creditFirstMonth: true,
      }),
    );
    expect(saved().students.find((s) => s.id === "s1").billingByGroup).toEqual({ g1: { mode: "perClass" } });
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
    await user.click(screen.getByRole("combobox", { name: "Adjust for a student" }));
    await user.click(screen.getByRole("option", { name: "Diego Soto" }));
    await user.click(screen.getByRole("combobox", { name: "How Diego Soto pays" }));
    await user.click(screen.getByRole("option", { name: "Group fee" }));
    expect(screen.queryByLabelText("Fee for Diego Soto")).not.toBeInTheDocument();
    await user.click(screen.getByRole("combobox", { name: "When Diego Soto pays" }));
    await user.click(screen.getByRole("option", { name: "due on day" }));
    await user.click(screen.getByRole("combobox", { name: "Day Diego Soto pays" }));
    await user.click(screen.getByRole("option", { name: "20" }));
    expect(screen.getByText(/1 with an adjustment/)).toHaveTextContent("2 pay the group fee");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(saved().students.find((s) => s.id === "s2").billingByGroup).toEqual({
        g1: { mode: "group", due: { type: "dayOfMonth", day: 20 } },
      }),
    );
    expect(saved().groups.find((g) => g.id === "g1").billing.due).toEqual({ type: "dayOfMonth", day: 5 });
  });

  it("asks before archiving, then shows the archived history and reactivates", async () => {
    const user = userEvent.setup();
    const { saved } = setup();
    await user.click(screen.getByRole("tab", { name: "Groups" }));
    await user.click(screen.getByRole("button", { name: "Open Primaria 5A" }));
    await user.click(screen.getByRole("button", { name: "Archive group" }));
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

  it("charges a student who joins a monthly group mid-month only for the classes left", async () => {
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
    await user.click(screen.getByRole("button", { name: "Add to group" }));
    const sheet = await screen.findByRole("dialog", { name: "To Primaria 5A" });
    expect(within(sheet).getByRole("combobox", { name: "Student" })).toHaveTextContent("Camila Torres");
    const proportional = within(sheet).getByRole("radio", { name: /Proportional/ });
    expect(proportional).toHaveAttribute("aria-checked", "true");
    expect(proportional).toHaveTextContent("3 of 9 classes of October remain.");
    await user.click(within(sheet).getByRole("button", { name: "Add to Primaria 5A" }));
    await waitFor(() =>
      expect(saved().students.find((s) => s.id === "s3")).toMatchObject({
        groupIds: ["g1"],
        billingByGroup: { g1: { mode: "group", joinedOn: AS_OF, firstMonthAmount: 300 } },
      }),
    );
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
    await user.click(within(group).getByRole("button", { name: /Forma de cobro/ }));
    await waitFor(() => expect(screen.getAllByRole("dialog")).toHaveLength(2));
    const billing = screen.getAllByRole("dialog").at(-1);
    fireEvent.change(within(billing).getByLabelText("Tarifa por hora"), { target: { value: "80" } });
    await user.click(within(billing).getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(saved().groups.find((g) => g.id === "g1").hourlyRate).toBe(80));
  });

  async function openBillingSheet(user) {
    setCompact(true);
    localStorage.setItem(LANGUAGE_STORAGE_KEY, "es");
    const result = setup();
    await user.click(screen.getByRole("button", { name: "Grupos" }));
    await user.click(screen.getByRole("button", { name: "Abrir Primaria 5A" }));
    const group = await screen.findByRole("dialog", { name: "Primaria 5A" });
    await user.click(within(group).getByRole("button", { name: /Forma de cobro/ }));
    await waitFor(() => expect(screen.getAllByRole("dialog")).toHaveLength(2));
    return { ...result, billing: () => screen.getAllByRole("dialog").at(-1) };
  }

  it("keeps an unsaved billing change while the schedule editor saves the group", async () => {
    const user = userEvent.setup();
    const { saved, billing } = await openBillingSheet(user);
    await user.click(within(billing()).getByRole("button", { name: "Mensual" }));
    await user.click(within(billing()).getByRole("button", { name: "Editar horario y datos" }));
    const editor = await screen.findByRole("dialog", { name: "Editar grupo" });
    fireEvent.change(within(editor).getByLabelText(/Nombre del grupo/), { target: { value: "Primaria 5B" } });
    await user.click(within(editor).getByRole("button", { name: "Guardar grupo" }));
    await waitFor(() => expect(saved().groups.find((g) => g.id === "g1").name).toBe("Primaria 5B"));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Editar grupo" })).not.toBeInTheDocument());
    expect(within(billing()).getByRole("button", { name: "Mensual" })).toHaveAttribute("aria-pressed", "true");
    expect(within(billing()).getByLabelText("Cuota mensual por alumno")).toBeInTheDocument();
    expect(within(billing()).getByLabelText("Nombre del grupo")).toHaveValue("Primaria 5B");
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
    await user.click(within(group).getByRole("button", { name: /Forma de cobro/ }));
    await waitFor(() => expect(screen.getAllByRole("dialog")).toHaveLength(2));
    expect(within(billing()).getByRole("button", { name: "Por clase" })).toHaveAttribute("aria-pressed", "true");
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

  it("asks in-app before leaving an edited student card for another one", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(globalThis, "confirm");
    setup();
    await user.click(screen.getByRole("button", { name: "Open Diego Soto" }));
    fireEvent.change(screen.getByLabelText("Short notes"), { target: { value: "Likes drawings" } });
    await user.click(screen.getByRole("button", { name: "Open Luna López" }));
    const question = await screen.findByRole("alertdialog", { name: "Discard your unsaved community changes?" });
    await user.click(within(question).getByRole("button", { name: "Keep editing" }));
    expect(screen.getByRole("region", { name: "Diego Soto" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open Luna López" }));
    const second = await screen.findByRole("alertdialog", { name: "Discard your unsaved community changes?" });
    await user.click(within(second).getByRole("button", { name: "Discard changes" }));
    expect(await screen.findByRole("region", { name: "Luna López" })).toBeInTheDocument();
    expect(confirm).not.toHaveBeenCalled();
  });

  it("asks in-app before switching the view with edits pending", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: "Open Diego Soto" }));
    fireEvent.change(screen.getByLabelText("Short notes"), { target: { value: "Likes drawings" } });
    await user.click(screen.getByRole("tab", { name: "Groups" }));
    const question = await screen.findByRole("alertdialog", { name: "Discard your unsaved community changes?" });
    expect(screen.getByRole("tab", { name: "Groups" })).toHaveAttribute("aria-selected", "false");
    await user.click(within(question).getByRole("button", { name: "Discard changes" }));
    await waitFor(() => expect(screen.getByRole("tab", { name: "Groups" })).toHaveAttribute("aria-selected", "true"));
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

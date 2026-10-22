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
    expect(within(list).getByText(/Attendance 33% · missed 2 of 3/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open Luna López" }));
    const detail = screen.getByRole("region", { name: "Luna López" });
    expect(within(detail).getByText("Missed 2 of 3")).toBeInTheDocument();
    expect(within(detail).getByRole("table")).toHaveTextContent("Primaria 5A");
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
});

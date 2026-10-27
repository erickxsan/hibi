// @vitest-environment jsdom
import { DatePicker, TimePicker } from "./DateTimePickers";
import { RepeatPicker } from "./RepeatPicker";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { AttendanceRing, BottomSheet, Field, FieldRow, ListRow, MultiSelect, SelectMenu, Switch } from "./ui";
import { StudentAvatar, AvatarPicker } from "./StudentAvatar";
import { I18nProvider, useI18n } from "../i18n";
import { STUDENT_AVATAR_IDS } from "../domain/constants";

describe("Hibi base controls", () => {
  it("searches eight options without accents, skips disabled options and closes on selection or outside", async () => {
    const user = userEvent.setup();
    const change = vi.fn();
    render(
      <Field label="Student" hint="Pick an enrolment" error="Choose a student">
        <SelectMenu value="0" onChange={change}>
          {["Ángela", "Disabled", "Beta", "Gamma", "Delta", "Epsilon", "Zeta", "Eta"].map((name, i) => (
            <option
              key={i}
              value={i}
              disabled={i === 1}
              data-meta={i === 0 ? "Existing group" : undefined}
              data-detail={i === 0 ? "$80/h" : undefined}
            >
              {name}
            </option>
          ))}
        </SelectMenu>
      </Field>,
    );
    const trigger = screen.getByRole("combobox", { name: "Student" });
    expect(trigger).toHaveAttribute("aria-invalid", "true");
    expect(trigger.getAttribute("aria-describedby")).toBe(screen.getByRole("alert").id);
    await user.click(trigger);
    await user.type(screen.getByRole("combobox", { name: "Search options" }), "angela");
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option")).toHaveTextContent("Existing group$80/h");
    await user.keyboard("{Enter}");
    expect(change).toHaveBeenCalledWith({ target: { value: "0" }, currentTarget: { value: "0" } });
    await user.click(trigger);
    await user.keyboard("{ArrowDown}{Enter}");
    expect(change).toHaveBeenLastCalledWith({ target: { value: "2" }, currentTarget: { value: "2" } });
    await user.click(trigger);
    fireEvent.pointerDown(document.querySelector(".picker-popover-layer"));
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
    expect(document.querySelector("select")).toBeNull();
  });

  it("protects every multi-select action while disabled and closes an open control when disabled", async () => {
    const user = userEvent.setup();
    const change = vi.fn();
    const props = {
      ariaLabel: "Groups",
      value: ["a"],
      onChange: change,
      options: [
        { value: "a", label: "Group A" },
        { value: "b", label: "Group B" },
      ],
    };
    const view = render(<MultiSelect {...props} />);
    await user.click(screen.getByRole("combobox", { name: "Groups" }));
    view.rerender(<MultiSelect {...props} disabled />);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear" }));
    await user.click(screen.getByRole("button", { name: "Remove Group A" }));
    expect(change).not.toHaveBeenCalled();
  });

  it("navigates dates with Monday-first weeks, markers, past restrictions and keyboard selection", async () => {
    const user = userEvent.setup();
    const change = vi.fn();
    render(
      <DatePicker
        aria-label="Start date"
        value="2026-10-20"
        today="2026-10-20"
        allowPast={false}
        classDates={["2026-10-21"]}
        repeatDates={["2026-10-22"]}
        onChange={change}
      />,
    );
    await user.click(screen.getByRole("combobox", { name: "Start date" }));
    expect(screen.getByRole("button", { name: /Monday, October 19, 2026/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Previous month" })).toBeDisabled();
    expect(document.querySelector(".date-day.is-today")).toHaveTextContent("20");
    expect(document.querySelector(".date-day.is-repeat")).toHaveTextContent("22");
    expect(document.querySelectorAll(".date-day i")).toHaveLength(1);
    const date = screen.getByRole("button", { name: /Tuesday, October 20, 2026/ });
    date.focus();
    await user.keyboard("{ArrowRight}");
    await waitFor(() => expect(screen.getByRole("button", { name: /Wednesday, October 21, 2026/ })).toHaveFocus());
    await user.keyboard("{Enter}");
    expect(change).toHaveBeenCalledWith(expect.objectContaining({ target: { value: "2026-10-21" } }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("combobox", { name: "Start date" }));
    await user.click(screen.getByRole("button", { name: "Next month" }));
    expect(screen.getByText(/November 2026/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Today" }));
    expect(change).toHaveBeenLastCalledWith(expect.objectContaining({ target: { value: "2026-10-20" } }));
  });

  it("keeps historical filters usable, honors bounds and clears optional dates", async () => {
    const user = userEvent.setup();
    const change = vi.fn();
    render(
      <DatePicker
        aria-label="Report date"
        value="2026-09-15"
        today="2026-10-20"
        allowPast
        min="2026-09-01"
        max="2026-09-30"
        onChange={change}
      />,
    );
    await user.click(screen.getByRole("combobox", { name: "Report date" }));
    expect(screen.getByRole("button", { name: /Tuesday, September 15, 2026/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Next month" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Today" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Clear date" }));
    expect(change).toHaveBeenCalledWith(expect.objectContaining({ target: { value: "" } }));
  });

  it("blocks occupied hours, respects the full duration and picks the first free quarter", async () => {
    const user = userEvent.setup();
    const change = vi.fn();
    render(
      <TimePicker
        aria-label="Class time"
        value="17:00"
        durationMinutes={90}
        minMinutes={480}
        maxMinutes={1260}
        busy={[{ start: 1020, end: 1110, label: "Existing class" }]}
        onChange={change}
      />,
    );
    await user.click(screen.getByRole("combobox", { name: "Class time" }));
    expect(screen.getByRole("button", { name: /5:00.*Occupied/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /8:00.*Outside working hours/ })).toBeDisabled();
    expect(screen.getByText("Conflicts with another class")).toBeInTheDocument();
    expect(screen.getByText(/Occupied: Existing class/)).toBeInTheDocument();
    expect(document.querySelector(".time-dial-busy")).toHaveAttribute("d");
    await user.click(screen.getByRole("button", { name: /^6:00/ }));
    expect(screen.getByRole("button", { name: "Choose minutes" })).toHaveAttribute("aria-pressed", "true");
    expect(document.querySelector(".time-dial-busy")).toBeNull();
    expect(screen.getByRole("button", { name: /00 minutes.*Occupied/ })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "30 minutes" }));
    expect(change).toHaveBeenCalledWith(expect.objectContaining({ target: { value: "18:30" } }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("changes a.m./p.m. and preserves an existing non-quarter time until committed", async () => {
    const user = userEvent.setup();
    const change = vi.fn();
    render(<TimePicker aria-label="Historic time" value="06:07" minMinutes={0} maxMinutes={1440} onChange={change} />);
    await user.click(screen.getByRole("combobox", { name: "Historic time" }));
    expect(screen.getByRole("button", { name: "Choose minutes" })).toHaveTextContent("07");
    await user.click(screen.getByRole("button", { name: "p.m." }));
    await user.click(screen.getByRole("button", { name: /^6:00/ }));
    await user.click(screen.getByRole("button", { name: "15 minutes" }));
    expect(change).toHaveBeenLastCalledWith(expect.objectContaining({ target: { value: "18:15" } }));
  });

  it("writes picker times as «a. m.» / «p. m.» like the rest of the app in Spanish", async () => {
    const user = userEvent.setup();
    localStorage.setItem("hibi:language:v1", "es");
    render(
      <I18nProvider>
        <TimePicker aria-label="Hora" value="10:00" onChange={vi.fn()} />
      </I18nProvider>,
    );
    const trigger = screen.getByRole("combobox", { name: "Hora" });
    expect(trigger).toHaveTextContent("10:00 a. m.");
    expect(trigger).not.toHaveTextContent("a.m.");
    await user.click(trigger);
    expect(screen.getByRole("button", { name: "a. m." })).toBeInTheDocument();
    localStorage.removeItem("hibi:language:v1");
  });

  it("edits daily, weekly and monthly repetition and always previews four upcoming dates", async () => {
    const user = userEvent.setup();
    function Harness() {
      const [value, setValue] = useState({ kind: "weekly", startDate: "2026-10-31", days: [6], interval: 1 });
      return <RepeatPicker value={value} onChange={setValue} conflictingDays={[1]} />;
    }
    render(<Harness />);
    await user.click(screen.getByRole("combobox", { name: "Repeat" }));
    await user.click(screen.getByRole("button", { name: "Daily" }));
    await user.click(screen.getByRole("radio", { name: "Only Monday to Friday" }));
    expect(screen.getByRole("radio", { name: "Only Monday to Friday" })).toHaveAttribute("aria-checked", "true");
    expect(document.querySelector(".repeat-next")).toHaveTextContent(/Mon, Nov 2/);
    await user.click(screen.getByRole("button", { name: "Increase interval" }));
    expect(screen.getByRole("combobox", { name: "Repeat" })).toHaveTextContent("Every 2 days");
    await user.click(screen.getByRole("button", { name: "Weekly" }));
    await user.click(screen.getByRole("button", { name: "Monday" }));
    expect(screen.getByRole("button", { name: "Monday" })).toHaveClass("bad");
    await user.click(screen.getByRole("button", { name: "Monthly" }));
    await user.click(screen.getByRole("radio", { name: "On the last Saturday of the month" }));
    expect(document.querySelector(".repeat-next")).toHaveTextContent(/Nov 28/);
    expect(document.querySelector(".repeat-next")).toHaveTextContent(/Dec 26/);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("keeps child selectors at a second sheet level, handles Back, swipe, focus and expansion", async () => {
    const user = userEvent.setup();
    vi.mocked(window.matchMedia).mockImplementation((media) => ({
      matches: media === "(max-width: 780px)",
      media,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <BottomSheet open={open} onClose={() => setOpen(false)} title="New class">
          <DatePicker aria-label="Start" today="2026-10-20" value="2026-10-20" onChange={vi.fn()} />
        </BottomSheet>
      );
    }
    render(<Harness />);
    await user.click(screen.getByRole("combobox", { name: "Start" }));
    expect(document.querySelectorAll(".bottom-sheet")).toHaveLength(2);
    expect(screen.getByRole("dialog", { name: "New class" })).toHaveAttribute("inert");
    await user.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(document.querySelectorAll(".bottom-sheet")).toHaveLength(1));
    expect(screen.getByRole("dialog", { name: "New class" })).not.toHaveAttribute("inert");
    expect(screen.getByRole("combobox", { name: "Start" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Expand sheet" }));
    expect(document.querySelector(".bottom-sheet")).toHaveClass("is-expanded");
    const grab = screen.getByRole("button", { name: "Collapse sheet" });
    fireEvent.touchStart(grab, { touches: [{ clientY: 10 }] });
    fireEvent.touchEnd(grab, { changedTouches: [{ clientY: 100 }] });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    vi.mocked(window.matchMedia).mockImplementation((media) => ({
      matches: false,
      media,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  });

  it("uses the shared switch and actionable rows, and distinguishes missing attendance from zero", async () => {
    const user = userEvent.setup();
    const change = vi.fn();
    const open = vi.fn();
    render(
      <>
        <FieldRow label="Scope" hint="This session only">
          <Switch label="Include archived groups" checked={false} onChange={change} />
        </FieldRow>
        <ListRow
          avatar={<AttendanceRing value={79.8} />}
          name="Group A"
          context="2 classes"
          value="$80"
          onClick={open}
        />
        <AttendanceRing value={0} />
        <AttendanceRing value={null} />
      </>,
    );
    await user.click(screen.getByRole("switch", { name: "Include archived groups" }));
    expect(change).toHaveBeenCalledWith(true);
    await user.click(screen.getByRole("button", { name: /Group A/ }));
    expect(open).toHaveBeenCalledOnce();
    expect(screen.getByRole("img", { name: "Attendance: 80%" })).toHaveStyle({ "--ring": "var(--jade)" });
    expect(screen.getByRole("img", { name: "Attendance: 0%" })).toHaveStyle({ "--ring": "var(--bermellon)" });
    expect(screen.getByRole("img", { name: "No attendance data" })).toHaveTextContent("—");
  });

  it("keeps all eight avatar IDs, cat fallback, decorative semantics and the existing penguin drawing", async () => {
    const user = userEvent.setup();
    const change = vi.fn();
    const view = render(
      <>
        <StudentAvatar avatarId="unknown" name="Student One" />
        <StudentAvatar avatarId="penguin" decorative />
        <AvatarPicker value="cat" onChange={change} />
      </>,
    );
    expect(screen.getByRole("img", { name: "Cat avatar for Student One" })).toHaveClass("avatar-tone-indigo");
    expect(view.container.querySelectorAll('ellipse[cx="24"][cy="26"][rx="13"][ry="17"]')).toHaveLength(2);
    expect(screen.getAllByRole("radio")).toHaveLength(STUDENT_AVATAR_IDS.length);
    await user.click(screen.getByRole("radio", { name: "Owl" }));
    expect(change).toHaveBeenCalledWith("owl");
  });

  it("translates new control text and announcements when switching languages", async () => {
    const user = userEvent.setup();
    localStorage.setItem("hibi:language:v1", "es");
    function Harness() {
      const { setLanguage, t } = useI18n();
      return (
        <>
          <button onClick={() => setLanguage("en")}>English</button>
          <DatePicker today="2026-10-20" onChange={vi.fn()} />
          <RepeatPicker startDate="2026-10-20" onChange={vi.fn()} />
          <AttendanceRing value={70} />
          <Switch label={t("Include archived groups")} checked={false} onChange={vi.fn()} />
        </>
      );
    }
    render(
      <I18nProvider>
        <Harness />
      </I18nProvider>,
    );
    expect(screen.getByRole("switch", { name: "Incluir grupos archivados" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Asistencia: 70%" })).toBeInTheDocument();
    await user.click(screen.getByRole("combobox", { name: "Elegir fecha" }));
    expect(screen.getByText("Tienes clases")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "English" }));
    expect(screen.getByRole("combobox", { name: "Choose a date" })).toBeInTheDocument();
    localStorage.removeItem("hibi:language:v1");
  });
});

// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Drawer, MultiSelect, Select, Tabs } from "./ui";

describe("interactive UI primitives", () => {
  it("changes tabs and exposes the selected state", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Tabs
        ariaLabel="Record view"
        value="students"
        onChange={onChange}
        items={[
          { value: "students", label: "Students" },
          { value: "groups", label: "Groups" },
        ]}
      />,
    );

    expect(screen.getByRole("button", { name: "Students" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Groups" }));
    expect(onChange).toHaveBeenCalledWith("groups");
  });

  it("keeps keyboard focus inside a drawer and restores it after Escape", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { rerender } = render(
      <>
        <div className="app-shell">
          <button type="button">Open editor</button>
        </div>
        <Drawer open={false} onClose={onClose} title="Edit student" footer={<button type="button">Save</button>}>
          <input aria-label="Student name" />
        </Drawer>
      </>,
    );
    const opener = screen.getByRole("button", { name: "Open editor" });
    opener.focus();

    rerender(
      <>
        <div className="app-shell">
          <button type="button">Open editor</button>
        </div>
        <Drawer open onClose={onClose} title="Edit student" footer={<button type="button">Save</button>}>
          <input aria-label="Student name" />
        </Drawer>
      </>,
    );

    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
    expect(document.querySelector(".app-shell")).toHaveAttribute("inert");
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("supports keyboard selection and multi-select removal", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    function Harness() {
      const [values, setValues] = useState(["g1", "g2"]);
      return (
        <>
          <Select aria-label="Status" value="active" onChange={onSelect}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </Select>
          <MultiSelect
            ariaLabel="Assign groups"
            value={values}
            onChange={setValues}
            options={[
              { value: "g1", label: "Math" },
              { value: "g2", label: "Reading" },
            ]}
          />
        </>
      );
    }

    render(<Harness />);
    const status = screen.getByRole("combobox", { name: "Status" });
    status.focus();
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ target: { value: "inactive" } }));

    await user.click(screen.getByRole("button", { name: "Remove Math" }));
    expect(screen.queryByRole("button", { name: "Remove Math" })).not.toBeInTheDocument();
    expect(screen.getByText("1 selected")).toBeInTheDocument();
  });
});

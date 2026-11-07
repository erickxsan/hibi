// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Drawer, MultiSelect, Select, Tabs, ToastRegion } from "./ui";

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

    expect(screen.getByRole("tab", { name: "Students" })).toHaveAttribute("aria-selected", "true");
    await user.click(screen.getByRole("tab", { name: "Groups" }));
    expect(onChange).toHaveBeenCalledWith("groups");
  });

  it("closes a notice and runs its action from its button", async () => {
    const user = userEvent.setup();
    const run = vi.fn();
    const onDismiss = vi.fn();
    render(
      <ToastRegion
        toasts={[{ id: "t1", message: "Mayo lost", action: { label: "Undo", run } }]}
        onDismiss={onDismiss}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(onDismiss).toHaveBeenCalledWith("t1");
    expect(run).toHaveBeenCalledOnce();
  });

  it("lets Tab reach a notice's action from a drawer, and come back when it closes", async () => {
    const user = userEvent.setup();
    const toast = (
      <div className="toast-region">
        <button type="button" className="toast-action">
          Undo
        </button>
      </div>
    );
    const drawer = (
      <Drawer open onClose={vi.fn()} title="Lost" footer={<button type="button">Done</button>}>
        <input aria-label="Amount" />
      </Drawer>
    );
    const { rerender } = render(
      <>
        {drawer}
        {toast}
      </>,
    );
    const close = screen.getByRole("button", { name: "Close" });
    const done = screen.getByRole("button", { name: "Done" });
    const undo = screen.getByRole("button", { name: "Undo" });
    done.focus();
    await user.tab();
    expect(undo).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.tab({ shift: true });
    expect(undo).toHaveFocus();
    await user.tab({ shift: true });
    expect(done).toHaveFocus();
    undo.focus();
    rerender(<>{drawer}</>);
    await user.tab();
    expect(close).toHaveFocus();
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

  it("locks and restores the page while a mobile choice sheet is open", async () => {
    vi.mocked(window.matchMedia).mockImplementation((query) => ({
      matches: query === "(max-width: 780px)",
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    Object.defineProperty(window, "scrollX", { configurable: true, value: 12 });
    Object.defineProperty(window, "scrollY", { configurable: true, value: 34 });

    render(
      <div className="hibi-shell">
        <Select aria-label="Status" value="active" onChange={vi.fn()}>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </Select>
      </div>,
    );

    fireEvent.click(screen.getByRole("combobox", { name: "Status" }));
    const overlay = document.querySelector(".bottom-sheet-layer");
    expect(screen.getByRole("dialog", { name: "Status" })).toBeInTheDocument();
    expect(document.body).toHaveClass("drawer-open");
    expect(document.body.style.position).toBe("fixed");
    expect(document.body.style.top).toBe("-34px");
    expect(document.querySelector(".hibi-shell")).toHaveAttribute("inert");

    fireEvent.pointerDown(overlay);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Status" })).not.toBeInTheDocument());
    expect(document.body).not.toHaveClass("drawer-open");
    expect(document.body.style.position).toBe("");
    expect(document.querySelector(".hibi-shell")).not.toHaveAttribute("inert");
    expect(window.scrollTo).toHaveBeenCalledWith({ left: 12, top: 34, behavior: "auto" });

    vi.mocked(window.matchMedia).mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  });
});

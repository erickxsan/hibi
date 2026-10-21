// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Field, Input, RepeatPicker } from "./ui";

describe("deferred controls through the existing UI facade", () => {
  it("loads a date control when needed and preserves the legacy onInput callback", async () => {
    const user = userEvent.setup();
    const onInput = vi.fn();
    render(
      <Field label="Through">
        <Input type="date" value="2026-10-20" onInput={onInput} />
      </Field>,
    );
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Through" })).toBeEnabled());
    await user.click(screen.getByRole("combobox", { name: "Through" }));
    await user.click(screen.getByRole("button", { name: "Tuesday, October 20, 2026" }));
    expect(onInput).toHaveBeenCalledWith(expect.objectContaining({ currentTarget: { value: "2026-10-20" } }));
    expect(document.querySelector('input[type="date"]')).toBeNull();
  });

  it("loads the repeat picker and exposes its preview without adding native controls", async () => {
    const user = userEvent.setup();
    render(<RepeatPicker startDate="2026-10-20" onChange={vi.fn()} />);
    const trigger = await screen.findByRole("combobox", { name: "Repeat" });
    await user.click(trigger);
    expect(screen.getByText("Next classes")).toBeInTheDocument();
    expect(document.querySelectorAll("select")).toHaveLength(0);
  });
});

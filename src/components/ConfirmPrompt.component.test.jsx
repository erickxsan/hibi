// @vitest-environment jsdom

import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { useConfirmPrompt } from "./ConfirmPrompt";

function Harness({ request, onAnswer }) {
  const { confirm, prompt } = useConfirmPrompt();
  return (
    <div className="hibi-shell">
      <button type="button" onClick={() => confirm(request).then(onAnswer)}>
        Ask
      </button>
      <button type="button">Elsewhere</button>
      {prompt}
    </div>
  );
}

const DESTRUCTIVE = {
  kicker: "Math",
  title: "Mark this class as cancelled?",
  description: "Existing payments will be preserved.",
  confirmLabel: "Mark cancelled",
  cancelLabel: "Keep class",
  tone: "danger",
};

describe("in-app confirmation", () => {
  it("asks in an alert dialog with the destructive style, starting on the safe button", async () => {
    const user = userEvent.setup();
    const onAnswer = vi.fn();
    const nativeConfirm = vi.spyOn(globalThis, "confirm").mockReturnValue(true);
    render(<Harness request={DESTRUCTIVE} onAnswer={onAnswer} />);

    await user.click(screen.getByRole("button", { name: "Ask" }));
    const dialog = screen.getByRole("alertdialog", { name: "Mark this class as cancelled?" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleDescription("Existing payments will be preserved.");
    expect(screen.getByRole("button", { name: "Mark cancelled" })).toHaveClass("button-danger");
    expect(screen.getByRole("button", { name: "Keep class" })).toHaveFocus();
    // Everything behind the question is out of reach while it is open.
    expect(document.querySelector(".hibi-shell")).toHaveAttribute("inert");

    await user.click(screen.getByRole("button", { name: "Mark cancelled" }));
    expect(onAnswer).toHaveBeenCalledWith(true);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(document.querySelector(".hibi-shell")).not.toHaveAttribute("inert");
    expect(nativeConfirm).not.toHaveBeenCalled();
    nativeConfirm.mockRestore();
  });

  it("declines with Escape and gives focus back to the button that asked", async () => {
    const user = userEvent.setup();
    const onAnswer = vi.fn();
    render(<Harness request={DESTRUCTIVE} onAnswer={onAnswer} />);
    const ask = screen.getByRole("button", { name: "Ask" });

    await user.click(ask);
    await user.keyboard("{Escape}");
    expect(onAnswer).toHaveBeenCalledWith(false);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(ask).toHaveFocus();
  });

  it("keeps Tab inside the dialog and focuses the action of a non-destructive question", async () => {
    const user = userEvent.setup();
    const onAnswer = vi.fn();
    render(
      <Harness
        request={{ title: "1 student is still unmarked. Save anyway?", confirmLabel: "Save anyway", tone: "primary" }}
        onAnswer={onAnswer}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Ask" }));
    const save = screen.getByRole("button", { name: "Save anyway" });
    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect(save).toHaveClass("button-primary");
    expect(save).toHaveFocus();
    await user.tab();
    expect(cancel).toHaveFocus();
    await user.tab({ shift: true });
    expect(save).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onAnswer).toHaveBeenCalledWith(true);
  });

  it("declines from the backdrop and when a newer question replaces it", async () => {
    const user = userEvent.setup();
    const answers = [];
    let ask;
    function Twice() {
      const { confirm, prompt } = useConfirmPrompt();
      ask = confirm;
      return prompt;
    }
    render(<Twice />);

    let first;
    let second;
    act(() => {
      first = ask({ title: "First?", confirmLabel: "Yes" }).then((value) => answers.push(["first", value]));
    });
    act(() => {
      second = ask({ title: "Second?", confirmLabel: "Yes" }).then((value) => answers.push(["second", value]));
    });
    await first;
    expect(screen.getByRole("alertdialog", { name: "Second?" })).toBeInTheDocument();

    await user.pointer({ keys: "[MouseLeft]", target: document.querySelector(".confirm-prompt-layer") });
    await second;
    expect(answers).toEqual([
      ["first", false],
      ["second", false],
    ]);
  });

  it("declines an open question when its owner unmounts", async () => {
    let ask;
    function Owner() {
      const { confirm, prompt } = useConfirmPrompt();
      ask = confirm;
      return prompt;
    }
    const view = render(<Owner />);
    let answer;
    act(() => {
      answer = ask({ title: "Leave?", confirmLabel: "Leave" });
    });
    view.unmount();
    await expect(answer).resolves.toBe(false);
  });
});

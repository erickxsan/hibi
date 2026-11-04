// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { MonthlyFeeUndo } from "./MonthlyFeePay.jsx";

const date = "2026-10-21";
const receipts = [
  { id: "first", amount: 400, paidAt: date },
  { id: "second", amount: 600, paidAt: date },
];
it("asks which legacy same-day receipt to undo and sends only that receipt ID", async () => {
  const onUndo = vi.fn();
  const user = userEvent.setup();
  render(
    <I18nProvider>
      <MonthlyFeeUndo
        charge={{ payments: receipts, paymentId: "second", lastPaidAt: date }}
        date={date}
        onUndo={onUndo}
      />
    </I18nProvider>,
  );
  expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
  await user.selectOptions(screen.getByRole("combobox", { name: "Payment to undo" }), "first");
  await user.click(screen.getByRole("button", { name: "Undo" }));
  expect(onUndo).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ paymentId: "first" }));
});
it("uses the known recording order without adding a selection step", async () => {
  const onUndo = vi.fn();
  const user = userEvent.setup();
  const payments = receipts.map((item) => ({ ...item, recordedAt: "2026-10-21T12:00:00.000Z" }));
  render(
    <I18nProvider>
      <MonthlyFeeUndo charge={{ payments, paymentId: "second", lastPaidAt: date }} date={date} onUndo={onUndo} />
    </I18nProvider>,
  );
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Undo" }));
  expect(onUndo).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ paymentId: "second" }));
});

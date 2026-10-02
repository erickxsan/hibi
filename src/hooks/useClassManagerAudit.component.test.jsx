// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useClassManager } from "./useClassManager.js";
import { createStarterState, createStudent, createClassLogRow, serializeState } from "../domain/index.js";
describe("reviewed import through the live manager", () => {
  it.each(["invalid", NaN, Infinity])(
    "rejects invalid payments rather than rounding %s to zero",
    async (amountPaid) => {
      const initial = createStarterState();
      initial.students = [createStudent({ id: "s1", code: "S1", fullName: "Home" })];
      const persistence = { initialState: initial, mode: "cloud", save: vi.fn(async (state) => state) };
      const hook = renderHook(() => useClassManager({ persistence }));
      let applied;
      await act(async () => {
        applied = await hook.result.current.actions.upsertClassLog(
          createClassLogRow({
            studentId: "s1",
            classDate: initial.settings.asOfDate,
            hours: 1,
            amountPaid,
            paymentDate: initial.settings.asOfDate,
            paymentMethod: "Cash",
          }),
        );
      });
      expect(applied).toBe(false);
      expect(persistence.save).not.toHaveBeenCalled();
      expect(hook.result.current.state.classLog).toHaveLength(0);
    },
  );
  it("rejects old decisions after a second client publishes a change, then accepts a fresh review", async () => {
    const initial = createStarterState({ settings: { onboardingVersion: 2 } });
    initial.students = [createStudent({ id: "s1", code: "S1", fullName: "Home", notes: "A" })];
    let publish;
    const persistence = {
      initialState: initial,
      mode: "cloud",
      save: vi.fn(async (state) => state),
      importRecords: vi.fn(async (state) => ({ state })),
      subscribe: (listener) => {
        publish = listener;
        return () => {};
      },
    };
    const hook = renderHook(() => useClassManager({ persistence }));
    const imported = structuredClone(initial);
    imported.students[0].notes = "B";
    const text = serializeState(imported);
    const preview = await hook.result.current.actions.previewImportRecords(text, "hash");
    const remote = structuredClone(initial);
    remote.students[0].notes = "C";
    await act(async () => publish(remote, { source: "remote" }));
    await waitFor(() => expect(hook.result.current.state.students[0].notes).toBe("C"));
    let applied;
    await act(async () => {
      applied = await hook.result.current.actions.importRecords(text, {
        signature: preview.signature,
        decisions: { [preview.entries[0].key]: "use-imported" },
      });
    });
    expect(applied).toBe(false);
    expect(persistence.importRecords).not.toHaveBeenCalled();
    expect(hook.result.current.state.students[0].notes).toBe("C");
    const fresh = await hook.result.current.actions.previewImportRecords(text, "hash");
    await act(async () => {
      applied = await hook.result.current.actions.importRecords(text, {
        signature: fresh.signature,
        fileHash: "hash",
        decisions: { [fresh.entries[0].key]: "use-imported" },
      });
    });
    expect(applied).toBe(true);
    expect(persistence.importRecords).toHaveBeenCalledOnce();
    expect(hook.result.current.state.students[0].notes).toBe("B");
    hook.unmount();
  });
});

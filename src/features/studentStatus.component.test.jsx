// @vitest-environment jsdom

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStarterState, createStudent } from "../domain";
import { useClassManager } from "../hooks/useClassManager";
import { I18nProvider } from "../i18n";
import { LANGUAGE_STORAGE_KEY } from "../i18n/translations";
import Community from "./Community";
import Setup from "./Setup";
import Students from "./Students";

afterEach(() => localStorage.removeItem(LANGUAGE_STORAGE_KEY));

function StudentStatusHarness({ Feature, persistence }) {
  const manager = useClassManager({ persistence });
  return (
    <I18nProvider>
      <Feature {...manager} registerNavigationBlocker={() => () => {}} />
    </I18nProvider>
  );
}

const editors = [
  { name: "Community drawer", Feature: Community, drawer: true },
  { name: "Community details", Feature: Community, drawer: false },
  { name: "Students drawer", Feature: Students, drawer: true },
  { name: "Setup drawer", Feature: Setup, drawer: true },
];

describe("student status in Spanish", () => {
  it.each(editors)(
    "saves canonical statuses from $name and retains them after reopening",
    async ({ Feature, drawer }) => {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, "es");
      const user = userEvent.setup();
      const initialState = createStarterState({ settings: { onboardingVersion: 2 } });
      const student = createStudent({ id: "s1", code: "A-1", fullName: "Ana López", isIndividual: true });
      initialState.students = [student];
      const persistence = { initialState, mode: "cloud", save: vi.fn(async (state) => state) };
      let view = render(<StudentStatusHarness Feature={Feature} persistence={persistence} />);

      const openEditor = async () => {
        if (Feature === Community && !screen.queryByRole("combobox", { name: /^Estado/ })) {
          await user.click(screen.getByRole("button", { name: /Archivados/ }));
          await user.click(screen.getByRole("button", { name: /Ana López A-1/ }));
        }
        if (drawer) {
          if (Feature === Community) {
            await user.click(screen.getByRole("button", { name: "Cambiar avatar del alumno" }));
          } else if (Feature === Students) {
            const studentRow = screen.queryByRole("button", { name: /Ana López A-1/ });
            if (studentRow) await user.click(studentRow);
            await user.click(screen.getByRole("button", { name: "Editar alumno", exact: true }));
          } else {
            await user.click(screen.getByRole("button", { name: "Editar Ana López", exact: true }));
          }
          return within(await screen.findByRole("dialog", { name: "Editar alumno" }));
        }
        return screen;
      };

      for (const [label, status] of [
        ["Inactivo", "Inactive"],
        ["Activo", "Active"],
      ]) {
        const editor = await openEditor();
        const statusControl = editor.getByRole("combobox", { name: /^Estado/ });
        expect(statusControl).toHaveTextContent(status === "Inactive" ? "Activo" : "Inactivo");
        await user.click(statusControl);
        await user.click(screen.getByRole("option", { name: label, exact: true }));
        expect(statusControl).toHaveTextContent(label);
        await user.click(editor.getByRole("button", { name: drawer ? "Guardar alumno" : "Guardar cambios" }));

        await waitFor(() => expect(persistence.save).toHaveBeenCalledOnce());
        const savedState = persistence.save.mock.calls[0][0];
        expect(savedState.students).toEqual([{ ...student, status }]);
        if (drawer) expect(screen.queryByRole("dialog", { name: "Editar alumno" })).not.toBeInTheDocument();

        view.unmount();
        persistence.initialState = savedState;
        persistence.save.mockClear();
        view = render(<StudentStatusHarness Feature={Feature} persistence={persistence} />);
      }
      const editor = await openEditor();
      expect(editor.getByRole("combobox", { name: /^Estado/ })).toHaveTextContent("Activo");
    },
  );
});

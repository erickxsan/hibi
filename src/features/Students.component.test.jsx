// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import Students from "./Students";

const students = [
  { id: "s1", code: "A-1", fullName: "Ana López", avatarId: "cat", groupIds: ["g1"], status: "Active" },
  { id: "s2", code: "B-2", fullName: "Bruno Díaz", avatarId: "dog", groupIds: [], status: "Inactive" },
];
const groups = [{ id: "g1", name: "Mathematics", schedule: "Tuesday", hourlyRate: 250 }];

function renderStudents(actions = {}) {
  return render(
    <Students
      state={{ students, groups, settings: { hourlyRate: 200 } }}
      derived={{
        students: students.map((student) => ({ ...student, attendance: 0.9, outstanding: 0 })),
        grades: [],
        classLog: [],
        groupsById: new Map(groups.map((group) => [group.id, group])),
      }}
      actions={{ upsertStudent: vi.fn().mockResolvedValue(true), ...actions }}
      registerNavigationBlocker={() => () => {}}
    />,
  );
}

describe("Students", () => {
  it("filters the large student view by text and status", async () => {
    const user = userEvent.setup();
    renderStudents();

    await user.type(screen.getByPlaceholderText("Search students, parents, or groups"), "bruno");
    expect(screen.getByText("Bruno Díaz")).toBeInTheDocument();
    expect(screen.queryByText("Ana López")).not.toBeInTheDocument();

    await user.clear(screen.getByPlaceholderText("Search students, parents, or groups"));
    await user.click(screen.getByText("Filters"));
    await user.click(screen.getByRole("button", { name: "Inactive" }));
    expect(screen.getByText("Bruno Díaz")).toBeInTheDocument();
    expect(screen.queryByText("Ana López")).not.toBeInTheDocument();
  });

  it("creates a student through the rendered drawer", async () => {
    const user = userEvent.setup();
    const upsertStudent = vi.fn().mockResolvedValue(true);
    renderStudents({ upsertStudent });

    await user.click(screen.getByRole("button", { name: "Add student" }));
    await user.type(screen.getByRole("textbox", { name: "Student ID" }), "C-3");
    await user.type(screen.getByRole("textbox", { name: "Full name" }), "Carla Ruiz");
    await user.click(screen.getByRole("button", { name: "Save student" }));

    expect(upsertStudent).toHaveBeenCalledWith(
      expect.objectContaining({ code: "C-3", fullName: "Carla Ruiz", status: "Active" }),
    );
    expect(screen.queryByRole("dialog", { name: "Add student" })).not.toBeInTheDocument();
  });
});

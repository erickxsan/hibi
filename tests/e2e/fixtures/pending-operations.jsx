import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { PendingOperations } from "../../../src/cloud/PendingOperations.jsx";
import "../../../src/styles.css";
function Fixture() {
  const [entries, setEntries] = useState(
    ["a", "b"].map((id) => ({
      id,
      status: "conflict",
      createdAt: "2026-09-07T10:00:00Z",
      mutation: {
        upserts: [{ collection: "students", entityId: id }],
        deletes: [],
        previousState: { students: [{ id, fullName: `Student ${id}`, notes: "Before" }] },
        state: { students: [{ id, fullName: `Student ${id}`, notes: "Local change" }] },
      },
    })),
  );
  const [result, setResult] = useState("");
  return (
    <>
      <h1>Pending operations review</h1>
      <PendingOperations
        persistence={{
          pendingOperations: entries,
          syncMessage: "Review conflicts to resume synchronization.",
          retrySync: async () => {},
          resolvePendingOperation: async (id, choice) => {
            setEntries((current) => current.filter((entry) => entry.id !== id));
            setResult(`${id}: ${choice}`);
          },
        }}
      />
      <p role="status">{result}</p>
    </>
  );
}
createRoot(document.getElementById("root")).render(<Fixture />);

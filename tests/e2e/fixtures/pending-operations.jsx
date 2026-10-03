import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { PendingOperations } from "../../../src/cloud/PendingOperations.jsx";
import { describeOperation } from "../../../src/cloud/workspaceMerge.js";
import "../../../src/styles.css";

const base = (id) => ({ students: [{ id, fullName: `Student ${id}`, notes: "Before", phone: "" }] });
const local = (id) => ({ students: [{ id, fullName: `Student ${id}`, notes: "Local change", phone: "5550001111" }] });
const cloud = (id) => ({ students: [{ id, fullName: `Student ${id}`, notes: "Cloud change", phone: "" }] });

function entry(id, status = "conflict") {
  const mutation = { operationId: id, previousState: base(id), state: local(id) };
  return {
    id,
    status,
    createdAt: "2026-09-07T10:00:00Z",
    mutation,
    review: status === "conflict" ? describeOperation(mutation, cloud(id)) : null,
  };
}

function Fixture() {
  const [entries, setEntries] = useState([entry("a"), entry("b"), entry("c", "pending")]);
  const [result, setResult] = useState("");
  return (
    <>
      <h1>Pending operations review</h1>
      <PendingOperations
        persistence={{
          pendingOperations: entries,
          connectionStatus: "reconnecting",
          retrySync: async () => {},
          resolvePendingOperation: async (id, choice) => {
            setEntries((current) => current.filter((item) => item.id !== id));
            setResult(`${id}: ${choice}`);
          },
        }}
      />
      <output>{result}</output>
    </>
  );
}
createRoot(document.getElementById("root")).render(<Fixture />);

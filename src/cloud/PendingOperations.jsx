import { useState } from "react";

function record(state, item) {
  return item.collection === "settings"
    ? state.settings
    : state[item.collection]?.find((row) => String(row.id) === item.entityId) || null;
}

export function PendingOperations({ persistence }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const entries = persistence?.pendingOperations || [];
  if (!entries.length) return null;
  const resolve = async (id, choice) => {
    setBusy(true);
    setError("");
    try {
      await persistence.resolvePendingOperation(id, choice);
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="pending-operations">
      <summary>Review pending changes ({entries.length})</summary>
      <p>{persistence.syncMessage}</p>
      <p>
        Keep local applies this operation to the current cloud records. Discard removes only this operation; later edits
        are reviewed separately.
      </p>
      {error ? <p role="alert">{error}</p> : null}
      <ul>
        {entries.map((entry) => {
          const items = [...entry.mutation.upserts, ...entry.mutation.deletes];
          return (
            <li key={entry.id}>
              <p>
                {entry.status === "conflict" ? "Conflict" : "Pending"} · {entry.createdAt}
              </p>
              <ul>
                {items.map((item) => (
                  <li key={`${item.collection}/${item.entityId}`}>
                    {item.collection}:{" "}
                    {record(entry.mutation.state, item)?.fullName ||
                      record(entry.mutation.state, item)?.name ||
                      item.entityId}
                  </li>
                ))}
              </ul>
              <details>
                <summary>Review this operation</summary>
                <pre>
                  {JSON.stringify(
                    items.map((item) => ({
                      collection: item.collection,
                      before: record(entry.mutation.previousState, item),
                      after: record(entry.mutation.state, item),
                    })),
                    null,
                    2,
                  )}
                </pre>
              </details>
              <button type="button" disabled={busy} onClick={() => void resolve(entry.id, "local")}>
                Keep local change
              </button>
              <button type="button" disabled={busy} onClick={() => void resolve(entry.id, "discard")}>
                Discard this operation
              </button>
            </li>
          );
        })}
      </ul>
      <button type="button" disabled={busy} onClick={() => void persistence.retrySync()}>
        Retry synchronization
      </button>
    </details>
  );
}

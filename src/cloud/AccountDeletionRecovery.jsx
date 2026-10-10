import { useCallback, useEffect, useRef, useState } from "react";
import { accountDeletionService, purgeLocalAccountData } from "./accountDeletion.js";
import { cloudAuth } from "./client.js";
import { AccountDeletionPending } from "./CloudStates.jsx";

// This screen must work before Auth or the workspace encryption bootstrap.
export function AccountDeletionRecovery({ onDeletionCompleted, onSignOut }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const running = useRef(false);
  const finish = useCallback(
    async (receipt) => {
      if (!receipt) return;
      let localPurgeComplete = true;
      try {
        await purgeLocalAccountData(receipt.ownerId);
        accountDeletionService.clearPending(receipt);
      } catch {
        localPurgeComplete = false;
      }
      try {
        await cloudAuth.signOut({ scope: "local" });
      } catch {
        /* Auth may already be gone. */
      }
      onDeletionCompleted({ ...receipt, localPurgeComplete });
    },
    [onDeletionCompleted],
  );

  const resume = useCallback(
    async (options) => {
      if (running.current) return;
      running.current = true;
      setBusy(true);
      setError("");
      try {
        await finish(
          options ? await accountDeletionService.removeAccount(options) : await accountDeletionService.reconcile(),
        );
      } catch (caught) {
        setError(caught.message || "Deletion could not be resumed.");
      } finally {
        running.current = false;
        setBusy(false);
      }
    },
    [finish],
  );

  useEffect(() => {
    void resume();
  }, [resume]);
  return <AccountDeletionPending busy={busy} error={error} onResume={resume} onSignOut={onSignOut} />;
}

export default AccountDeletionRecovery;

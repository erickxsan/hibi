export const PENDING_ACCOUNT_DELETION_KEY = "hibi:pending-account-deletion:v1";

export class AccountDeletionError extends Error {
  constructor(message, { code = "account_deletion_failed", retryable = false, cause = undefined } = {}) {
    super(message, { cause });
    this.name = "AccountDeletionError";
    this.code = code;
    this.retryable = retryable;
  }
}

function browserStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

export function createAccountDeletionReceiptStore(storage = browserStorage()) {
  function getPending() {
    const raw = storage?.getItem(PENDING_ACCOUNT_DELETION_KEY);
    if (!raw) return null;
    const pending = JSON.parse(raw);
    if (!pending.ownerId || !pending.requestId || !pending.receiptSecret)
      throw new AccountDeletionError("The saved deletion receipt is invalid.", { code: "deletion_receipt_invalid" });
    return pending;
  }
  function savePending(pending) {
    try {
      if (!storage?.setItem) throw new Error("Durable storage unavailable.");
      storage.setItem(PENDING_ACCOUNT_DELETION_KEY, JSON.stringify(pending));
    } catch (cause) {
      throw new AccountDeletionError(
        "Enable browser storage before deleting this account so interrupted deletion can be resumed.",
        {
          code: "deletion_receipt_storage_failed",
          cause,
        },
      );
    }
    return pending;
  }
  function clearPending(receipt) {
    const pending = getPending();
    if (pending?.receiptSecret === receipt.receiptSecret) storage.removeItem(PENDING_ACCOUNT_DELETION_KEY);
  }
  return { getPending, savePending, clearPending };
}

export const pendingAccountDeletionStore = createAccountDeletionReceiptStore();

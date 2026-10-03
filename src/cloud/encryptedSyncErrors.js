import { WorkspaceCryptoError } from "../crypto/index.js";
import { WorkspaceConflictError } from "./workspaceRepository.js";

export function encryptedSyncFailure(error) {
  // Only a content conflict needs a person: values that contradict each other.
  if (error instanceof WorkspaceConflictError || error?.latestState)
    return { status: "conflict", message: "Review the pending operation to keep your change or discard it." };
  if (error instanceof WorkspaceCryptoError || error?.name === "OperationError")
    return {
      status: "error",
      message: "Encrypted data could not be verified or decrypted. Sync is paused; your local changes are preserved.",
    };
  const cause = error?.cause || error;
  const text = `${error?.code || ""} ${cause?.code || ""} ${cause?.message || ""}`.toLowerCase();
  // A revision collision means another device saved first. It is retried
  // automatically after a fresh read; it is not a decision for the user.
  if (
    error?.code === "workspace_contention" ||
    cause?.code === "PT409" ||
    cause?.code === "40001" ||
    /workspace_(revision|entity)_conflict/.test(text)
  )
    return {
      status: "pending",
      message: "Another device saved at the same time. Encrypted local changes will retry automatically.",
    };
  if (/network|fetch|offline|timeout|timed.out|connection|503|502|504/.test(text))
    return {
      status: "pending",
      message: "The connection was interrupted. Encrypted local changes will retry automatically.",
    };
  if (/limit|too.large|quota|54000|outbox_limit|mutation_too_large/.test(text))
    return {
      status: "error",
      message: "A storage or operation limit prevents synchronization. Review or discard pending operations.",
    };
  return {
    status: "error",
    message: `Synchronization needs attention: ${error?.message || "Unknown error"}. Local changes are preserved.`,
  };
}

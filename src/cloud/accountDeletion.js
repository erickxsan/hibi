import { REAL_ROSTER_BACKUP_KEY, REAL_ROSTER_MIGRATION_KEY, STORAGE_KEY } from "../domain/index.js";
import { deviceKeyStore } from "../crypto/index.js";
import { requireCloudClient, supabase } from "./client.js";
import { deviceRecoveryStore } from "./deviceRecoveryStore.js";
import { createOperationId } from "./workspaceRepository.js";

export const ACCOUNT_DELETION_CONFIRMATION = "DELETE MY ACCOUNT";
export const MIGRATION_MARKER_PREFIX = "minimal-class-manager:cloud-migration-dismissed:v1:";
export const LEGACY_DATA_CLAIM_KEY = "minimal-class-manager:legacy-data-claimed:v1";
const UI_STORAGE_PREFIX = "minimal-class-manager:ui:v1:";

export class AccountDeletionError extends Error {
  constructor(message, { code = "account_deletion_failed", retryable = false, cause } = {}) {
    super(message, { cause });
    this.name = "AccountDeletionError";
    this.code = code;
    this.retryable = retryable;
  }
}

async function errorPayload(error) {
  try {
    return (await error?.context?.json?.()) || {};
  } catch {
    return {};
  }
}

function messageForCode(code) {
  if (code === "recent_authentication_required") {
    return "For security, sign out and sign in again, then retry account deletion within 10 minutes.";
  }
  if (code === "account_deletion_incomplete" || code === "account_auth_deletion_failed") {
    return "Your records were erased, but Auth deletion still needs to finish. Retry with this browser.";
  }
  if (code === "account_data_deletion_failed") {
    return "Account deletion could not finish safely. No unverified completion was reported; retry shortly.";
  }
  if (code === "account_storage_deletion_failed") {
    return "Hibi could not finish removing account files. The account remains blocked; retry shortly.";
  }
  return "The verified account deletion could not be completed.";
}

function normalizeReceipt(data, fallback) {
  if (!data || data.status !== "completed") return null;
  return {
    requestId: data.requestId || fallback.requestId,
    receiptSecret: data.receiptSecret || fallback.receiptSecret,
    completedAt: data.completedAt || new Date().toISOString(),
    status: "completed",
    verified: Boolean(data.verified),
  };
}

export function createAccountDeletionService(client = supabase, cryptoApi = globalThis.crypto) {
  const cloud = () => requireCloudClient(client);

  async function verify({ requestId, receiptSecret }) {
    const { data, error } = await cloud().functions.invoke("delete-account", {
      body: { action: "verify", requestId, receiptSecret },
    });
    if (error) {
      const payload = await errorPayload(error);
      throw new AccountDeletionError(messageForCode(payload.code), {
        code: payload.code || "receipt_verification_failed",
        retryable: Boolean(payload.retryable),
        cause: error,
      });
    }
    return normalizeReceipt(data, { requestId, receiptSecret }) || data;
  }

  async function removeAccount({ confirmation }) {
    if (confirmation !== ACCOUNT_DELETION_CONFIRMATION) {
      throw new AccountDeletionError("Type the complete confirmation phrase before deleting the account.", {
        code: "account_deletion_not_confirmed",
      });
    }
    const { data: userData, error: userError } = await cloud().auth.getUser();
    if (userError || !userData?.user) {
      throw new AccountDeletionError("Sign in before deleting the account.", {
        code: "authentication_required",
        cause: userError,
      });
    }
    const requestId = createOperationId(cryptoApi);
    const receiptSecret = createOperationId(cryptoApi);
    const { data, error } = await cloud().functions.invoke("delete-account", {
      body: {
        action: "delete",
        confirmation,
        requestId,
        receiptSecret,
      },
    });
    if (!error) {
      const receipt = normalizeReceipt(data, { requestId, receiptSecret });
      if (receipt) return { ...receipt, ownerId: userData.user.id };
    }

    const payload = await errorPayload(error);
    if (payload.status === "data_erased" || (!payload.code && error)) {
      try {
        const verified = await verify({ requestId, receiptSecret });
        const receipt = normalizeReceipt(verified, { requestId, receiptSecret });
        if (receipt) return { ...receipt, ownerId: userData.user.id };
        if (verified?.retryable || verified?.status === "pending") {
          throw new AccountDeletionError(
            "Account deletion is pending. Hibi has blocked new writes; retry the verified deletion.",
            { code: "account_deletion_incomplete", retryable: true },
          );
        }
      } catch (verificationError) {
        if (verificationError.code !== "deletion_receipt_not_found") throw verificationError;
      }
    }
    const code = payload.code || "account_deletion_failed";
    throw new AccountDeletionError(messageForCode(code), {
      code,
      retryable: Boolean(payload.retryable),
      cause: error,
    });
  }

  return { removeAccount, verify };
}

export async function purgeLocalAccountData(
  ownerId,
  { storage = globalThis.localStorage, recoveryStore = deviceRecoveryStore, workspaceKeyStore = deviceKeyStore } = {},
) {
  if (!ownerId) throw new TypeError("An account ID is required for local purging.");
  const failures = [];
  try {
    await recoveryStore.purgeAccount(ownerId);
  } catch (error) {
    failures.push(error);
  }
  try {
    await workspaceKeyStore.forget(ownerId);
  } catch (error) {
    failures.push(error);
  }
  if (storage) {
    const keys = [`${UI_STORAGE_PREFIX}${ownerId}`, `${MIGRATION_MARKER_PREFIX}${ownerId}`];
    try {
      if (storage.getItem(LEGACY_DATA_CLAIM_KEY) === ownerId) {
        keys.push(STORAGE_KEY, REAL_ROSTER_BACKUP_KEY, REAL_ROSTER_MIGRATION_KEY, LEGACY_DATA_CLAIM_KEY);
      }
    } catch (error) {
      failures.push(error);
    }
    for (const key of keys) {
      try {
        storage.removeItem(key);
      } catch (error) {
        failures.push(error);
      }
    }
  }
  if (failures.length) throw new AggregateError(failures, "Some browser data could not be purged.");
}

export const accountDeletionService = createAccountDeletionService();

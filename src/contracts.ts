/** Contracts consumed by the manager: inferred from the active adapters, checked by tsc. */
import type { useEncryptedWorkspace } from "./cloud/useEncryptedWorkspace.js";
import type { useCloudWorkspace } from "./cloud/useCloudWorkspace.js";

export type PersistenceAdapter = Partial<
  NonNullable<ReturnType<typeof useEncryptedWorkspace>["persistence"]> &
    NonNullable<ReturnType<typeof useCloudWorkspace>["persistence"]>
>;

export interface CryptoSession {
  readonly ownerId: string;
  readonly workspaceCryptoId: string;
  readonly keyVersion: number;
  readonly method: string;
  readonly masterKey: Uint8Array;
  lock(): void;
}
export interface KeyWrapper {
  wrapperId: string;
  type: "password" | "recovery" | "passkey";
  label?: string;
  wrapperVersion: number;
  keyVersion: number;
  nonce: string;
  wrappedKey: string;
  recoveryFingerprint?: string;
  kdfAlgorithm?: string;
  kdfIterations?: number;
  kdfSalt?: string;
  revokedAt?: string | null;
}
export interface EntityMutation {
  operationId: string;
  empty?: boolean;
  upserts: Array<{ collection: string; entityId: string; entityRevision: number; ciphertext: string }>;
  deletes: Array<{ collection: string; entityId: string }>;
}

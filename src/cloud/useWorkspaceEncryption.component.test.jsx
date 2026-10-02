// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceEncryption } from "./useWorkspaceEncryption.js";

const mocks = vi.hoisted(() => ({
  repository: {},
  keys: {},
  store: {},
  parseRecoveryKey: vi.fn(),
  recoveryKeyFingerprints: vi.fn(),
  unwrapMasterKey: vi.fn(),
}));
vi.mock("./deviceRecoveryStore.js", () => ({ deviceRecoveryStore: mocks.store }));
vi.mock("./encryptedWorkspaceRepository.js", () => ({ encryptedWorkspaceRepository: mocks.repository }));
vi.mock("../crypto/index.js", async (original) => ({
  ...(await original()),
  deviceKeyStore: mocks.keys,
  parseRecoveryKey: mocks.parseRecoveryKey,
  recoveryKeyFingerprints: mocks.recoveryKeyFingerprints,
  unwrapMasterKey: mocks.unwrapMasterKey,
}));

const user = { id: "owner" };
const protectedWorkspace = {
  profile: { migrationStatus: "active", workspaceCryptoId: "workspace", activeKeyVersion: 2 },
  wrappers: [{ type: "password", revokedAt: null }],
};
const outage = Object.assign(new Error("Could not query the database for the schema cache. Retrying."), {
  code: "PGRST002",
});

beforeEach(() => {
  Object.assign(mocks.store, { listMutations: vi.fn(async () => []), purgeAccount: vi.fn(async () => {}) });
  Object.assign(mocks.repository, {
    loadBootstrap: vi.fn(async () => protectedWorkspace),
    migrateLegacyWorkspace: vi.fn(),
    abortMigration: vi.fn(),
  });
  Object.assign(mocks.keys, {
    describe: vi.fn(async () => ({ ownerId: user.id })),
    unlock: vi.fn(async () => new Uint8Array(32).fill(7)),
    forget: vi.fn(async () => {}),
  });
});

describe("workspace encryption bootstrap recovery", () => {
  it("wipes recovered key material when remembering the device fails", async () => {
    const key = new Uint8Array(32).fill(9);
    const secret = new Uint8Array(32).fill(8);
    mocks.repository.loadBootstrap.mockResolvedValue({
      ...protectedWorkspace,
      wrappers: [{ wrapperId: "recovery", type: "recovery", recoveryFingerprint: "full" }],
    });
    mocks.keys.unlock.mockResolvedValue(null);
    mocks.keys.remember = vi.fn(async () => {
      throw new Error("Device storage unavailable");
    });
    mocks.repository.touchWrapper = vi.fn(async () => {});
    mocks.parseRecoveryKey.mockResolvedValue(secret);
    mocks.recoveryKeyFingerprints.mockResolvedValue(["full", "legacy"]);
    mocks.unwrapMasterKey.mockResolvedValue(key);
    const hook = renderHook(() => useWorkspaceEncryption(user));
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    await act(async () => {
      await hook.result.current.unlockRecovery("synthetic recovery");
    });
    expect(hook.result.current.error.message).toBe("Device storage unavailable");
    expect(hook.result.current.session).toBeNull();
    expect(key).toEqual(new Uint8Array(32));
    expect(secret).toEqual(new Uint8Array(32));
    hook.unmount();
  });
  it("preserves pending offline changes and remembered access until shared-device clearing can complete", async () => {
    const hook = renderHook(() => useWorkspaceEncryption(user));
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    const session = hook.result.current.session;
    mocks.store.listMutations.mockResolvedValueOnce([{ id: "unsynced" }]);
    await expect(hook.result.current.security.clearLocalCopies()).rejects.toThrow("pending change");
    expect(mocks.store.purgeAccount).not.toHaveBeenCalled();
    expect(mocks.keys.forget).not.toHaveBeenCalled();
    expect(hook.result.current.session).toBe(session);
    await act(async () => {
      await hook.result.current.security.clearLocalCopies();
    });
    expect(mocks.store.purgeAccount).toHaveBeenCalledWith(user.id, { preservePending: true });
    expect(mocks.keys.forget).toHaveBeenCalledWith(user.id);
    expect(hook.result.current.session).toBeNull();
    expect(() => session.masterKey).toThrow("locked");
    hook.unmount();
  });
  it("does not try a local key or activate encryption before the profile can be checked", async () => {
    mocks.repository.loadBootstrap.mockRejectedValue(outage);
    const hook = renderHook(() => useWorkspaceEncryption(user));
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    expect(hook.result.current.bootstrap).toBeNull();
    expect(hook.result.current.error).toBe(outage);
    expect(mocks.keys.unlock).not.toHaveBeenCalled();
    await act(async () => {
      await hook.result.current.activate({ password: "not a real password" });
    });
    expect(mocks.repository.migrateLegacyWorkspace).not.toHaveBeenCalled();
    hook.unmount();
  });

  it("retries the complete unlock flow and clears an outage without asking for a password", async () => {
    mocks.repository.loadBootstrap.mockRejectedValueOnce(outage);
    const hook = renderHook(() => useWorkspaceEncryption(user));
    await waitFor(() => expect(hook.result.current.error).toBe(outage));
    await act(async () => {
      await hook.result.current.retry();
    });
    expect(hook.result.current.loading).toBe(false);
    expect(hook.result.current.error).toBeNull();
    expect(hook.result.current.session).toMatchObject({ method: "remembered-device", keyVersion: 2 });
    expect(hook.result.current.session.masterKey).toEqual(new Uint8Array(32).fill(7));
    expect(mocks.keys.unlock).toHaveBeenCalledWith({
      ownerId: "owner",
      workspaceCryptoId: "workspace",
      expectedKeyVersion: 2,
    });
    const session = hook.result.current.session;
    hook.unmount();
    expect(() => session.masterKey).toThrow("locked");
  });

  it("keeps recovery retryable when the server is still unavailable", async () => {
    mocks.repository.loadBootstrap.mockRejectedValue(outage);
    const hook = renderHook(() => useWorkspaceEncryption(user));
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    await act(async () => {
      await hook.result.current.retry();
    });
    expect(hook.result.current.error).toBe(outage);
    expect(hook.result.current.loading).toBe(false);
    expect(hook.result.current.bootstrap).toBeNull();
    hook.unmount();
  });

  it("leaves an active account locked if no matching device key exists, without permitting setup", async () => {
    mocks.keys.unlock.mockResolvedValue(null);
    const hook = renderHook(() => useWorkspaceEncryption(user));
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    expect(hook.result.current.bootstrap).toBe(protectedWorkspace);
    expect(hook.result.current.session).toBeNull();
    await act(async () => {
      await hook.result.current.activate({ password: "not a real password" });
    });
    expect(mocks.repository.migrateLegacyWorkspace).not.toHaveBeenCalled();
    hook.unmount();
  });

  it.each(["unmount", "lock"])("wipes a late device key and cannot unlock after %s", async (action) => {
    let finishUnlock;
    const key = new Uint8Array(32).fill(7);
    mocks.keys.unlock.mockReturnValue(
      new Promise((resolve) => {
        finishUnlock = resolve;
      }),
    );
    const hook = renderHook(() => useWorkspaceEncryption(user));
    await waitFor(() => expect(mocks.keys.unlock).toHaveBeenCalledOnce());
    if (action === "unmount") hook.unmount();
    else
      await act(async () => {
        await hook.result.current.lock({ forget: true });
      });
    await act(async () => {
      finishUnlock(key);
    });
    expect(key).toEqual(new Uint8Array(32));
    expect(hook.result.current.session).toBeNull();
    if (action === "lock") {
      expect(mocks.keys.forget).toHaveBeenCalledWith(user.id);
      hook.unmount();
    }
  });

  it("ignores an obsolete failed request after a later retry succeeds", async () => {
    let failFirst;
    mocks.repository.loadBootstrap.mockReturnValueOnce(
      new Promise((_, reject) => {
        failFirst = reject;
      }),
    );
    const hook = renderHook(() => useWorkspaceEncryption(user));
    await act(async () => {
      await hook.result.current.retry();
    });
    await act(async () => {
      failFirst(outage);
    });
    expect(hook.result.current.error).toBeNull();
    expect(hook.result.current.session?.method).toBe("remembered-device");
    hook.unmount();
  });
});

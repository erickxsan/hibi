// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceEncryption } from "./useWorkspaceEncryption.js";

const mocks = vi.hoisted(() => ({ repository: {}, keys: {} }));
vi.mock("./encryptedWorkspaceRepository.js", () => ({ encryptedWorkspaceRepository: mocks.repository }));
vi.mock("../crypto/index.js", async (original) => ({ ...(await original()), deviceKeyStore: mocks.keys }));

const user = { id: "owner" };
const protectedWorkspace = {
  profile: { migrationStatus: "active", workspaceCryptoId: "workspace", activeKeyVersion: 2 },
  wrappers: [{ type: "password", revokedAt: null }],
};
const outage = Object.assign(new Error("Could not query the database for the schema cache. Retrying."), {
  code: "PGRST002",
});

beforeEach(() => {
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

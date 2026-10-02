// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceEncryption } from "./useWorkspaceEncryption.js";
import {
  createPasswordWrapper,
  generateAccountMasterKey,
  generateRecoveryKey,
  generateWorkspaceCryptoId,
  recoveryKeyFingerprints,
  wrapMasterKey,
  unlockWithPassword,
  parseRecoveryKey,
  unwrapMasterKey,
} from "../crypto/index.js";
const mocks = vi.hoisted(() => ({ repository: {}, keys: {}, store: {} }));
vi.mock("./encryptedWorkspaceRepository.js", () => ({ encryptedWorkspaceRepository: mocks.repository }));
vi.mock("./deviceRecoveryStore.js", () => ({ deviceRecoveryStore: mocks.store }));
vi.mock("../crypto/index.js", async (original) => ({ ...(await original()), deviceKeyStore: mocks.keys }));
const user = { id: "33333333-3333-4333-8333-333333333333" };
let bootstrap, masterKey, workspaceCryptoId;
beforeEach(async () => {
  vi.stubGlobal("crypto", webcrypto);
  // Node WebCrypto returns Node buffers while jsdom supplies a separate realm.
  vi.stubGlobal("ArrayBuffer", new TextEncoder().encode("").buffer.constructor);
  masterKey = generateAccountMasterKey();
  workspaceCryptoId = generateWorkspaceCryptoId();
  bootstrap = {
    profile: { migrationStatus: "active", workspaceCryptoId, activeKeyVersion: 1 },
    wrappers: [
      await createPasswordWrapper({ masterKey, workspaceCryptoId, password: "synthetic violet canyon lantern" }),
    ],
  };
  Object.assign(mocks.repository, {
    loadBootstrap: vi.fn(async () => bootstrap),
    touchWrapper: vi.fn(async () => {}),
    addWrapper: vi.fn(async (wrapper) => bootstrap.wrappers.push(wrapper)),
    replacePasswordWrapper: vi.fn(async (id, wrapper) => {
      bootstrap = {
        ...bootstrap,
        wrappers: bootstrap.wrappers.filter((item) => item.wrapperId !== id).concat(wrapper),
      };
    }),
  });
  Object.assign(mocks.keys, {
    describe: vi.fn(async () => null),
    unlock: vi.fn(async () => null),
    remember: vi.fn(async () => true),
    forget: vi.fn(async () => {}),
  });
});
afterEach(() => {
  masterKey.fill(0);
  vi.unstubAllGlobals();
});
describe("actual password and recovery material through the encryption hook", () => {
  it("unlocks with the original password, replaces it and creates a usable complete recovery wrapper", async () => {
    const hook = renderHook(() => useWorkspaceEncryption(user));
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    await act(async () => {
      await hook.result.current.unlockPassword("incorrect", { rememberDevice: false });
    });
    expect(hook.result.current.error.code).toBe("invalid_password");
    await act(async () => {
      await hook.result.current.unlockPassword("synthetic violet canyon lantern", { rememberDevice: false });
    });
    expect(hook.result.current.session.masterKey).toEqual(masterKey);
    await act(async () => {
      await hook.result.current.security.changePassword(
        "synthetic violet canyon lantern",
        "synthetic forest river meadow",
      );
    });
    const replacement = bootstrap.wrappers.find((item) => item.type === "password");
    expect(
      await unlockWithPassword({ wrapper: replacement, workspaceCryptoId, password: "synthetic forest river meadow" }),
    ).toEqual(masterKey);
    let formatted;
    await act(async () => {
      formatted = await hook.result.current.security.createRecoveryKey();
    });
    const recoveryWrapper = bootstrap.wrappers.find((item) => item.type === "recovery");
    expect(recoveryWrapper.recoveryFingerprint).toHaveLength(43);
    const secret = await parseRecoveryKey(formatted);
    expect(await unwrapMasterKey({ wrapper: recoveryWrapper, workspaceCryptoId, wrappingSecret: secret })).toEqual(
      masterKey,
    );
    secret.fill(0);
    hook.unmount();
  });
  it.each([0, 1])("unlocks recovery format %s from a fresh locked session", async (format) => {
    const recovery = await generateRecoveryKey();
    const wrapperId = crypto.randomUUID();
    bootstrap.wrappers.push({
      wrapperId,
      type: "recovery",
      recoveryFingerprint: (await recoveryKeyFingerprints(recovery.secret))[format],
      ...(await wrapMasterKey({ masterKey, workspaceCryptoId, wrappingSecret: recovery.secret, wrapperId })),
    });
    const hook = renderHook(() => useWorkspaceEncryption(user));
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    await act(async () => {
      await hook.result.current.unlockRecovery(recovery.formatted);
    });
    expect(hook.result.current.error).toBeNull();
    expect(hook.result.current.session.masterKey).toEqual(masterKey);
    expect(mocks.keys.remember).toHaveBeenCalledOnce();
    recovery.secret.fill(0);
    hook.unmount();
  });
});

import { describe, expect, it, vi } from "vitest";
import { canAttemptPasskeyPrf, registerPasskey, rewrapPasskey, unlockWithPasskey } from "./passkeys.js";
import { generateAccountMasterKey, generateWorkspaceCryptoId } from "./workspaceCrypto.js";

function credentialWithPrf(rawId, secret) {
  return {
    rawId,
    response: { getTransports: () => ["internal"] },
    getClientExtensionResults: () => ({ prf: { results: { first: secret.buffer.slice(0) } } }),
  };
}

describe("WebAuthn PRF workspace wrappers", () => {
  it("feature-detects both WebAuthn and the canonical production origin", () => {
    expect(
      canAttemptPasskeyPrf({ credentials: {}, PublicKeyCredentialApi: {}, origin: "https://usehibi.pages.dev" }),
    ).toBe(true);
    expect(
      canAttemptPasskeyPrf({ credentials: {}, PublicKeyCredentialApi: {}, origin: "https://preview.pages.dev" }),
    ).toBe(false);
  });

  it("binds registration and unlock to the production RP and keeps PRF local", async () => {
    const masterKey = generateAccountMasterKey();
    const workspaceCryptoId = generateWorkspaceCryptoId();
    const rawId = crypto.getRandomValues(new Uint8Array(24)).buffer;
    const prfSecret = crypto.getRandomValues(new Uint8Array(32));
    const create = vi.fn().mockResolvedValue(credentialWithPrf(rawId, prfSecret));
    const get = vi.fn().mockResolvedValue(credentialWithPrf(rawId, prfSecret));
    const credentials = { create, get };
    const environment = {
      credentials,
      PublicKeyCredentialApi: {},
      origin: "https://usehibi.pages.dev",
    };

    const wrapper = await registerPasskey({
      user: { id: "11111111-1111-4111-8111-111111111111", email: "teacher@example.test" },
      masterKey,
      workspaceCryptoId,
      ...environment,
    });
    expect(create.mock.calls[0][0].publicKey.rp.id).toBe("usehibi.pages.dev");
    expect(create.mock.calls[0][0].publicKey.extensions.prf.eval.first).toBeInstanceOf(ArrayBuffer);
    expect(JSON.stringify(wrapper)).not.toContain([...prfSecret].join(","));
    await expect(unlockWithPasskey({ wrapper, workspaceCryptoId, ...environment })).resolves.toEqual(masterKey);
    expect(get.mock.calls[0][0].publicKey.rpId).toBe("usehibi.pages.dev");
  });

  it("refuses production credential management from localhost or a preview", async () => {
    await expect(
      registerPasskey({
        user: { id: "user", email: "teacher@example.test" },
        masterKey: generateAccountMasterKey(),
        workspaceCryptoId: generateWorkspaceCryptoId(),
        credentials: {},
        PublicKeyCredentialApi: {},
        origin: "http://localhost:4173",
      }),
    ).rejects.toMatchObject({ code: "invalid_passkey_origin" });
  });

  it("evaluates PRF after creation when needed and rewraps a rotated AMK", async () => {
    const rawId = crypto.getRandomValues(new Uint8Array(24)).buffer;
    const prfSecret = crypto.getRandomValues(new Uint8Array(32));
    const credentials = {
      create: vi.fn().mockResolvedValue({
        rawId,
        response: { getTransports: () => ["internal"] },
        getClientExtensionResults: () => ({ prf: { enabled: true } }),
      }),
      get: vi.fn().mockResolvedValue(credentialWithPrf(rawId, prfSecret)),
    };
    const workspaceCryptoId = generateWorkspaceCryptoId();
    const environment = {
      credentials,
      PublicKeyCredentialApi: {},
      origin: "https://usehibi.pages.dev",
    };
    const wrapper = await registerPasskey({
      user: { id: "11111111-1111-4111-8111-111111111111", email: "teacher@example.test" },
      masterKey: generateAccountMasterKey(),
      workspaceCryptoId,
      ...environment,
    });
    const rotatedMasterKey = generateAccountMasterKey();
    const rotated = await rewrapPasskey({
      wrapper,
      newMasterKey: rotatedMasterKey,
      workspaceCryptoId,
      keyVersion: 2,
      ...environment,
    });
    expect(rotated.keyVersion).toBe(2);
    await expect(unlockWithPasskey({ wrapper: rotated, workspaceCryptoId, ...environment })).resolves.toEqual(
      rotatedMasterKey,
    );
  });
});

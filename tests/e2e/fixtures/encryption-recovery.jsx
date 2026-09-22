import React from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "../../../src/i18n/index.jsx";
import { useWorkspaceEncryption } from "../../../src/cloud/useWorkspaceEncryption.js";
import { WorkspaceEncryptionGate } from "../../../src/cloud/WorkspaceEncryptionGate.jsx";
import { encryptedWorkspaceRepository } from "../../../src/cloud/encryptedWorkspaceRepository.js";
import { deviceKeyStore, generateAccountMasterKey, wipeBytes } from "../../../src/crypto/index.js";
import "../../../src/styles.css";

// Isolated synthetic account. No Supabase requests or real user keys are used.
const user = { id: "encryption-recovery-test" };
const workspaceCryptoId = "encryption-recovery-workspace";
const masterKey = generateAccountMasterKey();
await deviceKeyStore.remember({ ownerId: user.id, workspaceCryptoId, masterKey, keyVersion: 1 });
wipeBytes(masterKey);
let checks = 0;
encryptedWorkspaceRepository.loadBootstrap = async () => {
  if (++checks === 1)
    throw Object.assign(new Error("Could not query the database for the schema cache. Retrying."), {
      code: "PGRST002",
    });
  return {
    profile: { migrationStatus: "active", workspaceCryptoId, activeKeyVersion: 1 },
    wrappers: [{ type: "password", revokedAt: null }],
  };
};

function Fixture() {
  const encryption = useWorkspaceEncryption(user);
  if (encryption.session)
    return (
      <main>
        <h1>Workspace unlocked</h1>
        <p role="status">{encryption.session.method}</p>
      </main>
    );
  return (
    <WorkspaceEncryptionGate
      {...encryption}
      accountEmail="test@example.test"
      onActivate={encryption.activate}
      onUnlockPassword={encryption.unlockPassword}
      onUnlockRecovery={encryption.unlockRecovery}
      onRetry={encryption.retry}
      onSignOut={() => encryption.lock({ forget: true })}
    />
  );
}

createRoot(document.getElementById("root")).render(
  <I18nProvider>
    <Fixture />
  </I18nProvider>,
);

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createPasswordWrapper,
  createCryptoSession,
  deviceKeyStore,
  equalBytes,
  generateAccountMasterKey,
  generateRecoveryKey,
  generateWorkspaceCryptoId,
  parseRecoveryKey,
  recoveryKeyFingerprint,
  rewrapPassword,
  unlockWithPassword,
  unwrapMasterKey,
  wipeBytes,
  wrapMasterKey,
} from "../crypto/index.js";
import { encryptedWorkspaceRepository } from "./encryptedWorkspaceRepository.js";
import { deviceRecoveryStore } from "./deviceRecoveryStore.js";
import { runExclusiveWorkspaceMigration } from "./workspaceMigrationCoordinator.js";

function progressMessage(stage, details) {
  if (stage === "syncing") return "Syncing pending changes before encryption…";
  if (stage === "starting") return "Preparing the encrypted migration…";
  if (stage === "uploading") return `Encrypting and staging records ${details?.completed || 0}/${details?.total || 0}…`;
  if (stage === "verifying") return "Downloading and verifying every encrypted record…";
  if (stage === "finalizing") return "Activating E2EE and removing readable cloud records…";
  if (stage === "complete") return "Encrypted migration complete.";
  return "Securing your workspace…";
}

export function useWorkspaceEncryption(user) {
  const [bootstrap, setBootstrap] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState("");
  const [rememberedDevice, setRememberedDevice] = useState(null);
  const sessionRef = useRef(null);

  const adoptSession = useCallback((nextSession) => {
    sessionRef.current?.lock();
    sessionRef.current = nextSession;
    setSession(nextSession);
  }, []);

  const refresh = useCallback(async () => {
    const next = await encryptedWorkspaceRepository.loadBootstrap(user.id);
    setBootstrap(next);
    return next;
  }, [user.id]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const next = await encryptedWorkspaceRepository.loadBootstrap(user.id);
        if (!active) return;
        setBootstrap(next);
        setRememberedDevice(await deviceKeyStore.describe(user.id).catch(() => null));
        if (next.profile?.migrationStatus === "active") {
          const masterKey = await deviceKeyStore.unlock({
            ownerId: user.id,
            workspaceCryptoId: next.profile.workspaceCryptoId,
            expectedKeyVersion: next.profile.activeKeyVersion,
          });
          if (masterKey && active) {
            adoptSession(
              createCryptoSession({
                ownerId: user.id,
                workspaceCryptoId: next.profile.workspaceCryptoId,
                masterKey,
                keyVersion: next.profile.activeKeyVersion,
                method: "remembered-device",
              }),
            );
            wipeBytes(masterKey);
            setRememberedDevice(await deviceKeyStore.describe(user.id).catch(() => null));
          }
        }
      } catch (caught) {
        if (active) setError(caught);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [adoptSession, user.id]);

  useEffect(
    () => () => {
      sessionRef.current?.lock();
      sessionRef.current = null;
    },
    [user.id],
  );

  const activate = useCallback(
    async ({ password, rememberDevice = true } = {}) => {
      if (busy) return;
      setBusy(true);
      setError(null);
      let masterKey = null;
      try {
        await runExclusiveWorkspaceMigration(user.id, async () => {
          if (bootstrap?.profile?.migrationStatus === "migration_started") {
            setProgress("Resetting the incomplete passkey migration…");
            await encryptedWorkspaceRepository.abortMigration(user.id);
          }
          masterKey = generateAccountMasterKey();
          const workspaceCryptoId = generateWorkspaceCryptoId();
          const passwordWrapper = await createPasswordWrapper({
            masterKey,
            password,
            workspaceCryptoId,
            label: "Encryption password",
          });
          await encryptedWorkspaceRepository.migrateLegacyWorkspace({
            user,
            masterKey,
            workspaceCryptoId,
            keyWrapper: passwordWrapper,
            onProgress: (stage, details) => setProgress(progressMessage(stage, details)),
          });
          if (rememberDevice)
            await deviceKeyStore.remember({ ownerId: user.id, workspaceCryptoId, masterKey, keyVersion: 1 });
          setRememberedDevice(await deviceKeyStore.describe(user.id).catch(() => null));
          adoptSession(
            createCryptoSession({ ownerId: user.id, workspaceCryptoId, masterKey, keyVersion: 1, method: "password" }),
          );
          masterKey = null;
          await refresh();
        });
      } catch (caught) {
        setError(caught);
      } finally {
        if (masterKey) wipeBytes(masterKey);
        setProgress("");
        setBusy(false);
      }
    },
    [adoptSession, bootstrap?.profile?.migrationStatus, busy, refresh, user],
  );

  const unlockPassword = useCallback(
    async (password, { rememberDevice = true } = {}) => {
      if (busy || !bootstrap?.profile) return;
      setBusy(true);
      setError(null);
      try {
        const wrapper = bootstrap.wrappers.find((candidate) => candidate.type === "password" && !candidate.revokedAt);
        if (!wrapper) throw new Error("No encryption password is registered for this workspace.");
        const unlock = async () => {
          const masterKey = await unlockWithPassword({
            wrapper,
            password,
            workspaceCryptoId: bootstrap.profile.workspaceCryptoId,
          });
          try {
            if (bootstrap.profile.migrationStatus === "migration_started") {
              setProgress("Resuming the verified encrypted migration…");
              await encryptedWorkspaceRepository.migrateLegacyWorkspace({
                user,
                masterKey,
                workspaceCryptoId: bootstrap.profile.workspaceCryptoId,
                keyWrapper: wrapper,
                onProgress: (stage, details) => setProgress(progressMessage(stage, details)),
              });
              await refresh();
            }
            await encryptedWorkspaceRepository.touchWrapper(wrapper.wrapperId, user.id).catch(() => {});
            if (rememberDevice) {
              await deviceKeyStore.remember({
                ownerId: user.id,
                workspaceCryptoId: bootstrap.profile.workspaceCryptoId,
                masterKey,
                keyVersion: bootstrap.profile.activeKeyVersion,
              });
            }
            setRememberedDevice(await deviceKeyStore.describe(user.id).catch(() => null));
            adoptSession(
              createCryptoSession({
                ownerId: user.id,
                workspaceCryptoId: bootstrap.profile.workspaceCryptoId,
                masterKey,
                keyVersion: bootstrap.profile.activeKeyVersion,
                method: "password",
              }),
            );
            await refresh();
          } finally {
            wipeBytes(masterKey);
          }
        };
        if (bootstrap.profile.migrationStatus === "migration_started") {
          await runExclusiveWorkspaceMigration(user.id, unlock);
        } else {
          await unlock();
        }
      } catch (caught) {
        setError(caught);
      } finally {
        setProgress("");
        setBusy(false);
      }
    },
    [adoptSession, bootstrap, busy, refresh, user],
  );

  const unlockRecovery = useCallback(
    async (formattedKey, { rememberDevice = true } = {}) => {
      if (busy || !bootstrap?.profile) return;
      setBusy(true);
      setError(null);
      let secret;
      try {
        secret = await parseRecoveryKey(formattedKey);
        const fingerprint = await recoveryKeyFingerprint(secret);
        const wrapper = bootstrap.wrappers.find(
          (candidate) =>
            candidate.type === "recovery" && !candidate.revokedAt && candidate.recoveryFingerprint === fingerprint,
        );
        if (!wrapper) throw new Error("That recovery key is not registered for this workspace.");
        const masterKey = await unwrapMasterKey({
          wrapper,
          wrappingSecret: secret,
          workspaceCryptoId: bootstrap.profile.workspaceCryptoId,
        });
        await encryptedWorkspaceRepository.touchWrapper(wrapper.wrapperId, user.id).catch(() => {});
        if (rememberDevice) {
          await deviceKeyStore.remember({
            ownerId: user.id,
            workspaceCryptoId: bootstrap.profile.workspaceCryptoId,
            masterKey,
            keyVersion: bootstrap.profile.activeKeyVersion,
          });
        }
        setRememberedDevice(await deviceKeyStore.describe(user.id).catch(() => null));
        adoptSession(
          createCryptoSession({
            ownerId: user.id,
            workspaceCryptoId: bootstrap.profile.workspaceCryptoId,
            masterKey,
            keyVersion: bootstrap.profile.activeKeyVersion,
            method: "recovery-key",
          }),
        );
        await refresh();
        wipeBytes(masterKey);
      } catch (caught) {
        setError(caught);
      } finally {
        if (secret) wipeBytes(secret);
        setBusy(false);
      }
    },
    [adoptSession, bootstrap, busy, refresh, user.id],
  );

  const changePassword = useCallback(
    async (currentPassword, newPassword) => {
      if (!sessionRef.current || !bootstrap?.profile) throw new Error("Unlock the workspace first.");
      const currentWrapper = bootstrap.wrappers.find(
        (candidate) => candidate.type === "password" && !candidate.revokedAt,
      );
      if (!currentWrapper) throw new Error("No encryption password is registered for this workspace.");
      const verifiedMasterKey = await unlockWithPassword({
        wrapper: currentWrapper,
        password: currentPassword,
        workspaceCryptoId: sessionRef.current.workspaceCryptoId,
      });
      try {
        if (!equalBytes(verifiedMasterKey, sessionRef.current.masterKey)) {
          throw new Error("That encryption password is incorrect.");
        }
      } finally {
        wipeBytes(verifiedMasterKey);
      }
      const wrapper = await createPasswordWrapper({
        masterKey: sessionRef.current.masterKey,
        password: newPassword,
        workspaceCryptoId: sessionRef.current.workspaceCryptoId,
        keyVersion: sessionRef.current.keyVersion,
        label: "Encryption password",
      });
      await encryptedWorkspaceRepository.replacePasswordWrapper(currentWrapper.wrapperId, wrapper, user.id);
      await refresh();
      return wrapper;
    },
    [bootstrap, refresh, user],
  );

  const createRecoveryKey = useCallback(async () => {
    if (!sessionRef.current) throw new Error("Unlock the workspace first.");
    const recovery = await generateRecoveryKey();
    try {
      const wrapperId = crypto.randomUUID();
      const wrapped = await wrapMasterKey({
        masterKey: sessionRef.current.masterKey,
        wrappingSecret: recovery.secret,
        workspaceCryptoId: sessionRef.current.workspaceCryptoId,
        wrapperId,
        keyVersion: sessionRef.current.keyVersion,
      });
      const wrapper = {
        wrapperId,
        type: "recovery",
        label: "Recovery key",
        recoveryFingerprint: await recoveryKeyFingerprint(recovery.secret),
        ...wrapped,
      };
      await encryptedWorkspaceRepository.addWrapper(wrapper, user.id);
      await refresh();
      return recovery.formatted;
    } finally {
      wipeBytes(recovery.secret);
    }
  }, [refresh, user.id]);

  const revokeWrapper = useCallback(
    async (wrapperId) => {
      await encryptedWorkspaceRepository.revokeWrapper(wrapperId, user.id);
      await refresh();
    },
    [refresh, user.id],
  );

  const rotateKey = useCallback(
    async (password, onProgress) => {
      if (!sessionRef.current || !bootstrap?.profile) throw new Error("Unlock the workspace first.");
      const queued = await deviceRecoveryStore.listMutations(user.id);
      if (queued.length) throw new Error("Sync every encrypted offline change before rotating the master key.");
      const currentSession = sessionRef.current;
      let newMasterKey = generateAccountMasterKey();
      const nextKeyVersion = currentSession.keyVersion + 1;
      try {
        const activePasswords = bootstrap.wrappers.filter(
          (wrapper) => wrapper.type === "password" && !wrapper.revokedAt,
        );
        if (!activePasswords.length)
          throw new Error("An active encryption password is required for emergency rotation.");
        onProgress?.("Verifying the encryption password for the new master key…");
        let rotatedWrapper = null;
        for (const wrapper of activePasswords) {
          try {
            rotatedWrapper = await rewrapPassword({
              wrapper,
              password,
              currentMasterKey: currentSession.masterKey,
              newMasterKey,
              workspaceCryptoId: currentSession.workspaceCryptoId,
              keyVersion: nextKeyVersion,
            });
            break;
          } catch (error) {
            if (error?.code !== "invalid_password") throw error;
          }
        }
        if (!rotatedWrapper) throw new Error("That encryption password is incorrect.");
        const wrappers = [rotatedWrapper];
        const rotated = await encryptedWorkspaceRepository.rotateWorkspaceKey({
          oldSession: currentSession,
          newMasterKey,
          wrappers,
          expectedOwnerId: user.id,
          onProgress,
        });
        await deviceRecoveryStore.purgeAccount(user.id);
        await deviceRecoveryStore.cacheWorkspace(user.id, rotated);
        await deviceKeyStore.remember({
          ownerId: user.id,
          workspaceCryptoId: currentSession.workspaceCryptoId,
          masterKey: newMasterKey,
          keyVersion: nextKeyVersion,
        });
        setRememberedDevice(await deviceKeyStore.describe(user.id).catch(() => null));
        await deviceKeyStore.writeIntegrity({
          ownerId: user.id,
          workspaceCryptoId: currentSession.workspaceCryptoId,
          revision: rotated.revision,
          root: rotated.manifest.root,
        });
        adoptSession(
          createCryptoSession({
            ownerId: user.id,
            workspaceCryptoId: currentSession.workspaceCryptoId,
            masterKey: newMasterKey,
            keyVersion: nextKeyVersion,
            method: "rotated-password",
          }),
        );
        newMasterKey = null;
        await refresh();
        return true;
      } finally {
        if (newMasterKey) wipeBytes(newMasterKey);
      }
    },
    [adoptSession, bootstrap, refresh, user.id],
  );

  const rememberDevice = useCallback(async () => {
    if (!sessionRef.current) throw new Error("Unlock the workspace first.");
    await deviceKeyStore.remember({
      ownerId: user.id,
      workspaceCryptoId: sessionRef.current.workspaceCryptoId,
      masterKey: sessionRef.current.masterKey,
      keyVersion: sessionRef.current.keyVersion,
    });
    setRememberedDevice(await deviceKeyStore.describe(user.id).catch(() => null));
    return true;
  }, [user.id]);

  const forgetDevice = useCallback(async () => {
    await deviceKeyStore.forget(user.id);
    setRememberedDevice(null);
  }, [user.id]);

  const lock = useCallback(
    async ({ forget = false } = {}) => {
      sessionRef.current?.lock();
      sessionRef.current = null;
      setSession(null);
      if (forget) {
        await deviceKeyStore.forget(user.id);
        setRememberedDevice(null);
      }
    },
    [user.id],
  );

  const security = useMemo(
    () => ({
      enabled: bootstrap?.profile?.migrationStatus === "active",
      profile: bootstrap?.profile || null,
      wrappers: bootstrap?.wrappers || [],
      rememberedDevices: rememberedDevice ? [rememberedDevice] : [],
      method: session?.method || null,
      changePassword,
      createRecoveryKey,
      revokeWrapper,
      rotateKey,
      rememberDevice,
      forgetDevice,
      lock,
    }),
    [
      bootstrap,
      changePassword,
      createRecoveryKey,
      forgetDevice,
      lock,
      rememberDevice,
      rememberedDevice,
      revokeWrapper,
      rotateKey,
      session?.method,
    ],
  );

  return {
    bootstrap,
    session,
    security,
    loading,
    busy,
    error,
    progress,
    activate,
    unlockPassword,
    unlockRecovery,
    lock,
    retry: refresh,
  };
}

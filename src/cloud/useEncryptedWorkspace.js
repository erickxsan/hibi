import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createStarterState } from "../domain/index.js";
import { deviceKeyStore, unlockWithPassword, wipeBytes } from "../crypto/index.js";
import { deviceRecoveryStore } from "./deviceRecoveryStore.js";
import { encryptedWorkspaceRepository } from "./encryptedWorkspaceRepository.js";
import { statusForOutbox } from "./workspaceOutbox.js";
import { createOperationId, WorkspaceConflictError } from "./workspaceRepository.js";

export function useEncryptedWorkspace(user, cryptoSession, security) {
  const [workspace, setWorkspace] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [syncStatus, setSyncStatus] = useState("saved");
  const [syncMessage, setSyncMessage] = useState("");
  const workspaceRef = useRef(null);
  const syncStatusRef = useRef("saved");
  const flushPromiseRef = useRef(null);
  const mutationGenerationRef = useRef(0);
  const rerunFlushRef = useRef(false);

  const updateSync = useCallback((status, message = "") => {
    syncStatusRef.current = status;
    setSyncStatus(status);
    setSyncMessage(message);
  }, []);

  const writeWitness = useCallback(
    (verifiedWorkspace) =>
      deviceKeyStore
        .writeIntegrity({
          ownerId: user.id,
          workspaceCryptoId: cryptoSession.workspaceCryptoId,
          revision: verifiedWorkspace.revision,
          root: verifiedWorkspace.manifest.root,
        })
        .catch(() => false),
    [cryptoSession.workspaceCryptoId, user.id],
  );

  const captureDeviceCopy = useCallback(
    async (state, revision, source, updatedAt = null) => {
      try {
        return await deviceRecoveryStore.capture({ ownerId: user.id, state, revision, source, updatedAt });
      } catch {
        return null;
      }
    },
    [user.id],
  );

  const applyWorkspace = useCallback((incoming, { allowOlder = false } = {}) => {
    if (!incoming || (!allowOlder && workspaceRef.current && incoming.revision < workspaceRef.current.revision))
      return false;
    workspaceRef.current = incoming;
    setWorkspace(incoming);
    return true;
  }, []);

  const flushPending = useCallback(() => {
    if (flushPromiseRef.current) return flushPromiseRef.current;
    const generation = mutationGenerationRef.current;
    const task = (async () => {
      const queued = await deviceRecoveryStore.listMutations(user.id);
      const conflict = queued.find((entry) => entry.status === "conflict");
      if (conflict) {
        updateSync("conflict", "A same-record conflict needs review. Your encrypted local version is preserved.");
        return { status: "conflict" };
      }
      const witness = await deviceKeyStore
        .readIntegrity({ ownerId: user.id, workspaceCryptoId: cryptoSession.workspaceCryptoId })
        .catch(() => null);
      let latest = await encryptedWorkspaceRepository.loadWorkspace(cryptoSession, user.id, witness || {});
      for (const entry of queued) {
        try {
          latest = await encryptedWorkspaceRepository.applyMutation(entry.mutation, cryptoSession, user.id);
          await deviceRecoveryStore.completeMutation(user.id, entry.id);
          await deviceRecoveryStore.cacheWorkspace(user.id, latest);
          await writeWitness(latest);
        } catch (caught) {
          if (caught instanceof WorkspaceConflictError || caught?.latestState) {
            await deviceRecoveryStore.markMutationConflict(user.id, entry.id, caught.message);
            updateSync("conflict", "Another device changed the same encrypted record. Your local copy is preserved.");
            return { status: "conflict", error: caught };
          }
          throw caught;
        }
      }
      const remaining = await deviceRecoveryStore.listMutations(user.id);
      if (remaining.length || generation !== mutationGenerationRef.current) {
        rerunFlushRef.current = true;
        updateSync("pending", "Encrypted changes are safe on this device and waiting to sync.");
        return { status: "pending" };
      }
      if (latest) {
        applyWorkspace(latest, { allowOlder: true });
        void captureDeviceCopy(latest.state, latest.revision, "encrypted-cloud-sync", latest.updatedAt);
      }
      setError(null);
      updateSync("saved");
      return { status: "saved", workspace: latest };
    })()
      .catch(async (caught) => {
        const queued = await deviceRecoveryStore.listMutations(user.id).catch(() => []);
        updateSync(
          queued.length ? "pending" : "offline",
          queued.length
            ? "Encrypted changes are safe on this device and will retry automatically."
            : "Using the encrypted copy saved on this device.",
        );
        return { status: queued.length ? "pending" : "offline", error: caught };
      })
      .finally(() => {
        flushPromiseRef.current = null;
        if (rerunFlushRef.current) {
          rerunFlushRef.current = false;
          globalThis.setTimeout?.(() => void flushPending(), 0);
        }
      });
    flushPromiseRef.current = task;
    return task;
  }, [applyWorkspace, captureDeviceCopy, cryptoSession, updateSync, user.id, writeWitness]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    (async () => {
      const [cached, queued, witness] = await Promise.all([
        deviceRecoveryStore.loadWorkspaceCache(user.id).catch(() => null),
        deviceRecoveryStore.listMutations(user.id).catch(() => []),
        deviceKeyStore
          .readIntegrity({ ownerId: user.id, workspaceCryptoId: cryptoSession.workspaceCryptoId })
          .catch(() => null),
      ]);
      const localWorkspace = queued.at(-1)?.workspace || cached;
      if (!active) return;
      if (localWorkspace?.workspaceCryptoId === cryptoSession.workspaceCryptoId) {
        applyWorkspace(localWorkspace, { allowOlder: true });
        updateSync(statusForOutbox(queued), queued.length ? "Encrypted changes are waiting to sync." : "");
        setLoading(false);
      }
      try {
        const loaded = await encryptedWorkspaceRepository.loadWorkspace(cryptoSession, user.id, witness || {});
        if (!active) return;
        if (queued.length) {
          void flushPending();
        } else {
          applyWorkspace(loaded, { allowOlder: true });
          await deviceRecoveryStore.cacheWorkspace(user.id, loaded);
          await writeWitness(loaded);
          void captureDeviceCopy(loaded.state, loaded.revision, "encrypted-cloud-load", loaded.updatedAt);
          updateSync("saved");
        }
      } catch (caught) {
        if (!active) return;
        if (localWorkspace) {
          updateSync(queued.length ? "pending" : "offline", "Cloud is unavailable; using verified device storage.");
        } else {
          setError(caught);
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [applyWorkspace, captureDeviceCopy, cryptoSession, flushPending, reloadToken, updateSync, user.id, writeWitness]);

  useEffect(() => {
    const reconnect = () => void flushPending();
    globalThis.addEventListener?.("online", reconnect);
    return () => globalThis.removeEventListener?.("online", reconnect);
  }, [flushPending]);

  const save = useCallback(
    async (state, previousState) => {
      const current = workspaceRef.current;
      if (!current) throw new Error("The encrypted workspace is not ready.");
      const mutation = await encryptedWorkspaceRepository.prepareMutation({
        state,
        previousState: previousState || current.state,
        workspace: current,
        session: cryptoSession,
        operationId: createOperationId(),
      });
      if (mutation.empty) return { state: current.state, pending: false };
      const optimistic = encryptedWorkspaceRepository.optimisticWorkspace(current, mutation, cryptoSession);
      await deviceRecoveryStore.stageMutation({ ownerId: user.id, workspace: optimistic, mutation });
      mutationGenerationRef.current += 1;
      applyWorkspace(optimistic);
      updateSync("pending", "Encrypted changes are safe on this device and waiting to sync.");
      globalThis.setTimeout?.(() => void flushPending(), 0);
      return { state: optimistic.state, pending: true };
    },
    [applyWorkspace, cryptoSession, flushPending, updateSync, user.id],
  );

  const requireEmptyOutbox = useCallback(async () => {
    const queued = await deviceRecoveryStore.listMutations(user.id);
    if (queued.length) throw new Error("Reconnect and finish syncing encrypted changes before this operation.");
  }, [user.id]);

  const replace = useCallback(
    async (state, reason = "replace", importMetadata = null, returnWorkspace = false) => {
      await requireEmptyOutbox();
      const previous = workspaceRef.current;
      if (previous) await captureDeviceCopy(previous.state, previous.revision, `before-${reason}`, previous.updatedAt);
      const replaced = await encryptedWorkspaceRepository.replaceWorkspace(
        state,
        cryptoSession,
        user.id,
        reason,
        importMetadata,
      );
      applyWorkspace(replaced, { allowOlder: true });
      await deviceRecoveryStore.cacheWorkspace(user.id, replaced);
      await writeWitness(replaced);
      updateSync("saved");
      return returnWorkspace ? replaced : replaced.state;
    },
    [applyWorkspace, captureDeviceCopy, cryptoSession, requireEmptyOutbox, updateSync, user.id, writeWitness],
  );

  const importRecords = useCallback(
    async (state, metadata) => {
      const imported = await replace(state, "import", metadata, true);
      return { state: imported.state, alreadyImported: Boolean(imported.alreadyImported) };
    },
    [replace],
  );

  const findImportJob = useCallback(
    (fileHash) => encryptedWorkspaceRepository.findImportJob(fileHash, cryptoSession, user.id),
    [cryptoSession, user.id],
  );

  const listRecoveryPoints = useCallback(async () => {
    const [cloudPoints, devicePoints] = await Promise.all([
      encryptedWorkspaceRepository.listSnapshots(user.id).catch(() => []),
      deviceRecoveryStore.list(user.id).catch(() => []),
    ]);
    return [...cloudPoints, ...devicePoints].sort((left, right) =>
      String(right.capturedAt).localeCompare(String(left.capturedAt)),
    );
  }, [user.id]);

  const loadRecoveryPoint = useCallback(
    (point) =>
      point?.source === "encrypted-cloud-snapshot"
        ? encryptedWorkspaceRepository.loadSnapshot(point.id, cryptoSession, user.id)
        : deviceRecoveryStore.load(user.id, point?.id),
    [cryptoSession, user.id],
  );

  const restoreRecoveryPoint = useCallback(
    async (point) => {
      const copy = await loadRecoveryPoint(point);
      if (!copy) throw new Error("That encrypted recovery copy is no longer available.");
      const state = await replace(copy.state, "restore");
      return { state };
    },
    [loadRecoveryPoint, replace],
  );

  const resetWorkspace = useCallback(() => replace(createStarterState(), "reset"), [replace]);

  const subscribe = useCallback(
    (onChange) => {
      let disposed = false;
      let cleanup;
      encryptedWorkspaceRepository
        .subscribe(
          cryptoSession,
          async (incoming) => {
            if (disposed || ["pending", "conflict"].includes(syncStatusRef.current)) return;
            if (applyWorkspace(incoming)) {
              await deviceRecoveryStore.cacheWorkspace(user.id, incoming);
              await writeWitness(incoming);
              onChange(incoming.state);
            }
          },
          {
            userId: user.id,
            onStatus: (status) => {
              if (status === "SUBSCRIBED") updateSync("saved");
              if (["CHANNEL_ERROR", "TIMED_OUT"].includes(status)) updateSync("offline", "Live updates disconnected.");
            },
            onError: () => updateSync("offline", "Encrypted live updates disconnected."),
          },
        )
        .then((unsubscribe) => {
          if (disposed) void unsubscribe();
          else cleanup = unsubscribe;
        })
        .catch(() => updateSync("offline", "Encrypted live updates disconnected."));
      return () => {
        disposed = true;
        if (cleanup) void cleanup();
      };
    },
    [applyWorkspace, cryptoSession, updateSync, user.id, writeWitness],
  );

  const downloadEncryptedBackup = useCallback(async () => {
    if (!workspaceRef.current) throw new Error("The encrypted workspace is not ready.");
    return encryptedWorkspaceRepository.exportBackup(workspaceRef.current, security.wrappers, cryptoSession);
  }, [cryptoSession, security.wrappers]);

  const previewEncryptedBackup = useCallback(
    (text, recoveryKey) =>
      encryptedWorkspaceRepository.decryptBackup(text, cryptoSession, { recoveryKey: recoveryKey || "" }),
    [cryptoSession],
  );

  const importEncryptedBackup = useCallback(
    async (text, recoveryKey) => {
      const state = await encryptedWorkspaceRepository.decryptBackup(text, cryptoSession, {
        recoveryKey: recoveryKey || "",
      });
      return { state: await replace(state, "restore") };
    },
    [cryptoSession, replace],
  );

  const decryptBackupWithPassword = useCallback(
    async (text, password) => {
      const backup = JSON.parse(text);
      const wrapper = (backup.wrappers || []).find(
        (candidate) => candidate.type === "password" && !candidate.revokedAt,
      );
      if (!wrapper) throw new Error("This backup does not contain a compatible password wrapper.");
      const sourceMasterKey = await unlockWithPassword({
        wrapper,
        password,
        workspaceCryptoId: backup.workspaceCryptoId,
      });
      try {
        return await encryptedWorkspaceRepository.decryptBackup(text, cryptoSession, { sourceMasterKey });
      } finally {
        wipeBytes(sourceMasterKey);
      }
    },
    [cryptoSession],
  );

  const previewEncryptedBackupWithPassword = decryptBackupWithPassword;

  const importEncryptedBackupWithPassword = useCallback(
    async (text, password) => ({ state: await replace(await decryptBackupWithPassword(text, password), "restore") }),
    [decryptBackupWithPassword, replace],
  );

  const persistence = useMemo(
    () =>
      workspace
        ? {
            mode: "cloud",
            encrypted: true,
            encryption: security,
            uiStorageKey: `minimal-class-manager:ui:v1:${user.id}`,
            initialState: workspace.state,
            syncStatus,
            syncMessage,
            save,
            replace,
            importRecords,
            findImportJob,
            subscribe,
            listRecoveryPoints,
            loadRecoveryPoint,
            restoreRecoveryPoint,
            resetWorkspace,
            downloadEncryptedBackup,
            previewEncryptedBackup,
            importEncryptedBackup,
            previewEncryptedBackupWithPassword,
            importEncryptedBackupWithPassword,
          }
        : null,
    [
      downloadEncryptedBackup,
      findImportJob,
      importEncryptedBackup,
      importEncryptedBackupWithPassword,
      importRecords,
      listRecoveryPoints,
      loadRecoveryPoint,
      replace,
      previewEncryptedBackup,
      previewEncryptedBackupWithPassword,
      resetWorkspace,
      restoreRecoveryPoint,
      save,
      security,
      subscribe,
      syncMessage,
      syncStatus,
      user.id,
      workspace,
    ],
  );

  return {
    workspace,
    persistence,
    loading,
    error,
    retry: () => setReloadToken((value) => value + 1),
    syncStatus,
    syncMessage,
  };
}

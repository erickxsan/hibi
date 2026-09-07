import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createStarterState } from "../domain/index.js";
import { deviceKeyStore, unlockWithPassword, wipeBytes } from "../crypto/index.js";
import { deviceRecoveryStore } from "./deviceRecoveryStore.js";
import { encryptedWorkspaceRepository } from "./encryptedWorkspaceRepository.js";
import { statusForOutbox } from "./workspaceOutbox.js";
import { encryptedSyncFailure } from "./encryptedSyncErrors.js";
import { createOperationId, WorkspaceConflictError } from "./workspaceRepository.js";

export function useEncryptedWorkspace(user, cryptoSession, security) {
  const [workspace, setWorkspace] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [syncStatus, setSyncStatus] = useState("saved");
  const [syncMessage, setSyncMessage] = useState("");
  const [pendingOperations, setPendingOperations] = useState([]);
  const resolvingRef = useRef(false);
  const listenersRef = useRef(new Set());
  const savePromiseRef = useRef(null);
  const retryTimerRef = useRef(null);
  const retryDelayRef = useRef(2000);
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

  const applyWorkspace = useCallback((incoming, { allowOlder = false, notify = false } = {}) => {
    if (!incoming || (!allowOlder && workspaceRef.current && incoming.revision <= workspaceRef.current.revision))
      return false;
    workspaceRef.current = incoming;
    setWorkspace(incoming);
    if (notify) for (const listener of listenersRef.current) listener(incoming.state);
    return true;
  }, []);

  const flushPending = useCallback(() => {
    if (resolvingRef.current) return Promise.resolve({ status: "pending" });
    if (flushPromiseRef.current) return flushPromiseRef.current;
    globalThis.clearTimeout(retryTimerRef.current);
    retryTimerRef.current = null;
    const generation = mutationGenerationRef.current;
    const task = (async () => {
      await savePromiseRef.current;
      const queued = await deviceRecoveryStore.listMutations(user.id);
      setPendingOperations(queued);
      const witness = await deviceKeyStore
        .readIntegrity({ ownerId: user.id, workspaceCryptoId: cryptoSession.workspaceCryptoId })
        .catch(() => null);
      let latest = await encryptedWorkspaceRepository.loadWorkspace(cryptoSession, user.id, witness || {});
      const blocked = new Set();
      for (const entry of queued) {
        const keys = [...entry.mutation.upserts, ...entry.mutation.deletes].map(
          (item) => `${item.collection}/${item.entityId}`,
        );
        if (entry.status === "conflict" || keys.some((key) => blocked.has(key))) {
          keys.forEach((key) => blocked.add(key));
          continue;
        }
        try {
          latest = await encryptedWorkspaceRepository.applyMutation(entry.mutation, cryptoSession, user.id);
          await deviceRecoveryStore.completeMutation(user.id, entry.id);
          await writeWitness(latest);
        } catch (caught) {
          if (caught instanceof WorkspaceConflictError || caught?.latestState) {
            await deviceRecoveryStore.markMutationConflict(user.id, entry.id, caught.message);
            keys.forEach((key) => blocked.add(key));
            continue;
          }
          throw caught;
        }
      }
      const remaining = await deviceRecoveryStore.listMutations(user.id);
      setPendingOperations(remaining);
      if (generation !== mutationGenerationRef.current) rerunFlushRef.current = true;
      if (remaining.some((entry) => entry.status === "conflict")) {
        updateSync("conflict", "Review pending operations. Changes to other records can still sync.");
        return { status: "conflict" };
      }
      if (remaining.length || generation !== mutationGenerationRef.current) {
        rerunFlushRef.current = true;
        updateSync("pending", "Encrypted changes are safe on this device and waiting to sync.");
        return { status: "pending" };
      }
      if (latest) {
        await deviceRecoveryStore.cacheWorkspace(user.id, latest);
        applyWorkspace(latest, { allowOlder: true, notify: true });
        void captureDeviceCopy(latest.state, latest.revision, "encrypted-cloud-sync", latest.updatedAt);
      }
      setError(null);
      retryDelayRef.current = 2000;
      updateSync("saved");
      return { status: "saved", workspace: latest };
    })()
      .catch(async (caught) => {
        const queued = await deviceRecoveryStore.listMutations(user.id).catch(() => []);
        setPendingOperations(queued);
        const failure = encryptedSyncFailure(caught);
        updateSync(failure.status, failure.message);
        if (failure.status === "pending" && !retryTimerRef.current) {
          retryTimerRef.current = globalThis.setTimeout(() => {
            retryTimerRef.current = null;
            void flushPending();
          }, retryDelayRef.current);
          retryDelayRef.current = Math.min(retryDelayRef.current * 2, 60000);
        }
        return { status: failure.status, error: caught };
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
      const localWorkspace = cached || queued.at(-1)?.workspace;
      setPendingOperations(queued);
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
          const failure = encryptedSyncFailure(caught);
          updateSync(failure.status, failure.message);
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
    return () => {
      globalThis.removeEventListener?.("online", reconnect);
      globalThis.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    };
  }, [flushPending]);

  const save = useCallback(
    (state, previousState) => {
      if (resolvingRef.current)
        return Promise.reject(new Error("Finish resolving the pending operation before editing."));
      mutationGenerationRef.current += 1;
      const task = (async () => {
        await savePromiseRef.current;
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
        applyWorkspace(optimistic);
        updateSync("pending", "Encrypted changes are safe on this device and waiting to sync.");
        globalThis.setTimeout?.(() => void flushPending(), 0);
        return { state: optimistic.state, pending: true };
      })();
      savePromiseRef.current = task.catch(() => {});
      return task;
    },
    [applyWorkspace, cryptoSession, flushPending, updateSync, user.id],
  );

  const resolvePendingOperation = useCallback(
    async (operationId, choice) => {
      if (!["local", "discard"].includes(choice)) throw new Error("Choose keep local or discard.");
      if (resolvingRef.current) throw new Error("An operation is already being resolved.");
      resolvingRef.current = true;
      try {
        await savePromiseRef.current;
        await flushPromiseRef.current;
        const queued = await deviceRecoveryStore.listMutations(user.id);
        const entry = queued.find((item) => item.id === operationId);
        if (!entry) throw new Error("This pending operation no longer exists.");
        const witness = await deviceKeyStore.readIntegrity({
          ownerId: user.id,
          workspaceCryptoId: cryptoSession.workspaceCryptoId,
        });
        const latest = await encryptedWorkspaceRepository.loadWorkspace(cryptoSession, user.id, witness || {});
        await captureDeviceCopy(
          workspaceRef.current.state,
          workspaceRef.current.revision,
          "before-conflict-resolution",
        );
        const mutation =
          choice === "local"
            ? await encryptedWorkspaceRepository.resolveMutation(entry.mutation, latest, cryptoSession)
            : null;
        const remaining = queued.flatMap((pending) =>
          pending.id !== operationId
            ? [pending]
            : mutation && !mutation.empty
              ? [{ ...pending, id: mutation.operationId, mutation }]
              : [],
        );
        let projected = latest;
        for (const pending of remaining) {
          try {
            const overlay = await encryptedWorkspaceRepository.resolveMutation(
              pending.mutation,
              projected,
              cryptoSession,
            );
            if (!overlay.empty)
              projected = encryptedWorkspaceRepository.optimisticWorkspace(projected, overlay, cryptoSession);
          } catch (caught) {
            await deviceRecoveryStore.markMutationConflict(user.id, pending.id, caught.message);
          }
        }
        await deviceRecoveryStore.replaceMutation(user.id, operationId, mutation, projected);
        mutationGenerationRef.current += 1;
        applyWorkspace(projected, { allowOlder: true, notify: true });
        setPendingOperations(await deviceRecoveryStore.listMutations(user.id));
      } finally {
        resolvingRef.current = false;
      }
      return flushPending();
    },
    [applyWorkspace, captureDeviceCopy, cryptoSession, flushPending, user.id],
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
      listenersRef.current.add(onChange);
      let disposed = false;
      let cleanup;
      encryptedWorkspaceRepository
        .subscribe(
          cryptoSession,
          async (incoming) => {
            if (disposed || ["pending", "conflict", "error"].includes(syncStatusRef.current)) return;
            if (applyWorkspace(incoming, { notify: true })) {
              await deviceRecoveryStore.cacheWorkspace(user.id, incoming);
              await writeWitness(incoming);
            }
          },
          {
            userId: user.id,
            onStatus: (status) => {
              if (["SUBSCRIBED", "SYNCED"].includes(status)) {
                if (syncStatusRef.current === "pending") void flushPending();
                else if (!["conflict", "error"].includes(syncStatusRef.current)) updateSync("saved");
              }
              if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
                if (["pending", "conflict", "error"].includes(syncStatusRef.current)) return;
                updateSync("reconnecting", "Encrypted live updates are retrying automatically.");
              }
            },
            onError: (caught) => {
              if (["pending", "conflict", "error"].includes(syncStatusRef.current)) return;
              const failure = encryptedSyncFailure(caught);
              updateSync(failure.status, failure.message);
            },
          },
        )
        .then((unsubscribe) => {
          if (disposed) void unsubscribe();
          else cleanup = unsubscribe;
        })
        .catch(() => updateSync("reconnecting", "Encrypted live updates are retrying automatically."));
      return () => {
        listenersRef.current.delete(onChange);
        disposed = true;
        if (cleanup) void cleanup();
      };
    },
    [applyWorkspace, cryptoSession, flushPending, updateSync, user.id, writeWitness],
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
            pendingOperations,
            resolvePendingOperation,
            retrySync: flushPending,
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
      pendingOperations,
      resolvePendingOperation,
      flushPending,
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

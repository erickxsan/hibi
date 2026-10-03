import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createStarterState } from "../domain/index.js";
import { deviceKeyStore, unlockWithPassword, wipeBytes } from "../crypto/index.js";
import { deviceRecoveryStore } from "./deviceRecoveryStore.js";
import { encryptedWorkspaceRepository } from "./encryptedWorkspaceRepository.js";
import { statusForOutbox } from "./workspaceOutbox.js";
import { encryptedSyncFailure } from "./encryptedSyncErrors.js";
import { describeOperation, operationEntityKeys } from "./workspaceMerge.js";
import { createOperationId, WorkspaceConflictError } from "./workspaceRepository.js";

const SUBSCRIBE_RETRY_INITIAL_MS = 2_000;
const SUBSCRIBE_RETRY_MAX_MS = 30_000;

// Queue entries as presented: only an operation whose own values contradict
// the cloud needs review. Later edits of the same records wait for that decision.
function presentQueue(entries, cloudState) {
  const held = new Set();
  return entries.map((entry) => {
    const keys = operationEntityKeys(entry.mutation);
    const conflict = entry.status === "conflict";
    const blocked = !conflict && keys.some((key) => held.has(key));
    if (conflict || blocked) keys.forEach((key) => held.add(key));
    return {
      ...entry,
      blocked,
      review: conflict ? describeOperation(entry.mutation, cloudState) : null,
    };
  });
}

// Edits rejected before they reach the durable queue do not change sync health.
function rejectedBeforeQueue(error) {
  return (
    error instanceof WorkspaceConflictError ||
    error?.code === "mutation_too_large" ||
    error?.name === "DomainValidationError"
  );
}

export function useEncryptedWorkspace(user, cryptoSession, security) {
  const [workspace, setWorkspace] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [persistenceStatus, setSyncStatus] = useState("reconnecting");
  const [persistenceMessage, setSyncMessage] = useState("");
  const [connectionStatus, setConnectionStatus] = useState("connecting");
  const [pendingOperations, setPendingOperations] = useState([]);
  const resolvingRef = useRef(false);
  const replacingRef = useRef(false);
  const listenersRef = useRef(new Set());
  // Tail of the serialized local writes: saves, projections and resolutions.
  const savePromiseRef = useRef(Promise.resolve());
  const retryTimerRef = useRef(null);
  const retryDelayRef = useRef(2000);
  // What the interface shows: the confirmed cloud records plus queued edits.
  const workspaceRef = useRef(null);
  // The newest verified cloud workspace, kept separately from the projection so
  // remote revisions received during a save or a conflict are never dropped.
  const confirmedRef = useRef(null);
  const publishedConfirmedRef = useRef(null);
  const syncStatusRef = useRef("reconnecting");
  const syncMessageRef = useRef("");
  const flushPromiseRef = useRef(null);
  const forceFlushLoadRef = useRef(false);
  const mutationGenerationRef = useRef(0);
  const rerunFlushRef = useRef(false);
  const clearingDeviceRef = useRef(false);
  const storageWritesRef = useRef(new Set());
  const subscriptionRestartsRef = useRef(new Set());
  const writeDevice = useCallback((operation) => {
    if (clearingDeviceRef.current) return Promise.resolve(null);
    const task = Promise.resolve().then(operation);
    storageWritesRef.current.add(task);
    const remove = () => storageWritesRef.current.delete(task);
    task.then(remove, remove);
    return task;
  }, []);
  const cacheWorkspace = useCallback(
    (incoming) => writeDevice(() => deviceRecoveryStore.cacheWorkspace(user.id, incoming)),
    [user.id, writeDevice],
  );
  // Channel health cannot acknowledge a durable write or clear an integrity failure.
  const syncStatus = ["error", "conflict", "pending"].includes(persistenceStatus)
    ? persistenceStatus
    : pendingOperations.length
      ? statusForOutbox(pendingOperations)
      : connectionStatus === "reconnecting"
        ? "reconnecting"
        : persistenceStatus;
  const syncMessage =
    syncStatus === "reconnecting" ? "Encrypted live updates are retrying automatically." : persistenceMessage;

  const updateSync = useCallback((status, message = "") => {
    syncStatusRef.current = status;
    syncMessageRef.current = message;
    setSyncStatus(status);
    setSyncMessage(message);
  }, []);

  const serialize = useCallback(
    /**
     * @template T
     * @param {() => T | Promise<T>} task
     * @returns {Promise<T>}
     */
    (task) => {
      const run = savePromiseRef.current.then(task);
      savePromiseRef.current = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
    [],
  );

  // Keep the newest verified revision. Returns whether it advanced.
  const acceptConfirmed = useCallback((incoming) => {
    if (!incoming?.manifest) return false;
    const current = confirmedRef.current;
    if (current && current.workspaceCryptoId === incoming.workspaceCryptoId && incoming.revision <= current.revision)
      return false;
    confirmedRef.current = incoming;
    return true;
  }, []);

  const writeWitness = useCallback(
    (verifiedWorkspace) =>
      writeDevice(() =>
        deviceKeyStore
          .writeIntegrity({
            ownerId: user.id,
            workspaceCryptoId: cryptoSession.workspaceCryptoId,
            revision: verifiedWorkspace.revision,
            root: verifiedWorkspace.manifest.root,
          })
          .catch(() => false),
      ),
    [cryptoSession.workspaceCryptoId, user.id, writeDevice],
  );

  const captureDeviceCopy = useCallback(
    async (state, revision, source, updatedAt = null) => {
      try {
        return await writeDevice(() =>
          deviceRecoveryStore.capture({ ownerId: user.id, state, revision, source, updatedAt }),
        );
      } catch {
        return null;
      }
    },
    [user.id, writeDevice],
  );

  // Every accepted snapshot is published through this adapter, including loads and flushes.
  const applyWorkspace = useCallback((incoming, { allowOlder = false, notify = true, source = "remote" } = {}) => {
    if (!incoming || (!allowOlder && workspaceRef.current && incoming.revision <= workspaceRef.current.revision))
      return false;
    workspaceRef.current = incoming;
    setWorkspace(incoming);
    if (notify) for (const listener of listenersRef.current) listener(incoming.state, { source });
    return true;
  }, []);

  // Publishes the newest verified revision with the durable queue layered on
  // top. Run through serialize() so a concurrent save is never hidden.
  const publishLatest = useCallback(
    async ({ source = "remote" } = {}) => {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const confirmed = confirmedRef.current;
        if (!confirmed || clearingDeviceRef.current) return null;
        const queued = await deviceRecoveryStore.listMutations(user.id);
        const projection = queued.length
          ? await encryptedWorkspaceRepository.projectPendingWorkspace(confirmed, queued, cryptoSession)
          : { workspace: confirmed, entries: [] };
        // A newer verified revision arrived while projecting: rebuild on it.
        if (confirmedRef.current !== confirmed) continue;
        if (clearingDeviceRef.current) return null;
        publishedConfirmedRef.current = confirmed;
        applyWorkspace(projection.workspace, { allowOlder: true, notify: true, source });
        setPendingOperations(presentQueue(projection.entries, confirmed.state));
        await cacheWorkspace(projection.workspace);
        await writeWitness(confirmed);
        if (confirmedRef.current === confirmed) return projection;
      }
      return null;
    },
    [applyWorkspace, cacheWorkspace, cryptoSession, user.id, writeWitness],
  );

  // A revision received while a flush or resolution was running is published
  // as soon as it finishes; repository polls will not deliver it again.
  const publishIfBehind = useCallback(() => {
    if (clearingDeviceRef.current || syncStatusRef.current === "error") return;
    if (!confirmedRef.current || confirmedRef.current === publishedConfirmedRef.current) return;
    void serialize(() => publishLatest({ source: "remote" })).catch(() => {});
  }, [publishLatest, serialize]);

  const flushPending = useCallback(
    ({ onlyIfQueued = false } = {}) => {
      if (clearingDeviceRef.current) return Promise.resolve({ status: "paused" });
      if (resolvingRef.current) return Promise.resolve({ status: "pending" });
      if (flushPromiseRef.current) {
        if (!onlyIfQueued) forceFlushLoadRef.current = true;
        return flushPromiseRef.current;
      }
      forceFlushLoadRef.current = !onlyIfQueued;
      globalThis.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
      const generation = mutationGenerationRef.current;
      const previousStatus = syncStatusRef.current;
      if (!["conflict", "error"].includes(syncStatusRef.current)) {
        updateSync("pending", "Verifying encrypted changes and pending operations.");
      }
      const task = (async () => {
        await savePromiseRef.current;
        const queued = await deviceRecoveryStore.listMutations(user.id);
        setPendingOperations(presentQueue(queued, confirmedRef.current?.state));
        const forced = forceFlushLoadRef.current;
        // A failed live integrity check can arrive while IndexedDB is pending.
        // A healthy heartbeat must not clear that newer terminal state.
        if (!forced && syncStatusRef.current === "error") return { status: "error" };
        // Heartbeats send independent work but do not re-ask the server about
        // operations that already need a decision (an explicit retry does).
        if (!forced && syncStatusRef.current === "conflict") {
          const held = new Set();
          const sendable = queued.filter((entry) => {
            const keys = operationEntityKeys(entry.mutation);
            const hold = entry.status === "conflict" || keys.some((key) => held.has(key));
            if (hold) keys.forEach((key) => held.add(key));
            return !hold;
          });
          if (!sendable.length) return { status: "conflict" };
        }
        // Healthy channel heartbeats are not a reason to download every record.
        // Still inspect the durable outbox: another tab may have queued a write.
        if (!forced && !queued.length && previousStatus === "saved" && generation === mutationGenerationRef.current) {
          updateSync("saved");
          return { status: "saved" };
        }
        if (!["conflict", "error"].includes(syncStatusRef.current)) {
          updateSync("pending", "Verifying encrypted changes and pending operations.");
        }
        const witness = await deviceKeyStore
          .readIntegrity({ ownerId: user.id, workspaceCryptoId: cryptoSession.workspaceCryptoId })
          .catch(() => null);
        acceptConfirmed(await encryptedWorkspaceRepository.loadWorkspace(cryptoSession, user.id, witness || {}));
        const held = new Set();
        for (const entry of queued) {
          const keys = operationEntityKeys(entry.mutation);
          // Retry previously flagged operations on an explicit retry through the
          // same receipt checks: a lost acknowledgement can look like a conflict.
          if (keys.some((key) => held.has(key)) || (!forced && entry.status === "conflict")) {
            keys.forEach((key) => held.add(key));
            continue;
          }
          try {
            const applied = await encryptedWorkspaceRepository.applyMutation(entry.mutation, cryptoSession, user.id);
            acceptConfirmed(applied);
            await deviceRecoveryStore.completeMutation(user.id, entry.id);
            if (applied?.manifest) await writeWitness(applied);
          } catch (caught) {
            if (caught instanceof WorkspaceConflictError || caught?.latestState) {
              await deviceRecoveryStore.markMutationConflict(user.id, entry.id, caught.message);
              keys.forEach((key) => held.add(key));
              continue;
            }
            throw caught;
          }
        }
        // Publish the newest verified revision (including remote revisions
        // received meanwhile) with every remaining edit layered on top.
        const projection = await serialize(() => publishLatest({ source: "remote" }));
        const remaining = projection?.entries ?? (await deviceRecoveryStore.listMutations(user.id));
        if (remaining.some((entry) => entry.status === "conflict")) {
          updateSync("conflict", "Review pending operations. Changes to other records can still sync.");
          return { status: "conflict" };
        }
        if (remaining.length || generation !== mutationGenerationRef.current) {
          rerunFlushRef.current = true;
          updateSync("pending", "Encrypted changes are safe on this device and waiting to sync.");
          return { status: "pending" };
        }
        const latest = confirmedRef.current;
        if (latest) void captureDeviceCopy(latest.state, latest.revision, "encrypted-cloud-sync", latest.updatedAt);
        setError(null);
        retryDelayRef.current = 2000;
        updateSync("saved");
        return { status: "saved", workspace: latest };
      })()
        .catch(async (caught) => {
          const queued = await deviceRecoveryStore.listMutations(user.id).catch(() => []);
          setPendingOperations(presentQueue(queued, confirmedRef.current?.state));
          const failure = encryptedSyncFailure(caught);
          updateSync(failure.status, failure.message);
          if (!clearingDeviceRef.current && failure.status === "pending" && !retryTimerRef.current) {
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
          publishIfBehind();
          if (!clearingDeviceRef.current && rerunFlushRef.current) {
            rerunFlushRef.current = false;
            globalThis.setTimeout?.(() => void flushPending(), 0);
          }
        });
      flushPromiseRef.current = task;
      return task;
    },
    [
      acceptConfirmed,
      captureDeviceCopy,
      cryptoSession,
      publishIfBehind,
      publishLatest,
      serialize,
      updateSync,
      user.id,
      writeWitness,
    ],
  );

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
      setPendingOperations(presentQueue(queued, null));
      if (!active) return;
      if (localWorkspace?.workspaceCryptoId === cryptoSession.workspaceCryptoId) {
        applyWorkspace(localWorkspace, { allowOlder: true });
        updateSync(
          queued.length ? statusForOutbox(queued) : "reconnecting",
          queued.length ? "Encrypted changes are waiting to sync." : "",
        );
        setLoading(false);
      }
      try {
        const generation = mutationGenerationRef.current;
        const loaded = await encryptedWorkspaceRepository.loadWorkspace(cryptoSession, user.id, witness || {});
        if (!active) return;
        acceptConfirmed(loaded);
        if (queued.length || generation !== mutationGenerationRef.current) {
          void flushPending();
        } else {
          publishedConfirmedRef.current = confirmedRef.current;
          applyWorkspace(confirmedRef.current, { allowOlder: true });
          await cacheWorkspace(confirmedRef.current);
          await writeWitness(confirmedRef.current);
          void captureDeviceCopy(loaded.state, loaded.revision, "encrypted-cloud-load", loaded.updatedAt);
          if (generation !== mutationGenerationRef.current) void flushPending();
          else updateSync("saved");
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
  }, [
    acceptConfirmed,
    applyWorkspace,
    cacheWorkspace,
    captureDeviceCopy,
    cryptoSession,
    flushPending,
    reloadToken,
    updateSync,
    user.id,
    writeWitness,
  ]);

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
      if (clearingDeviceRef.current) return Promise.reject(new Error("This device is being locked."));
      if (resolvingRef.current)
        return Promise.reject(new Error("Finish resolving the pending operation before editing."));
      mutationGenerationRef.current += 1;
      const before = { status: syncStatusRef.current, message: syncMessageRef.current };
      const savingMessage = "Encrypted changes are being saved on this device.";
      updateSync("pending", savingMessage);
      const restoreStatus = () => {
        if (syncStatusRef.current === "pending" && syncMessageRef.current === savingMessage)
          updateSync(before.status, before.message);
      };
      const task = serialize(async () => {
        const current = workspaceRef.current;
        if (!current) throw new Error("The encrypted workspace is not ready.");
        const mutation = await encryptedWorkspaceRepository.prepareMutation({
          state,
          previousState: previousState || current.state,
          workspace: current,
          session: cryptoSession,
          operationId: createOperationId(),
        });
        if (mutation.empty) {
          restoreStatus();
          return { state: current.state, pending: syncStatusRef.current !== "saved" };
        }
        const optimistic = encryptedWorkspaceRepository.optimisticWorkspace(current, mutation, cryptoSession);
        await deviceRecoveryStore.stageMutation({ ownerId: user.id, workspace: optimistic, mutation });
        // The caller receives its own optimistic edit; subscribers receive confirmed snapshots.
        applyWorkspace(optimistic, { notify: false });
        updateSync("pending", "Encrypted changes are safe on this device and waiting to sync.");
        globalThis.setTimeout?.(() => void flushPending(), 0);
        return { state: optimistic.state, pending: true };
      });
      task.catch((caught) => {
        // An edit of an outdated view is retried by the caller on the newest
        // records; a change over the server limits is refused before queueing.
        if (rejectedBeforeQueue(caught)) {
          restoreStatus();
          return;
        }
        const failure = encryptedSyncFailure(caught);
        updateSync(failure.status, failure.message);
      });
      return task;
    },
    [applyWorkspace, cryptoSession, flushPending, serialize, updateSync, user.id],
  );

  const resolvePendingOperation = useCallback(
    async (operationId, choice) => {
      if (clearingDeviceRef.current) throw new Error("This device is being locked.");
      if (!["local", "discard"].includes(choice)) throw new Error("Choose keep local or discard.");
      if (resolvingRef.current) throw new Error("An operation is already being resolved.");
      resolvingRef.current = true;
      try {
        await savePromiseRef.current;
        await flushPromiseRef.current;
        await serialize(async () => {
          const queued = await deviceRecoveryStore.listMutations(user.id);
          const entry = queued.find((item) => item.id === operationId);
          if (!entry) throw new Error("This pending operation no longer exists.");
          const witness = await deviceKeyStore.readIntegrity({
            ownerId: user.id,
            workspaceCryptoId: cryptoSession.workspaceCryptoId,
          });
          acceptConfirmed(await encryptedWorkspaceRepository.loadWorkspace(cryptoSession, user.id, witness || {}));
          const latest = confirmedRef.current;
          await captureDeviceCopy(
            workspaceRef.current.state,
            workspaceRef.current.revision,
            "before-conflict-resolution",
          );
          const resolved =
            choice === "local"
              ? await encryptedWorkspaceRepository.resolveMutation(entry.mutation, latest, cryptoSession)
              : null;
          const ordered = queued.flatMap((item) =>
            item.id !== operationId
              ? [item]
              : resolved && !resolved.empty
                ? [{ ...item, id: resolved.operationId, mutation: resolved, status: "pending", replaces: item.id }]
                : [],
          );
          // Rebuild every later operation on the new base with only the fields
          // it changed, then persist the queue and the projection atomically.
          const projection = await encryptedWorkspaceRepository.projectPendingWorkspace(latest, ordered, cryptoSession);
          const remove = resolved && !resolved.empty ? [] : [operationId];
          const put = [];
          projection.entries.forEach((item, index) => {
            const original = ordered[index];
            const replaces = original.replaces ?? original.id;
            if (item.satisfied) remove.push(replaces);
            else if (original.replaces || (!item.needsReview && item.mutation !== original.mutation))
              put.push({ replaces, mutation: item.mutation, workspace: item.workspace, status: "pending" });
          });
          await deviceRecoveryStore.rewriteMutations(user.id, { remove, put }, projection.workspace);
          mutationGenerationRef.current += 1;
          publishedConfirmedRef.current = latest;
          applyWorkspace(projection.workspace, { allowOlder: true, notify: true, source: "local" });
          setPendingOperations(presentQueue(await deviceRecoveryStore.listMutations(user.id), latest.state));
        });
      } finally {
        resolvingRef.current = false;
      }
      return flushPending();
    },
    [acceptConfirmed, applyWorkspace, captureDeviceCopy, cryptoSession, flushPending, serialize, user.id],
  );

  const requireEmptyOutbox = useCallback(async () => {
    if (clearingDeviceRef.current) throw new Error("This device is being locked.");
    const queued = await deviceRecoveryStore.listMutations(user.id);
    if (queued.length) throw new Error("Reconnect and finish syncing encrypted changes before this operation.");
  }, [user.id]);

  const replace = useCallback(
    async (state, reason = "replace", importMetadata = null, returnWorkspace = false) => {
      await requireEmptyOutbox();
      if (clearingDeviceRef.current) throw new Error("This device is being locked.");
      if (replacingRef.current || resolvingRef.current)
        throw new Error("Finish the current operation before replacing records.");
      replacingRef.current = true;
      try {
        const previous = workspaceRef.current;
        if (previous)
          await captureDeviceCopy(previous.state, previous.revision, `before-${reason}`, previous.updatedAt);
        const replaced = await encryptedWorkspaceRepository.replaceWorkspace(
          state,
          cryptoSession,
          user.id,
          reason,
          importMetadata,
        );
        acceptConfirmed(replaced);
        publishedConfirmedRef.current = replaced;
        applyWorkspace(replaced, { allowOlder: true, source: "local" });
        await cacheWorkspace(replaced);
        await writeWitness(replaced);
        updateSync("saved");
        return returnWorkspace ? replaced : replaced.state;
      } finally {
        replacingRef.current = false;
      }
    },
    [
      acceptConfirmed,
      applyWorkspace,
      cacheWorkspace,
      captureDeviceCopy,
      cryptoSession,
      requireEmptyOutbox,
      updateSync,
      user.id,
      writeWitness,
    ],
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
      if (workspaceRef.current) onChange(workspaceRef.current.state, { source: "initial" });
      let disposed = false;
      let cleanup = null;
      let starting = false;
      let retryTimer = null;
      let retryDelay = SUBSCRIBE_RETRY_INITIAL_MS;
      const receive = async (incoming) => {
        // Integrity failures pause synchronization; nothing else freezes remote data.
        if (disposed || clearingDeviceRef.current || syncStatusRef.current === "error") return;
        if (!acceptConfirmed(incoming)) return;
        // A running flush or resolution publishes the newest revision when it ends.
        if (flushPromiseRef.current || resolvingRef.current) return;
        await serialize(() => publishLatest({ source: "remote" }));
      };
      const start = () => {
        if (disposed || cleanup || starting) return;
        starting = true;
        globalThis.clearTimeout(retryTimer);
        retryTimer = null;
        encryptedWorkspaceRepository
          .subscribe(cryptoSession, receive, {
            userId: user.id,
            onStatus: (status) => {
              if (disposed) return;
              if (["SUBSCRIBED", "SYNCED"].includes(status)) {
                setConnectionStatus("connected");
                // Only a verified load and empty outbox may acknowledge persistence.
                if (syncStatusRef.current !== "error") void flushPending({ onlyIfQueued: true });
              }
              if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
                setConnectionStatus("reconnecting");
              }
            },
            onError: (caught) => {
              if (disposed) return;
              const failure = encryptedSyncFailure(caught);
              if (failure.status === "pending") {
                setConnectionStatus("reconnecting");
                return;
              }
              updateSync(failure.status, failure.message);
            },
          })
          .then((unsubscribe) => {
            starting = false;
            if (disposed) void unsubscribe();
            else {
              cleanup = unsubscribe;
              retryDelay = SUBSCRIBE_RETRY_INITIAL_MS;
            }
          })
          .catch(() => {
            starting = false;
            if (disposed) return;
            // The live channel was never installed. Retry its creation instead of
            // waiting for a reload; online events and explicit retries skip the wait.
            setConnectionStatus("reconnecting");
            retryTimer = globalThis.setTimeout(start, retryDelay);
            retryDelay = Math.min(retryDelay * 2, SUBSCRIBE_RETRY_MAX_MS);
          });
      };
      subscriptionRestartsRef.current.add(start);
      globalThis.addEventListener?.("online", start);
      start();
      return () => {
        listenersRef.current.delete(onChange);
        subscriptionRestartsRef.current.delete(start);
        globalThis.removeEventListener?.("online", start);
        globalThis.clearTimeout(retryTimer);
        disposed = true;
        if (cleanup) void cleanup();
      };
    },
    [acceptConfirmed, cryptoSession, flushPending, publishLatest, serialize, updateSync, user.id],
  );

  const retrySync = useCallback(() => {
    for (const restart of subscriptionRestartsRef.current) restart();
    return flushPending();
  }, [flushPending]);

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
      const sourceVersion = backup.encryptedSnapshot?.keyVersion || backup.snapshot?.manifest?.keyVersion || 1;
      const wrapper = (backup.wrappers || []).find(
        (candidate) =>
          candidate.type === "password" && !candidate.revokedAt && (candidate.keyVersion || 1) === sourceVersion,
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

  const clearLocalCopies = useCallback(async () => {
    if (clearingDeviceRef.current || resolvingRef.current || replacingRef.current)
      throw new Error("Finish the current operation before clearing local copies.");
    clearingDeviceRef.current = true;
    globalThis.clearTimeout(retryTimerRef.current);
    retryTimerRef.current = null;
    try {
      await savePromiseRef.current;
      await flushPromiseRef.current;
      await Promise.allSettled([...storageWritesRef.current]);
      await security.clearLocalCopies();
    } catch (caught) {
      clearingDeviceRef.current = false;
      throw caught;
    }
  }, [security]);

  const persistence = useMemo(
    () =>
      workspace
        ? {
            mode: "cloud",
            encrypted: true,
            encryption: { ...security, clearLocalCopies },
            uiStorageKey: `minimal-class-manager:ui:v1:${user.id}`,
            initialState: workspace.state,
            syncStatus,
            syncMessage,
            connectionStatus,
            pendingOperations,
            resolvePendingOperation,
            retrySync,
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
      connectionStatus,
      pendingOperations,
      resolvePendingOperation,
      retrySync,
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
      clearLocalCopies,
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
    connectionStatus,
  };
}

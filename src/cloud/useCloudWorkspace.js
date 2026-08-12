import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { advanceWorkspaceVersions } from "./normalizedWorkspace";
import { deviceRecoveryStore } from "./deviceRecoveryStore";
import { createOperationId, WorkspaceConflictError, workspaceRepository } from "./workspaceRepository";
import { flushWorkspaceOutbox, statusForOutbox } from "./workspaceOutbox";

export function useCloudWorkspace(user) {
  const [workspace, setWorkspace] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [syncStatus, setSyncStatus] = useState("saved");
  const [syncMessage, setSyncMessage] = useState("");
  const revisionRef = useRef(0);
  const workspaceRef = useRef(null);
  const syncStatusRef = useRef("saved");
  const flushPromiseRef = useRef(null);
  const localMutationGenerationRef = useRef(0);
  const rerunFlushRef = useRef(false);

  const updateSync = useCallback((status, message = "") => {
    syncStatusRef.current = status;
    setSyncStatus(status);
    setSyncMessage(message);
  }, []);

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

  const applyWorkspace = useCallback((incoming) => {
    if (!incoming || incoming.revision < revisionRef.current) return false;
    revisionRef.current = incoming.revision;
    workspaceRef.current = incoming;
    setWorkspace(incoming);
    return true;
  }, []);

  const preserveLocalRevision = useCallback((revision) => {
    if (!workspaceRef.current || revision <= revisionRef.current) return;
    const local = { ...workspaceRef.current, revision };
    revisionRef.current = revision;
    workspaceRef.current = local;
    setWorkspace(local);
  }, []);

  const flushPending = useCallback(() => {
    if (flushPromiseRef.current) return flushPromiseRef.current;
    const startedAtGeneration = localMutationGenerationRef.current;
    const task = (async () => {
      const entries = await deviceRecoveryStore.listMutations(user.id);
      const initialStatus = statusForOutbox(entries);
      if (initialStatus === "conflict") {
        updateSync("conflict", "A cloud conflict needs review. Your local version is preserved in Recovery history.");
        return { status: "conflict" };
      }
      if (entries.length) updateSync("pending", "Changes are safe on this device and waiting to sync.");
      const result = await flushWorkspaceOutbox({
        ownerId: user.id,
        store: deviceRecoveryStore,
        repository: workspaceRepository,
      });
      if (result.status === "conflict") {
        preserveLocalRevision(result.conflict?.error?.latestRevision ?? 0);
        updateSync(
          "conflict",
          "Another device changed the same record. Your local version is preserved in Recovery history.",
        );
        return result;
      }
      const remaining = await deviceRecoveryStore.listMutations(user.id);
      if (remaining.length || localMutationGenerationRef.current !== startedAtGeneration) {
        rerunFlushRef.current = true;
        updateSync("pending", "Changes are safe on this device and waiting to sync.");
        return { ...result, status: "pending" };
      }
      if (result.workspace) {
        applyWorkspace(result.workspace);
        void captureDeviceCopy(
          result.workspace.state,
          result.workspace.revision,
          "cloud-sync",
          result.workspace.updatedAt,
        );
      }
      setError(null);
      updateSync("saved");
      return result;
    })()
      .catch(async (caught) => {
        const entries = await deviceRecoveryStore.listMutations(user.id).catch(() => []);
        updateSync(
          entries.length ? "pending" : "offline",
          entries.length
            ? "Changes are safe on this device and will retry automatically."
            : "Using the encrypted copy saved on this device.",
        );
        return { status: entries.length ? "pending" : "offline", error: caught };
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
  }, [applyWorkspace, captureDeviceCopy, preserveLocalRevision, updateSync, user.id]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    (async () => {
      const [cached, queued] = await Promise.all([
        deviceRecoveryStore.loadWorkspaceCache(user.id).catch(() => null),
        deviceRecoveryStore.listMutations(user.id).catch(() => []),
      ]);
      const localWorkspace = cached || queued.at(-1)?.workspace || null;
      if (!active) return;
      if (localWorkspace) {
        applyWorkspace(localWorkspace);
        updateSync(
          statusForOutbox(queued),
          queued.length ? "Changes are safe on this device and waiting to sync." : "",
        );
        setLoading(false);
      }

      try {
        const loaded = await workspaceRepository.loadOrCreateWorkspace(user.id);
        if (!active) return;
        if (queued.length) {
          void flushPending();
        } else {
          applyWorkspace(loaded);
          await deviceRecoveryStore.cacheWorkspace(user.id, loaded);
          void captureDeviceCopy(loaded.state, loaded.revision, "cloud-load", loaded.updatedAt);
          updateSync("saved");
        }
      } catch (caught) {
        if (!active) return;
        if (localWorkspace) {
          updateSync(
            queued.length ? "pending" : "offline",
            queued.length
              ? "Changes are safe on this device and will retry automatically."
              : "Cloud is unavailable. Using the encrypted copy saved on this device.",
          );
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
  }, [applyWorkspace, captureDeviceCopy, flushPending, reloadToken, updateSync, user.id]);

  useEffect(() => {
    const reconnect = () => void flushPending();
    globalThis.addEventListener?.("online", reconnect);
    return () => globalThis.removeEventListener?.("online", reconnect);
  }, [flushPending]);

  const save = useCallback(
    async (state, previousState) => {
      const current = workspaceRef.current;
      if (!current?.state) throw new Error("The cloud workspace is not ready.");
      const mutation = workspaceRepository.prepareWorkspaceMutation(
        state,
        previousState || current.state,
        current.versions,
        createOperationId(),
      );
      if (mutation.empty) return { state: current.state, pending: false };
      const optimistic = {
        ...current,
        state: mutation.state,
        versions: advanceWorkspaceVersions(current.versions, mutation.patch),
      };
      await deviceRecoveryStore.stageMutation({ ownerId: user.id, workspace: optimistic, mutation });
      localMutationGenerationRef.current += 1;
      applyWorkspace(optimistic);
      updateSync("pending", "Changes are safe on this device and waiting to sync.");
      globalThis.setTimeout?.(() => void flushPending(), 0);
      return { state: optimistic.state, pending: true };
    },
    [applyWorkspace, flushPending, updateSync, user.id],
  );

  const replace = useCallback(
    async (state) => {
      const previous = workspaceRef.current;
      if (previous?.state)
        await captureDeviceCopy(previous.state, previous.revision, "before-replace", previous.updatedAt);
      try {
        const replaced = await workspaceRepository.replaceWorkspace(state, revisionRef.current, user.id);
        applyWorkspace(replaced);
        await deviceRecoveryStore.clearMutations(user.id);
        await deviceRecoveryStore.cacheWorkspace(user.id, replaced);
        void captureDeviceCopy(replaced.state, replaced.revision, "cloud-replace", replaced.updatedAt);
        setError(null);
        updateSync("saved");
        return workspaceRef.current?.state ?? replaced.state;
      } catch (caught) {
        if (caught instanceof WorkspaceConflictError) {
          applyWorkspace({
            state: caught.latestState,
            versions: {},
            revision: caught.latestRevision,
            updatedAt: caught.latestUpdatedAt,
          });
        }
        throw caught;
      }
    },
    [applyWorkspace, captureDeviceCopy, updateSync, user.id],
  );

  const importRecords = useCallback(
    async (state, metadata) => {
      const previous = workspaceRef.current;
      if (previous?.state)
        await captureDeviceCopy(previous.state, previous.revision, "before-import", previous.updatedAt);
      try {
        const imported = await workspaceRepository.applyWorkspaceImport(state, revisionRef.current, user.id, metadata);
        applyWorkspace(imported);
        await deviceRecoveryStore.clearMutations(user.id);
        await deviceRecoveryStore.cacheWorkspace(user.id, imported);
        if (!imported.alreadyImported)
          void captureDeviceCopy(imported.state, imported.revision, "cloud-import", imported.updatedAt);
        setError(null);
        updateSync("saved");
        return imported;
      } catch (caught) {
        if (caught instanceof WorkspaceConflictError) {
          applyWorkspace({
            state: caught.latestState,
            versions: {},
            revision: caught.latestRevision,
            updatedAt: caught.latestUpdatedAt,
          });
        }
        throw caught;
      }
    },
    [applyWorkspace, captureDeviceCopy, updateSync, user.id],
  );

  const findImportJob = useCallback((fileHash) => workspaceRepository.findImportJob(fileHash, user.id), [user.id]);

  const listRecoveryPoints = useCallback(async () => {
    const [cloudPoints, devicePoints] = await Promise.all([
      workspaceRepository.listRecoverySnapshots(user.id).catch(() => []),
      deviceRecoveryStore.list(user.id).catch(() => []),
    ]);
    return [...cloudPoints, ...devicePoints].sort((left, right) =>
      String(right.capturedAt).localeCompare(String(left.capturedAt)),
    );
  }, [user.id]);

  const loadRecoveryPoint = useCallback(
    async (point) => {
      if (point?.source === "cloud-snapshot") return workspaceRepository.loadRecoverySnapshot(point.id, user.id);
      return deviceRecoveryStore.load(user.id, point?.id);
    },
    [user.id],
  );

  const restoreRecoveryPoint = useCallback(
    async (point) => {
      await captureDeviceCopy(
        workspaceRef.current?.state,
        revisionRef.current,
        "before-restore",
        workspaceRef.current?.updatedAt,
      );
      try {
        const recovered =
          point?.source === "cloud-snapshot"
            ? await workspaceRepository.restoreRecoverySnapshot(point.id, revisionRef.current, user.id)
            : await (async () => {
                const copy = await deviceRecoveryStore.load(user.id, point?.id);
                if (!copy) throw new Error("That device recovery copy is no longer available.");
                return workspaceRepository.replaceWorkspace(copy.state, revisionRef.current, user.id);
              })();
        applyWorkspace(recovered);
        await deviceRecoveryStore.clearMutations(user.id);
        await deviceRecoveryStore.cacheWorkspace(user.id, recovered);
        void captureDeviceCopy(recovered.state, recovered.revision, "cloud-restore", recovered.updatedAt);
        setError(null);
        updateSync("saved");
        return workspaceRef.current?.state ?? recovered.state;
      } catch (caught) {
        if (caught instanceof WorkspaceConflictError) {
          preserveLocalRevision(caught.latestRevision);
          updateSync("conflict", "The cloud changed before recovery. Your local version remains preserved.");
        }
        throw caught;
      }
    },
    [applyWorkspace, captureDeviceCopy, preserveLocalRevision, updateSync, user.id],
  );

  const subscribe = useCallback(
    (onChange) => {
      let disposed = false;
      let cleanup = null;
      workspaceRepository
        .subscribeToWorkspace(
          (incoming) => {
            if (disposed) return;
            if (["pending", "conflict"].includes(syncStatusRef.current)) {
              if (syncStatusRef.current === "pending") void flushPending();
              return;
            }
            if (incoming.revision <= revisionRef.current) return;
            if (applyWorkspace(incoming)) {
              void deviceRecoveryStore.cacheWorkspace(user.id, incoming);
              void captureDeviceCopy(incoming.state, incoming.revision, "cloud-realtime", incoming.updatedAt);
              onChange(incoming.state);
            }
          },
          {
            userId: user.id,
            onStatus: (status) => {
              if (disposed) return;
              if (status === "SUBSCRIBED") {
                if (["pending", "offline"].includes(syncStatusRef.current)) void flushPending();
                else updateSync("saved");
              }
              if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
                updateSync(
                  syncStatusRef.current === "pending" ? "pending" : "offline",
                  "Live updates are disconnected; local records remain available.",
                );
              }
            },
            onError: () => {
              if (!disposed)
                updateSync(
                  syncStatusRef.current === "pending" ? "pending" : "offline",
                  "Live updates are disconnected; local records remain available.",
                );
            },
          },
        )
        .then((unsubscribe) => {
          if (disposed) void Promise.resolve(unsubscribe()).catch(() => {});
          else cleanup = unsubscribe;
        })
        .catch(() => {
          if (!disposed)
            updateSync(
              syncStatusRef.current === "pending" ? "pending" : "offline",
              "Live updates are disconnected; local records remain available.",
            );
        });

      return () => {
        disposed = true;
        if (cleanup) void Promise.resolve(cleanup()).catch(() => {});
      };
    },
    [applyWorkspace, captureDeviceCopy, flushPending, updateSync, user.id],
  );

  const persistence = useMemo(
    () =>
      workspace
        ? {
            mode: "cloud",
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
          }
        : null,
    [
      findImportJob,
      importRecords,
      listRecoveryPoints,
      loadRecoveryPoint,
      replace,
      restoreRecoveryPoint,
      save,
      subscribe,
      syncMessage,
      syncStatus,
      user.id,
      workspace,
    ],
  );

  const retry = useCallback(() => {
    if (workspaceRef.current) void flushPending();
    else setReloadToken((current) => current + 1);
  }, [flushPending]);

  return { workspace, persistence, loading, error, retry, save, replace, importRecords, syncStatus, syncMessage };
}

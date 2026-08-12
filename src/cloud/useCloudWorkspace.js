import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { deviceRecoveryStore } from "./deviceRecoveryStore";
import { WorkspaceConflictError, workspaceRepository } from "./workspaceRepository";

export function useCloudWorkspace(user) {
  const [workspace, setWorkspace] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reloadToken, setReloadToken] = useState(0);
  const revisionRef = useRef(0);
  const workspaceRef = useRef(null);

  const captureDeviceCopy = useCallback(async (state, revision, source, updatedAt = null) => {
    try {
      return await deviceRecoveryStore.capture({ ownerId: user.id, state, revision, source, updatedAt });
    } catch {
      // IndexedDB can be unavailable or full. Cloud persistence remains usable,
      // and Settings will still expose server-side recovery snapshots.
      return null;
    }
  }, [user.id]);

  const applyWorkspace = useCallback((incoming) => {
    if (!incoming || incoming.revision < revisionRef.current) return false;
    revisionRef.current = incoming.revision;
    workspaceRef.current = incoming;
    setWorkspace(incoming);
    return true;
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setWorkspace(null);
    revisionRef.current = 0;
    workspaceRef.current = null;
    workspaceRepository.loadOrCreateWorkspace(user.id)
      .then((loaded) => {
        if (!active) return;
        applyWorkspace(loaded);
        void captureDeviceCopy(loaded.state, loaded.revision, "cloud-load", loaded.updatedAt);
      })
      .catch((caught) => {
        if (active) setError(caught);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [applyWorkspace, captureDeviceCopy, reloadToken, user.id]);

  const save = useCallback(async (state, previousState) => {
    try {
      const saved = await workspaceRepository.saveWorkspace(
        state,
        revisionRef.current,
        user.id,
        previousState,
      );
      if (!applyWorkspace(saved)) {
        const latest = await workspaceRepository.loadWorkspace(user.id);
        if (!latest) throw new Error("The latest cloud workspace could not be reloaded.");
        if (!applyWorkspace(latest)) return workspaceRef.current?.state ?? latest.state;
        setError(null);
        return workspaceRef.current.state;
      }
      setError(null);
      return saved.state;
    } catch (caught) {
      if (caught instanceof WorkspaceConflictError) {
        const latest = {
          state: caught.latestState,
          revision: caught.latestRevision,
          updatedAt: caught.latestUpdatedAt,
        };
        if (!applyWorkspace(latest) && workspaceRef.current) {
          caught.latestState = workspaceRef.current.state;
          caught.latestRevision = workspaceRef.current.revision;
          caught.latestUpdatedAt = workspaceRef.current.updatedAt;
        }
      }
      throw caught;
    }
  }, [applyWorkspace, user.id]);

  const replace = useCallback(async (state) => {
    try {
      const previous = workspaceRef.current;
      if (previous?.state) {
        await captureDeviceCopy(previous.state, previous.revision, "before-replace", previous.updatedAt);
      }
      const replaced = await workspaceRepository.replaceWorkspace(state, revisionRef.current, user.id);
      applyWorkspace(replaced);
      void captureDeviceCopy(replaced.state, replaced.revision, "cloud-replace", replaced.updatedAt);
      setError(null);
      return workspaceRef.current?.state ?? replaced.state;
    } catch (caught) {
      if (caught instanceof WorkspaceConflictError) {
        applyWorkspace({
          state: caught.latestState,
          revision: caught.latestRevision,
          updatedAt: caught.latestUpdatedAt,
        });
      }
      throw caught;
    }
  }, [applyWorkspace, captureDeviceCopy, user.id]);

  const importRecords = useCallback(async (state, metadata) => {
    try {
      const previous = workspaceRef.current;
      if (previous?.state) {
        await captureDeviceCopy(previous.state, previous.revision, "before-import", previous.updatedAt);
      }
      const imported = await workspaceRepository.applyWorkspaceImport(
        state,
        revisionRef.current,
        user.id,
        metadata,
      );
      applyWorkspace(imported);
      if (!imported.alreadyImported) {
        void captureDeviceCopy(imported.state, imported.revision, "cloud-import", imported.updatedAt);
      }
      setError(null);
      return imported;
    } catch (caught) {
      if (caught instanceof WorkspaceConflictError) {
        applyWorkspace({
          state: caught.latestState,
          revision: caught.latestRevision,
          updatedAt: caught.latestUpdatedAt,
        });
      }
      throw caught;
    }
  }, [applyWorkspace, captureDeviceCopy, user.id]);

  const findImportJob = useCallback((fileHash) => (
    workspaceRepository.findImportJob(fileHash, user.id)
  ), [user.id]);

  const listRecoveryPoints = useCallback(async () => {
    const [cloudPoints, devicePoints] = await Promise.all([
      workspaceRepository.listRecoverySnapshots(user.id),
      deviceRecoveryStore.list(user.id).catch(() => []),
    ]);
    return [...cloudPoints, ...devicePoints]
      .sort((left, right) => String(right.capturedAt).localeCompare(String(left.capturedAt)));
  }, [user.id]);

  const loadRecoveryPoint = useCallback(async (point) => {
    if (point?.source === "cloud-snapshot") {
      return workspaceRepository.loadRecoverySnapshot(point.id, user.id);
    }
    return deviceRecoveryStore.load(user.id, point?.id);
  }, [user.id]);

  const restoreRecoveryPoint = useCallback(async (point) => {
    await captureDeviceCopy(
      workspaceRef.current?.state,
      revisionRef.current,
      "before-restore",
      workspaceRef.current?.updatedAt,
    );
    try {
      const recovered = point?.source === "cloud-snapshot"
        ? await workspaceRepository.restoreRecoverySnapshot(point.id, revisionRef.current, user.id)
        : await (async () => {
            const copy = await deviceRecoveryStore.load(user.id, point?.id);
            if (!copy) throw new Error("That device recovery copy is no longer available.");
            return workspaceRepository.replaceWorkspace(copy.state, revisionRef.current, user.id);
          })();
      applyWorkspace(recovered);
      void captureDeviceCopy(recovered.state, recovered.revision, "cloud-restore", recovered.updatedAt);
      setError(null);
      return workspaceRef.current?.state ?? recovered.state;
    } catch (caught) {
      if (caught instanceof WorkspaceConflictError) {
        applyWorkspace({
          state: caught.latestState,
          revision: caught.latestRevision,
          updatedAt: caught.latestUpdatedAt,
        });
      }
      throw caught;
    }
  }, [applyWorkspace, captureDeviceCopy, user.id]);

  const subscribe = useCallback((onChange) => {
    let disposed = false;
    let cleanup = null;
    workspaceRepository.subscribeToWorkspace((incoming) => {
      if (disposed) return;
      if (incoming.revision <= revisionRef.current) return;
      if (applyWorkspace(incoming)) {
        void captureDeviceCopy(incoming.state, incoming.revision, "cloud-realtime", incoming.updatedAt);
        onChange(incoming.state);
      }
    }, {
      userId: user.id,
      onStatus: (status) => {
        if (disposed) return;
        if (status === "SUBSCRIBED") {
          setError(null);
          void workspaceRepository.loadWorkspace(user.id)
            .then((latest) => {
              if (disposed || !latest || latest.revision <= revisionRef.current) return;
              if (applyWorkspace(latest)) {
                void captureDeviceCopy(latest.state, latest.revision, "cloud-reconnect", latest.updatedAt);
                onChange(latest.state);
              }
            })
            .catch((caught) => {
              if (!disposed) setError(caught);
            });
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setError(new Error("Live updates disconnected. Saved changes still use revision checks."));
        }
      },
      onError: (caught) => {
        if (!disposed) setError(caught);
      },
    }).then((unsubscribe) => {
      if (disposed) void Promise.resolve(unsubscribe()).catch(() => {});
      else cleanup = unsubscribe;
    }).catch((caught) => {
      if (!disposed) setError(caught);
    });

    return () => {
      disposed = true;
      if (cleanup) void Promise.resolve(cleanup()).catch(() => {});
    };
  }, [applyWorkspace, captureDeviceCopy, user.id]);

  const persistence = useMemo(() => workspace ? {
    mode: "cloud",
    uiStorageKey: `minimal-class-manager:ui:v1:${user.id}`,
    initialState: workspace.state,
    save,
    replace,
    importRecords,
    findImportJob,
    subscribe,
    listRecoveryPoints,
    loadRecoveryPoint,
    restoreRecoveryPoint,
  } : null, [findImportJob, importRecords, listRecoveryPoints, loadRecoveryPoint, replace, restoreRecoveryPoint, save, subscribe, user.id, workspace]);

  const retry = useCallback(() => setReloadToken((current) => current + 1), []);

  return { workspace, persistence, loading, error, retry, save, replace, importRecords };
}

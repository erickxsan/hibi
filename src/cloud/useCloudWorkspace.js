import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WorkspaceConflictError, workspaceRepository } from "./workspaceRepository";

export function useCloudWorkspace(user) {
  const [workspace, setWorkspace] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reloadToken, setReloadToken] = useState(0);
  const revisionRef = useRef(0);
  const workspaceRef = useRef(null);

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
  }, [applyWorkspace, reloadToken, user.id]);

  const save = useCallback(async (state) => {
    try {
      const saved = await workspaceRepository.saveWorkspace(state, revisionRef.current, user.id);
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

  const reset = useCallback(async () => {
    const recovered = await workspaceRepository.resetWorkspace(user.id);
    applyWorkspace(recovered);
    setError(null);
    return workspaceRef.current?.state ?? recovered.state;
  }, [applyWorkspace, user.id]);

  const subscribe = useCallback((onChange) => {
    let disposed = false;
    let cleanup = null;
    workspaceRepository.subscribeToWorkspace((incoming) => {
      if (disposed) return;
      if (incoming.revision <= revisionRef.current) return;
      if (applyWorkspace(incoming)) onChange(incoming.state);
    }, {
      userId: user.id,
      onStatus: (status) => {
        if (disposed) return;
        if (status === "SUBSCRIBED") {
          setError(null);
          void workspaceRepository.loadWorkspace(user.id)
            .then((latest) => {
              if (disposed || !latest || latest.revision <= revisionRef.current) return;
              if (applyWorkspace(latest)) onChange(latest.state);
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
  }, [applyWorkspace, user.id]);

  const persistence = useMemo(() => workspace ? {
    mode: "cloud",
    uiStorageKey: `minimal-class-manager:ui:v1:${user.id}`,
    initialState: workspace.state,
    save,
    subscribe,
  } : null, [save, subscribe, user.id, workspace]);

  const retry = useCallback(() => setReloadToken((current) => current + 1), []);

  return { workspace, persistence, loading, error, retry, reset, save };
}

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  CalendarDays,
  CloudOff,
  Home as HomeIcon,
  Settings as SettingsIcon,
  UsersRound,
} from "lucide-react";
import { AccountMenu, AUTH_MODES, AuthScreen } from "./auth";
import { AppShell } from "./components/AppShell";
import { ToastRegion } from "./components/ui";
import {
  accountDeletionService,
  cloudAuth,
  hCaptchaSiteKey,
  isCloudConfigured,
  isLocalModeAllowed,
  LEGACY_DATA_CLAIM_KEY,
  MIGRATION_MARKER_PREFIX,
  purgeLocalAccountData,
} from "./cloud";
import {
  AccountDeletionComplete,
  AccountDeletionPending,
  CloudConfigurationRequired,
  CloudError,
  CloudLoading,
  LocalDataMigration,
} from "./cloud/CloudStates";
import { WorkspaceEncryptionGate } from "./cloud/WorkspaceEncryptionGate";
import { useCloudWorkspace } from "./cloud/useCloudWorkspace";
import { useEncryptedWorkspace } from "./cloud/useEncryptedWorkspace";
import { useWorkspaceEncryption } from "./cloud/useWorkspaceEncryption";
import { safeLoadStateWithMigrations } from "./domain";
import { useClassManager } from "./hooks/useClassManager";
import { usePageNavigation } from "./hooks/useHistoryNavigation";
import { useI18n } from "./i18n";

const NAV_ITEMS = [
  { id: "home", label: "Home", href: "/", icon: HomeIcon },
  { id: "community", label: "Community", href: "/community", icon: UsersRound },
  { id: "classes", label: "Classes", href: "/classes", icon: CalendarDays },
  { id: "grades", label: "Tracking", href: "/progress", icon: BarChart3 },
  { id: "settings", label: "Settings", href: "/settings", icon: SettingsIcon },
];

const Home = lazy(() => import("./features/Home"));
const Community = lazy(() => import("./features/Community"));
const Classes = lazy(() => import("./features/Classes"));
const Tracking = lazy(() => import("./features/Tracking"));
const Settings = lazy(() => import("./features/Settings"));

const PAYMENT_OVERVIEW_INTENT = Object.freeze({
  type: "open-tracking",
  tab: "payments",
  paymentScope: "overview",
  paymentChart: "projection",
});

function PageFallback() {
  return (
    <div className="route-loading" role="status" aria-live="polite">
      Loading…
    </div>
  );
}

let inMemoryLegacyClaim = "";

function hasRecords(state) {
  return [state?.groups, state?.students, state?.grades, state?.classLog].some(
    (collection) => Array.isArray(collection) && collection.length > 0,
  );
}

function syncStatusFor(manager, cloudError) {
  if (manager.syncStatus === "conflict") return "conflict";
  if (manager.syncStatus === "pending") return "offline";
  if (manager.syncStatus === "offline") return "offline-cached";
  if (cloudError || manager.syncStatus === "error") return "error";
  if (manager.syncStatus === "saving") return "syncing";
  return "synced";
}

export function ClassManagerApplication({ persistence, user, cloudError, onSignOut, onDeleteAccount, canNavigate }) {
  useI18n();
  const manager = useClassManager({ persistence });
  const [intent, setIntent] = useState(null);
  const [signingOut, setSigningOut] = useState(false);
  const navigationBlockers = useRef(new Set());
  const registerNavigationBlocker = useCallback((blocker) => {
    if (typeof blocker !== "function") return () => {};
    navigationBlockers.current.add(blocker);
    return () => navigationBlockers.current.delete(blocker);
  }, []);
  const allowNavigation = useCallback(
    (context) => {
      if (canNavigate?.(context) === false) return false;
      const messages = [...navigationBlockers.current].map((blocker) => blocker(context)).filter(Boolean);
      if (!messages.length) return true;
      if (typeof globalThis.confirm !== "function") return false;
      return globalThis.confirm([...new Set(messages)].join("\n\n"));
    },
    [canNavigate],
  );
  const { page, navigate, navigationReason } = usePageNavigation({
    canNavigate: allowNavigation,
    onPageChange: () => setIntent(null),
  });
  const openPage = useCallback(
    (nextPage, nextIntent = null) => {
      if (!navigate(nextPage)) return false;
      setIntent(nextIntent);
      return true;
    },
    [navigate],
  );
  const clearIntent = useCallback(() => setIntent(null), []);

  useEffect(() => {
    if (page !== "payments") return;
    if (navigate("grades", { replace: true })) setIntent(PAYMENT_OVERVIEW_INTENT);
  }, [navigate, page]);

  const pageContent = useMemo(() => {
    const common = {
      ...manager,
      intent: page === "payments" && !intent ? PAYMENT_OVERVIEW_INTENT : intent,
      clearIntent,
      navigate,
      openPage,
      registerNavigationBlocker,
      onDeleteAccount,
    };
    if (page === "community" || page === "students" || page === "groups") {
      return (
        <Community
          {...common}
          initialView={page === "students" ? "students" : page === "groups" ? "groups" : undefined}
        />
      );
    }
    if (page === "classes") return <Classes {...common} />;
    if (page === "grades" || page === "payments") return <Tracking {...common} />;
    if (page === "settings") return <Settings {...common} />;
    return <Home {...common} />;
  }, [clearIntent, intent, manager, navigate, onDeleteAccount, openPage, page, registerNavigationBlocker]);

  const handleSignOut = async () => {
    if (!onSignOut || signingOut) return;
    setSigningOut(true);
    try {
      await onSignOut();
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <>
      <AppShell
        navItems={NAV_ITEMS}
        activePage={page === "students" || page === "groups" ? "community" : page === "payments" ? "grades" : page}
        navigationReason={navigationReason}
        onNavigate={(nextPage) => {
          if (navigate(nextPage)) setIntent(null);
        }}
        toolbar={
          <div className="manager-toolbar">
            {user ? (
              <AccountMenu
                email={user.email}
                syncStatus={syncStatusFor(manager, cloudError)}
                syncMessage={
                  manager.syncMessage ||
                  cloudError?.message ||
                  (manager.syncStatus === "saving" ? "Wait for saving to finish before signing out." : undefined)
                }
                signingOut={signingOut}
                onSignOut={manager.syncStatus === "saving" ? undefined : handleSignOut}
              />
            ) : (
              <span className="cloud-mode-pill" title="Cloud sync is not configured">
                <CloudOff aria-hidden="true" size={16} />
                <span>Local only</span>
              </span>
            )}
          </div>
        }
      >
        <Suspense fallback={<PageFallback />}>{pageContent}</Suspense>
      </AppShell>
      <ToastRegion toasts={manager.toasts} onDismiss={manager.dismissToast} />
    </>
  );
}

function UnlockedCloudWorkspaceApplication({ session, encryption, onDeletionCompleted }) {
  const user = session.user;
  const { workspace, persistence, loading, error, retry } = useEncryptedWorkspace(
    user,
    encryption.session,
    encryption.security,
  );
  const localSnapshot = useMemo(() => safeLoadStateWithMigrations(), [user.id]);
  const markerKey = `${MIGRATION_MARKER_PREFIX}${user.id}`;
  const [dismissedCloudRevision, setDismissedCloudRevision] = useState(() => {
    try {
      return localStorage.getItem(markerKey) || "";
    } catch {
      return "";
    }
  });
  const [legacyClaim, setLegacyClaim] = useState(() => {
    try {
      return localStorage.getItem(LEGACY_DATA_CLAIM_KEY) || inMemoryLegacyClaim;
    } catch {
      return "";
    }
  });
  const [migrationBusy, setMigrationBusy] = useState(false);
  const [migrationError, setMigrationError] = useState("");
  const [deletionBusy, setDeletionBusy] = useState(false);
  const [deletionPending, setDeletionPending] = useState("");

  const deleteAccount = useCallback(
    async ({ confirmation }) => {
      if (deletionBusy) return;
      setDeletionBusy(true);
      try {
        const receipt = await accountDeletionService.removeAccount({ confirmation });
        let localPurgeComplete = true;
        try {
          await purgeLocalAccountData(user.id);
          inMemoryLegacyClaim = "";
        } catch {
          localPurgeComplete = false;
        }
        try {
          await cloudAuth.signOut({ scope: "local" });
        } catch {
          // Auth is already hard-deleted; the parent still clears its session.
        }
        onDeletionCompleted({ ...receipt, localPurgeComplete });
      } catch (caught) {
        if (caught?.retryable) setDeletionPending(caught.message);
        throw caught;
      } finally {
        setDeletionBusy(false);
      }
    },
    [deletionBusy, onDeletionCompleted, user.id],
  );

  if (loading) return <CloudLoading />;
  if (deletionPending) {
    return (
      <AccountDeletionPending
        busy={deletionBusy}
        error={deletionPending}
        onResume={deleteAccount}
        onSignOut={async () => {
          await encryption.lock({ forget: true });
          await cloudAuth.signOut({ scope: "local" });
        }}
      />
    );
  }
  if (!workspace || !persistence) {
    if (error?.code === "account_deletion_pending") {
      return (
        <AccountDeletionPending
          busy={deletionBusy}
          onResume={deleteAccount}
          onSignOut={async () => {
            await encryption.lock({ forget: true });
            await cloudAuth.signOut({ scope: "local" });
          }}
        />
      );
    }
    return (
      <CloudError
        error={error}
        onRetry={retry}
        onSignOut={async () => {
          await encryption.lock({ forget: true });
          await cloudAuth.signOut();
        }}
      />
    );
  }

  const needsMigration =
    dismissedCloudRevision !== String(workspace.revision) &&
    (!legacyClaim || legacyClaim === user.id) &&
    hasRecords(localSnapshot.state) &&
    !hasRecords(workspace.state);

  if (needsMigration) {
    const importLocalData = async () => {
      setMigrationBusy(true);
      setMigrationError("");
      try {
        await persistence.replace(localSnapshot.state);
        inMemoryLegacyClaim = user.id;
        try {
          localStorage.setItem(LEGACY_DATA_CLAIM_KEY, user.id);
          localStorage.setItem(markerKey, String(workspace.revision + 1));
        } catch {
          // The cloud copy is already owner-bound even if this local marker fails.
        }
        setLegacyClaim(user.id);
        setDismissedCloudRevision(String(workspace.revision + 1));
      } catch (caught) {
        setMigrationError(caught?.message || "The local records could not be moved online.");
      } finally {
        setMigrationBusy(false);
      }
    };
    const skipMigration = () => {
      try {
        localStorage.setItem(markerKey, String(workspace.revision));
      } catch {
        // The in-memory choice still prevents a loop in this session.
      }
      setDismissedCloudRevision(String(workspace.revision));
    };
    return (
      <LocalDataMigration
        state={localSnapshot.state}
        accountEmail={user.email}
        busy={migrationBusy}
        error={migrationError}
        recoveryMode={workspace.revision > 0}
        onImport={importLocalData}
        onSkip={skipMigration}
      />
    );
  }

  return (
    <ClassManagerApplication
      key={user.id}
      persistence={persistence}
      user={user}
      cloudError={error}
      onSignOut={async () => {
        await encryption.lock({ forget: true });
        await cloudAuth.signOut();
      }}
      onDeleteAccount={deleteAccount}
    />
  );
}

function LegacyCloudWorkspaceApplication({ session, onDeletionCompleted }) {
  const user = session.user;
  const { workspace, persistence, loading, error, retry, save } = useCloudWorkspace(user);
  const localSnapshot = useMemo(() => safeLoadStateWithMigrations(), [user.id]);
  const markerKey = `${MIGRATION_MARKER_PREFIX}${user.id}`;
  const [dismissedCloudRevision, setDismissedCloudRevision] = useState(() => {
    try {
      return localStorage.getItem(markerKey) || "";
    } catch {
      return "";
    }
  });
  const [legacyClaim, setLegacyClaim] = useState(() => {
    try {
      return localStorage.getItem(LEGACY_DATA_CLAIM_KEY) || inMemoryLegacyClaim;
    } catch {
      return "";
    }
  });
  const [migrationBusy, setMigrationBusy] = useState(false);
  const [migrationError, setMigrationError] = useState("");
  const [deletionBusy, setDeletionBusy] = useState(false);
  const [deletionPending, setDeletionPending] = useState("");

  const deleteAccount = useCallback(
    async ({ confirmation }) => {
      if (deletionBusy) return;
      setDeletionBusy(true);
      try {
        const receipt = await accountDeletionService.removeAccount({ confirmation });
        let localPurgeComplete = true;
        try {
          await purgeLocalAccountData(user.id);
          inMemoryLegacyClaim = "";
        } catch {
          localPurgeComplete = false;
        }
        try {
          await cloudAuth.signOut({ scope: "local" });
        } catch {
          // Auth is already hard-deleted; the parent still clears its session.
        }
        onDeletionCompleted({ ...receipt, localPurgeComplete });
      } catch (caught) {
        if (caught?.retryable) setDeletionPending(caught.message);
        throw caught;
      } finally {
        setDeletionBusy(false);
      }
    },
    [deletionBusy, onDeletionCompleted, user.id],
  );

  if (loading) return <CloudLoading />;
  if (deletionPending) {
    return (
      <AccountDeletionPending
        busy={deletionBusy}
        error={deletionPending}
        onResume={deleteAccount}
        onSignOut={() => cloudAuth.signOut({ scope: "local" })}
      />
    );
  }
  if (!workspace || !persistence) {
    if (error?.code === "account_deletion_pending") {
      return (
        <AccountDeletionPending
          busy={deletionBusy}
          onResume={deleteAccount}
          onSignOut={() => cloudAuth.signOut({ scope: "local" })}
        />
      );
    }
    return <CloudError error={error} onRetry={retry} onSignOut={() => cloudAuth.signOut()} />;
  }

  const needsMigration =
    dismissedCloudRevision !== String(workspace.revision) &&
    (!legacyClaim || legacyClaim === user.id) &&
    hasRecords(localSnapshot.state) &&
    !hasRecords(workspace.state);
  if (needsMigration) {
    const importLocalData = async () => {
      setMigrationBusy(true);
      setMigrationError("");
      try {
        await save(localSnapshot.state);
        inMemoryLegacyClaim = user.id;
        try {
          localStorage.setItem(LEGACY_DATA_CLAIM_KEY, user.id);
          localStorage.setItem(markerKey, String(workspace.revision + 1));
        } catch {
          // The cloud copy is already owner-bound even if this local marker fails.
        }
        setLegacyClaim(user.id);
        setDismissedCloudRevision(String(workspace.revision + 1));
      } catch (caught) {
        setMigrationError(caught?.message || "The local records could not be moved online.");
      } finally {
        setMigrationBusy(false);
      }
    };
    const skipMigration = () => {
      try {
        localStorage.setItem(markerKey, String(workspace.revision));
      } catch {
        // The in-memory choice still prevents a loop in this session.
      }
      setDismissedCloudRevision(String(workspace.revision));
    };
    return (
      <LocalDataMigration
        state={localSnapshot.state}
        accountEmail={user.email}
        busy={migrationBusy}
        error={migrationError}
        recoveryMode={workspace.revision > 0}
        onImport={importLocalData}
        onSkip={skipMigration}
      />
    );
  }

  return (
    <ClassManagerApplication
      key={user.id}
      persistence={persistence}
      user={user}
      cloudError={error}
      onSignOut={() => cloudAuth.signOut()}
      onDeleteAccount={deleteAccount}
    />
  );
}

function CloudWorkspaceApplication({ session, onDeletionCompleted }) {
  const encryption = useWorkspaceEncryption(session.user);
  if (
    !encryption.loading &&
    encryption.bootstrap &&
    !encryption.bootstrap.profile &&
    !encryption.bootstrap.rolloutEnabled
  ) {
    return <LegacyCloudWorkspaceApplication session={session} onDeletionCompleted={onDeletionCompleted} />;
  }
  if (encryption.loading || !encryption.session) {
    return (
      <WorkspaceEncryptionGate
        accountEmail={session.user.email}
        bootstrap={encryption.bootstrap}
        loading={encryption.loading}
        busy={encryption.busy}
        error={encryption.error}
        progress={encryption.progress}
        onActivate={encryption.activate}
        onUnlockPassword={encryption.unlockPassword}
        onUnlockRecovery={encryption.unlockRecovery}
        onRetry={encryption.retry}
        onSignOut={async () => {
          await encryption.lock({ forget: true });
          await cloudAuth.signOut({ scope: "local" });
        }}
      />
    );
  }
  return (
    <UnlockedCloudWorkspaceApplication
      session={session}
      encryption={encryption}
      onDeletionCompleted={onDeletionCompleted}
    />
  );
}

function AuthenticatedCloudApplication() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [bootstrapError, setBootstrapError] = useState("");
  const [deletionReceipt, setDeletionReceipt] = useState(null);

  useEffect(() => {
    let active = true;
    const unsubscribe = cloudAuth.onAuthStateChange((event, nextSession) => {
      if (!active) return;
      if (event === "PASSWORD_RECOVERY") setRecoveryMode(true);
      if (event === "SIGNED_OUT" || event === "USER_DELETED") setRecoveryMode(false);
      if (nextSession) setBootstrapError("");
      setSession(nextSession);
      setLoading(false);
    });
    cloudAuth
      .getSession()
      .then((current) => {
        if (active) setSession(current);
      })
      .catch((caught) => {
        if (active) setBootstrapError(caught?.message || "The saved session could not be checked.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  if (loading) return <CloudLoading message="Checking your secure session…" />;
  if (deletionReceipt) {
    return (
      <AccountDeletionComplete
        receipt={deletionReceipt}
        onRetryLocalPurge={async () => {
          await purgeLocalAccountData(deletionReceipt.ownerId);
          setDeletionReceipt((current) => ({ ...current, localPurgeComplete: true }));
        }}
        onContinue={() => setDeletionReceipt(null)}
      />
    );
  }
  if (recoveryMode) {
    return (
      <AuthScreen
        mode={AUTH_MODES.RESET_PASSWORD}
        captchaSiteKey={hCaptchaSiteKey}
        error={bootstrapError}
        onModeChange={(mode) => {
          if (mode === AUTH_MODES.RESET_PASSWORD) return;
          cloudAuth
            .signOut()
            .then(() => setRecoveryMode(false))
            .catch((caught) => setBootstrapError(caught?.message || "Sign out failed."));
        }}
        onResetPassword={async ({ password }) => {
          await cloudAuth.updatePassword(password);
          setRecoveryMode(false);
          return { message: "Password updated." };
        }}
      />
    );
  }
  if (!session) {
    return (
      <AuthScreen
        error={bootstrapError}
        captchaSiteKey={hCaptchaSiteKey}
        onGoogleSignIn={() => cloudAuth.signInWithGoogle()}
        onSignIn={({ email, password, captchaToken }) => cloudAuth.signIn({ email, password, captchaToken })}
      />
    );
  }

  return (
    <CloudWorkspaceApplication
      key={session.user.id}
      session={session}
      onDeletionCompleted={(receipt) => {
        setDeletionReceipt(receipt);
        setSession(null);
      }}
    />
  );
}

export default function App() {
  useI18n();
  if (isCloudConfigured) return <AuthenticatedCloudApplication />;
  if (isLocalModeAllowed) return <ClassManagerApplication />;
  return <CloudConfigurationRequired />;
}

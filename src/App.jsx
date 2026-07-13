import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpenCheck, CloudOff, GraduationCap, LayoutDashboard, NotebookTabs, Plus } from "lucide-react";
import { AccountMenu, AUTH_MODES, AuthScreen } from "./auth";
import { AppShell } from "./components/AppShell";
import { Button, ToastRegion } from "./components/ui";
import { cloudAuth, hCaptchaSiteKey, isCloudConfigured, isLocalModeAllowed } from "./cloud";
import { CloudConfigurationRequired, CloudError, CloudLoading, LocalDataMigration } from "./cloud/CloudStates";
import { useCloudWorkspace } from "./cloud/useCloudWorkspace";
import { safeLoadStateWithMigrations } from "./domain";
import ClassLog from "./features/ClassLog";
import Grades from "./features/Grades";
import Home from "./features/Home";
import Setup from "./features/Setup";
import { useClassManager } from "./hooks/useClassManager";
import { usePageNavigation } from "./hooks/useHistoryNavigation";

const NAV_ITEMS = [
  { id: "home", label: "Home", href: "/", icon: LayoutDashboard },
  { id: "setup", label: "Setup", href: "/setup", icon: NotebookTabs },
  { id: "grades", label: "Grades", href: "/grades", icon: GraduationCap },
  { id: "class-log", label: "Class Log", href: "/class-log", icon: BookOpenCheck },
];

const PRIMARY_ACTIONS = {
  home: { label: "Log class", target: "class-log" },
  grades: { label: "Add grades", target: "grades" },
  "class-log": { label: "Log class", target: "class-log" },
};

const MIGRATION_MARKER_PREFIX = "minimal-class-manager:cloud-migration-dismissed:v1:";
const LEGACY_DATA_CLAIM_KEY = "minimal-class-manager:legacy-data-claimed:v1";
let inMemoryLegacyClaim = "";

function hasRecords(state) {
  return [state?.groups, state?.students, state?.grades, state?.classLog]
    .some((collection) => Array.isArray(collection) && collection.length > 0);
}

function syncStatusFor(manager, cloudError) {
  if (cloudError || manager.syncStatus === "error") return "error";
  if (manager.syncStatus === "saving") return "syncing";
  return "synced";
}

export function ClassManagerApplication({ persistence, user, cloudError, onSignOut, canNavigate }) {
  const manager = useClassManager({ persistence });
  const [intent, setIntent] = useState(null);
  const [signingOut, setSigningOut] = useState(false);
  const navigationBlockers = useRef(new Set());
  const registerNavigationBlocker = useCallback((blocker) => {
    if (typeof blocker !== "function") return () => {};
    navigationBlockers.current.add(blocker);
    return () => navigationBlockers.current.delete(blocker);
  }, []);
  const allowNavigation = useCallback((context) => {
    if (canNavigate?.(context) === false) return false;
    const messages = [...navigationBlockers.current]
      .map((blocker) => blocker(context))
      .filter(Boolean);
    if (!messages.length) return true;
    if (typeof globalThis.confirm !== "function") return false;
    return globalThis.confirm([...new Set(messages)].join("\n\n"));
  }, [canNavigate]);
  const { page, navigate, navigationReason } = usePageNavigation({
    canNavigate: allowNavigation,
    onPageChange: () => setIntent(null),
  });

  const action = PRIMARY_ACTIONS[page];
  const pageContent = useMemo(() => {
    const common = {
      ...manager,
      intent,
      clearIntent: () => setIntent(null),
      navigate,
      registerNavigationBlocker,
    };
    if (page === "setup") return <Setup {...common} />;
    if (page === "grades") return <Grades {...common} />;
    if (page === "class-log") return <ClassLog {...common} />;
    return <Home {...common} />;
  }, [intent, manager, navigate, page, registerNavigationBlocker]);

  const handlePrimaryAction = () => {
    if (!action || !navigate(action.target)) return;
    setIntent(page === "grades" ? "add-grades" : "new-class");
  };

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
        activePage={page}
        navigationReason={navigationReason}
        onNavigate={(nextPage) => {
          if (navigate(nextPage)) setIntent(null);
        }}
        toolbar={
          <div className="manager-toolbar">
            {action ? (
              <Button variant="primary" icon={Plus} onClick={handlePrimaryAction} aria-label={action.label}>
                {action.label}
              </Button>
            ) : null}
            {user ? (
              <AccountMenu
                email={user.email}
                syncStatus={syncStatusFor(manager, cloudError)}
                syncMessage={cloudError?.message || (manager.syncStatus === "saving" ? "Wait for saving to finish before signing out." : undefined)}
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
        {pageContent}
      </AppShell>
      <ToastRegion toasts={manager.toasts} onDismiss={manager.dismissToast} />
    </>
  );
}

function CloudWorkspaceApplication({ session }) {
  const user = session.user;
  const { workspace, persistence, loading, error, retry, reset, save } = useCloudWorkspace(user);
  const localSnapshot = useMemo(() => safeLoadStateWithMigrations(), [user.id]);
  const markerKey = `${MIGRATION_MARKER_PREFIX}${user.id}`;
  const [migrationSkipped, setMigrationSkipped] = useState(() => {
    try {
      return localStorage.getItem(markerKey) === "yes";
    } catch {
      return false;
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

  if (loading) return <CloudLoading />;
  if (!workspace || !persistence) {
    const recoverable = error?.name === "DomainValidationError" || /invalid|unreadable/i.test(error?.message || "");
    return <CloudError error={error} onRetry={retry} onReset={recoverable ? reset : undefined} onSignOut={() => cloudAuth.signOut()} />;
  }

  const needsMigration = !migrationSkipped
    && (!legacyClaim || legacyClaim === user.id)
    && hasRecords(localSnapshot.state)
    && !hasRecords(workspace.state);

  if (needsMigration) {
    const importLocalData = async () => {
      setMigrationBusy(true);
      setMigrationError("");
      try {
        await save(localSnapshot.state);
        inMemoryLegacyClaim = user.id;
        try {
          localStorage.setItem(LEGACY_DATA_CLAIM_KEY, user.id);
          localStorage.setItem(markerKey, "yes");
        } catch {
          // The cloud copy is already owner-bound even if this local marker fails.
        }
        setLegacyClaim(user.id);
        setMigrationSkipped(true);
      } catch (caught) {
        setMigrationError(caught?.message || "The local records could not be moved online.");
      } finally {
        setMigrationBusy(false);
      }
    };
    const skipMigration = () => {
      try {
        localStorage.setItem(markerKey, "yes");
      } catch {
        // The in-memory choice still prevents a loop in this session.
      }
      setMigrationSkipped(true);
    };
    return (
      <LocalDataMigration
        state={localSnapshot.state}
        accountEmail={user.email}
        busy={migrationBusy}
        error={migrationError}
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
    />
  );
}

function AuthenticatedCloudApplication() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [bootstrapError, setBootstrapError] = useState("");

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
    cloudAuth.getSession()
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
  if (recoveryMode) {
    return (
      <AuthScreen
        mode={AUTH_MODES.RESET_PASSWORD}
        captchaSiteKey={hCaptchaSiteKey}
        error={bootstrapError}
        onModeChange={(mode) => {
          if (mode === AUTH_MODES.RESET_PASSWORD) return;
          cloudAuth.signOut()
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

  return <CloudWorkspaceApplication key={session.user.id} session={session} />;
}

export default function App() {
  if (isCloudConfigured) return <AuthenticatedCloudApplication />;
  if (isLocalModeAllowed) return <ClassManagerApplication />;
  return <CloudConfigurationRequired />;
}

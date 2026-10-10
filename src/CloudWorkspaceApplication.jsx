import { lazy, Suspense, useCallback, useState } from "react";
import {
  accountDeletionService,
  cloudAuth,
  LEGACY_DATA_CLAIM_KEY,
  MIGRATION_MARKER_PREFIX,
  purgeLocalAccountData,
} from "./cloud";
import { AccountDeletionPending, CloudError, CloudLoading, LocalDataMigration } from "./cloud/CloudStates";
import { WorkspaceEncryptionGate } from "./cloud/WorkspaceEncryptionGate";
import { useCloudWorkspace } from "./cloud/useCloudWorkspace";
import { useEncryptedWorkspace } from "./cloud/useEncryptedWorkspace";
import { useWorkspaceEncryption } from "./cloud/useWorkspaceEncryption";
import { AccountDeletionRecovery } from "./cloud/AccountDeletionRecovery.jsx";
import { safeLoadStateWithMigrations } from "./domain";
const ClassManagerApplication = lazy(() => import("./ClassManagerApplication"));
let inMemoryLegacyClaim = "";
function hasRecords(state) {
  return [state?.groups, state?.students, state?.grades, state?.classLog].some(
    (collection) => Array.isArray(collection) && collection.length > 0,
  );
}

function UnlockedCloudWorkspaceApplication({ session, encryption, onDeletionCompleted }) {
  const user = session.user;
  const { workspace, persistence, loading, error, retry } = useEncryptedWorkspace(
    user,
    encryption.session,
    encryption.security,
  );
  const [localSnapshot] = useState(() => safeLoadStateWithMigrations());
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
  const [localSnapshot] = useState(() => safeLoadStateWithMigrations());
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

function WorkspaceApplication({ session, onDeletionCompleted }) {
  const encryption = useWorkspaceEncryption(session.user);
  if (encryption.error?.code === "account_deletion_pending") {
    return (
      <AccountDeletionRecovery
        onDeletionCompleted={onDeletionCompleted}
        onSignOut={() => cloudAuth.signOut({ scope: "local" })}
      />
    );
  }
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

export default function CloudWorkspaceApplication(props) {
  return (
    <Suspense fallback={<CloudLoading />}>
      <WorkspaceApplication {...props} />
    </Suspense>
  );
}

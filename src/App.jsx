import { lazy, Suspense, useEffect, useState } from "react";
import { AUTH_MODES, AuthScreen } from "./auth";
import { cloudAuth, hCaptchaSiteKey, isCloudConfigured, isLocalModeAllowed } from "./cloud/client";
import { AccountDeletionComplete, CloudConfigurationRequired, CloudLoading } from "./cloud/CloudStates";
import { useI18n } from "./i18n";
export const ClassManagerApplication = lazy(() => import("./ClassManagerApplication"));
const CloudWorkspaceApplication = lazy(() => import("./CloudWorkspaceApplication"));
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
          const { purgeLocalAccountData } = await import("./cloud/accountDeletion");
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
  return (
    <Suspense fallback={<CloudLoading />}>
      {isCloudConfigured ? (
        <AuthenticatedCloudApplication />
      ) : isLocalModeAllowed ? (
        <ClassManagerApplication />
      ) : (
        <CloudConfigurationRequired />
      )}
    </Suspense>
  );
}

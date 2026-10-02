import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  CalendarDays,
  CirclePlus,
  CloudOff,
  Home as HomeIcon,
  Settings as SettingsIcon,
  UsersRound,
} from "lucide-react";
import { AccountMenu } from "./auth/AccountMenu";
import { AppShell } from "./components/AppShell";
import { ToastRegion } from "./components/ui";
import { PendingOperations } from "./cloud/PendingOperations";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { useClassManager } from "./hooks/useClassManager";
import { usePageNavigation } from "./hooks/useHistoryNavigation";
import { useI18n } from "./i18n";
import {
  onboardingStep,
  ONBOARDING_TOUR_START_STEP,
  setupResumeStep,
  shouldAutoStartOnboarding,
} from "./onboarding/onboardingModel";
const OnboardingTutorial = lazy(() => import("./onboarding/OnboardingTutorial"));
const NAV_ITEMS = [
  { id: "home", label: "Home", href: "/", icon: HomeIcon },
  { id: "community", label: "Community", href: "/community", icon: UsersRound },
  {
    id: "classes",
    label: "Classes",
    mobileLabel: "Record",
    href: "/classes",
    icon: CalendarDays,
    mobileIcon: CirclePlus,
  },
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
  const { t: uiT } = useI18n();
  return (
    <div className="route-loading" role="status" aria-live="polite">
      {uiT("Loading…")}
    </div>
  );
}

function syncStatusFor(manager, cloudError) {
  if (manager.syncStatus === "conflict") return "conflict";
  if (manager.syncStatus === "pending") return "offline";
  if (manager.syncStatus === "reconnecting") return "reconnecting";
  if (manager.syncStatus === "offline") return "offline-cached";
  if (cloudError || manager.syncStatus === "error") return "error";
  if (manager.syncStatus === "saving") return "syncing";
  return "synced";
}

export default function ClassManagerApplication({
  persistence = undefined,
  user = undefined,
  cloudError = undefined,
  onSignOut = undefined,
  onDeleteAccount = undefined,
  canNavigate = undefined,
}) {
  const { t: uiT } = useI18n();
  useI18n();
  const manager = useClassManager({ persistence });
  const [intent, setIntent] = useState(null);
  const [signingOut, setSigningOut] = useState(false);
  const [onboarding, setOnboarding] = useState(() => ({
    open: shouldAutoStartOnboarding(manager.state),
    runId: 0,
    mode: "full",
    step: onboardingStep(manager.state.settings),
  }));
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
  // Settings can replay the tour alone or reopen the guided setup where it was left.
  const openOnboarding = useCallback(
    (requestedMode) => {
      if (!navigate("home")) return;
      const mode = requestedMode === "setup" ? "setup" : "tour";
      setIntent(null);
      const step = mode === "setup" ? setupResumeStep(manager.state.settings) || 2 : ONBOARDING_TOUR_START_STEP;
      setOnboarding((current) => ({ open: true, runId: current.runId + 1, mode, step }));
    },
    [manager.state.settings, navigate],
  );
  const closeOnboarding = useCallback(
    (nextPage) => {
      setOnboarding((current) => ({ ...current, open: false }));
      if (nextPage && navigate(nextPage)) setIntent(null);
    },
    [navigate],
  );
  const navigateOnboarding = useCallback(
    (nextPage) => {
      if (navigate(nextPage, { replace: true })) setIntent(null);
    },
    [navigate],
  );

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
      onOpenOnboarding: openOnboarding,
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
  }, [
    clearIntent,
    intent,
    manager,
    navigate,
    onDeleteAccount,
    openOnboarding,
    openPage,
    page,
    registerNavigationBlocker,
  ]);

  const handleSignOut = async () => {
    if (!onSignOut || signingOut) return;
    setSigningOut(true);
    try {
      await onSignOut();
    } finally {
      setSigningOut(false);
    }
  };

  const shellPage = page === "students" || page === "groups" ? "community" : page === "payments" ? "grades" : page;

  return (
    <>
      <AppShell
        navItems={NAV_ITEMS}
        guidedNavigation={onboarding.open}
        activePage={shellPage}
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
              <span className="cloud-mode-pill" title={uiT("Cloud sync is not configured")}>
                <CloudOff aria-hidden="true" size={16} />
                <span>{uiT("Local only")}</span>
              </span>
            )}
          </div>
        }
      >
        <PendingOperations persistence={persistence} />
        <ErrorBoundary
          key={page}
          resetKey={page}
          canReload={
            manager.syncStatus !== "saving" && manager.syncStatus !== "pending" && manager.syncStatus !== "conflict"
          }
        >
          <Suspense fallback={<PageFallback />}>{pageContent}</Suspense>
        </ErrorBoundary>
      </AppShell>
      {onboarding.open ? (
        <Suspense fallback={<PageFallback />}>
          <OnboardingTutorial
            key={onboarding.runId}
            open={onboarding.open}
            state={manager.state}
            actions={manager.actions}
            initialStep={onboarding.step}
            mode={onboarding.mode === "tour" ? "tour" : "full"}
            onStepChange={(step) => setOnboarding((current) => ({ ...current, step }))}
            onNavigate={navigateOnboarding}
            onDismiss={() => closeOnboarding()}
            onComplete={closeOnboarding}
          />
        </Suspense>
      ) : null}
      <ToastRegion toasts={manager.toasts} onDismiss={manager.dismissToast} />
    </>
  );
}

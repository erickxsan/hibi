import { useI18n } from "../i18n/index.jsx";
import { cloneElement, isValidElement, useEffect, useRef } from "react";
import { HibiLogo, HibiStamp } from "./BrandMark";
import { useCompactViewport } from "./OverlayContext";

export function AppShell({
  navItems,
  activePage,
  navigationReason,
  onNavigate,
  toolbar,
  children,
  guidedNavigation = false,
}) {
  const { t: uiT, language } = useI18n();
  const mainRef = useRef(null);
  const compact = useCompactViewport();
  const go = (event, page) => {
    if (
      event?.defaultPrevented ||
      (event && (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey))
    )
      return;
    event?.preventDefault();
    onNavigate(page);
  };

  useEffect(() => {
    if (guidedNavigation) return;
    mainRef.current?.focus({ preventScroll: true });
    if (navigationReason === "push" || navigationReason === "replace")
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [activePage, navigationReason, guidedNavigation]);

  // The sync pill lives once: at the foot of the sidebar or in the mobile top bar.
  const placedToolbar = (placement) =>
    isValidElement(toolbar) && typeof toolbar.type !== "string"
      ? cloneElement(/** @type {import("react").ReactElement<any>} */ (toolbar), { placement })
      : toolbar;

  return (
    <div className={`hibi-shell page-${activePage}`}>
      <a className="skip-link" href="#main-content">
        {uiT("Skip to content")}
      </a>
      <aside className="hibi-sidebar">
        <a className="hibi-brand" href="/" onClick={(event) => go(event, "home")} aria-label={uiT("Hibi home")}>
          <HibiLogo />
        </a>
        <nav aria-label={uiT("Primary navigation")} className="sidebar-nav">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <a
                key={item.id}
                href={item.href}
                onClick={(event) => go(event, item.id)}
                className={activePage === item.id ? "sidebar-link active" : "sidebar-link"}
                aria-current={activePage === item.id ? "page" : undefined}
              >
                <Icon size={20} strokeWidth={1.8} />
                <span>{uiT(item.label)}</span>
              </a>
            );
          })}
        </nav>
        <div className="sidebar-companion">
          <HibiStamp size={52} />
          {!compact ? <div className="sidebar-toolbar">{placedToolbar("up")}</div> : null}
        </div>
      </aside>
      <section className="hibi-workspace">
        <header className="hibi-topbar">
          <a className="mobile-brand" href="/" onClick={(event) => go(event, "home")} aria-label={uiT("Hibi home")}>
            <HibiLogo height={34} />
          </a>
          {compact ? <div className="topbar-tools">{placedToolbar("down")}</div> : null}
        </header>
        <main id="main-content" ref={mainRef} tabIndex={-1} className="hibi-main">
          <div className="route-stage" key={activePage}>
            {children}
          </div>
        </main>
      </section>
      <nav
        className="hibi-mobile-nav"
        aria-label={uiT("Mobile navigation")}
        style={/** @type {import("react").CSSProperties} */ ({ "--mobile-nav-count": navItems.length })}
      >
        {navItems.map((item) => {
          const Icon = item.icon;
          // The visible tab text is the accessible name, so «Ajustes» is also what screen readers announce.
          const label = uiT(item.mobileLabel && language === "es" ? item.mobileLabel : item.label);
          return (
            <a
              key={item.id}
              href={item.href}
              onClick={(event) => go(event, item.id)}
              className={activePage === item.id ? "mobile-link active" : "mobile-link"}
              aria-current={activePage === item.id ? "page" : undefined}
            >
              <Icon size={22} strokeWidth={1.8} aria-hidden="true" />
              <span>{label}</span>
            </a>
          );
        })}
      </nav>
    </div>
  );
}

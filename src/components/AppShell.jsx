import { useI18n } from "../i18n/index.jsx";
import { useEffect, useRef } from "react";
import { BrandMark } from "./BrandMark";

export function AppShell({
  navItems,
  activePage,
  navigationReason,
  onNavigate,
  toolbar,
  children,
  guidedNavigation = false,
}) {
  const { t: uiT } = useI18n();
  const mainRef = useRef(null);
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

  return (
    <div className={`hibi-shell page-${activePage}`}>
      <a className="skip-link" href="#main-content">
        {uiT("Skip to content")}
      </a>
      <aside className="hibi-sidebar">
        <a className="hibi-brand" href="/" onClick={(event) => go(event, "home")} aria-label={uiT("Hibi home")}>
          <BrandMark />
          <strong>{uiT("Hibi")}</strong>
          <span aria-hidden="true">★</span>
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
                <Icon size={19} strokeWidth={1.8} />
                <span>{uiT(item.label)}</span>
              </a>
            );
          })}
        </nav>
        <div className="sidebar-companion">
          <img src="/hibi-companion.png" alt={uiT("Hibi cat reading")} />
          <p>{uiT("Little by little, your students are doing amazing! 🌿")}</p>
        </div>
      </aside>
      <section className="hibi-workspace">
        <header className="hibi-topbar">
          <a className="mobile-brand" href="/" onClick={(event) => go(event, "home")}>
            <span>{uiT("Hibi")}</span>
            <b>★</b>
          </a>
          <div className="topbar-tools">{toolbar}</div>
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
          return (
            <a
              key={item.id}
              href={item.href}
              onClick={(event) => go(event, item.id)}
              className={activePage === item.id ? "mobile-link active" : "mobile-link"}
              aria-current={activePage === item.id ? "page" : undefined}
            >
              <Icon size={20} />
              <span>{uiT(item.label)}</span>
            </a>
          );
        })}
      </nav>
    </div>
  );
}

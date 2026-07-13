import { useEffect, useRef } from "react";
import { BrandMark } from "./BrandMark";

export function AppShell({ navItems, activePage, navigationReason, onNavigate, toolbar, children }) {
  const mainRef = useRef(null);

  const handleNavigation = (event, page) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onNavigate(page);
  };

  useEffect(() => {
    mainRef.current?.focus({ preventScroll: true });
    if (navigationReason === "push" || navigationReason === "replace") {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    }
  }, [activePage, navigationReason]);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <header className="app-header">
        <a className="brand" href="/" onClick={(event) => handleNavigation(event, "home")} aria-label="Go to Home">
          <BrandMark />
          <span className="brand-copy"><strong>hibi</strong><span>Class companion</span></span>
        </a>

        <nav className="primary-nav" aria-label="Primary navigation">
          {navItems.map((item) => (
            <a
              key={item.id}
              href={item.href}
              className={activePage === item.id ? "nav-item is-active" : "nav-item"}
              onClick={(event) => handleNavigation(event, item.id)}
              aria-current={activePage === item.id ? "page" : undefined}
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="header-toolbar">{toolbar}</div>
      </header>

      <main id="main-content" ref={mainRef} tabIndex="-1" className="app-main">
        {children}
      </main>

      <nav className="mobile-nav" aria-label="Mobile navigation">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <a
              key={item.id}
              href={item.href}
              className={activePage === item.id ? "mobile-nav-item is-active" : "mobile-nav-item"}
              onClick={(event) => handleNavigation(event, item.id)}
              aria-current={activePage === item.id ? "page" : undefined}
            >
              <Icon aria-hidden="true" size={19} strokeWidth={1.8} />
              <span>{item.label}</span>
            </a>
          );
        })}
      </nav>
    </div>
  );
}

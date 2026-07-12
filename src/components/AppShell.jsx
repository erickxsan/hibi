import { useEffect, useRef } from "react";
import { BrandMark } from "./BrandMark";

export function AppShell({ navItems, activePage, onNavigate, toolbar, children }) {
  const mainRef = useRef(null);

  useEffect(() => {
    mainRef.current?.focus({ preventScroll: true });
  }, [activePage]);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <header className="app-header">
        <button className="brand" type="button" onClick={() => onNavigate("home")} aria-label="Go to Home">
          <BrandMark />
          <span className="brand-copy"><strong>hibi</strong><span>Class companion</span></span>
        </button>

        <nav className="primary-nav" aria-label="Primary navigation">
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={activePage === item.id ? "nav-item is-active" : "nav-item"}
              onClick={() => onNavigate(item.id)}
              aria-current={activePage === item.id ? "page" : undefined}
            >
              {item.label}
            </button>
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
            <button
              key={item.id}
              type="button"
              className={activePage === item.id ? "mobile-nav-item is-active" : "mobile-nav-item"}
              onClick={() => onNavigate(item.id)}
              aria-current={activePage === item.id ? "page" : undefined}
            >
              <Icon aria-hidden="true" size={19} strokeWidth={1.8} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

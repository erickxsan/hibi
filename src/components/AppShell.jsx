import { useEffect, useRef, useState } from "react";
import { Ellipsis, X } from "lucide-react";
import { BrandMark } from "./BrandMark";

const MOBILE_PRIMARY = new Set(["home", "students", "classes", "payments"]);

export function AppShell({ navItems, activePage, navigationReason, onNavigate, toolbar, children }) {
  const mainRef = useRef(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const go = (event, page) => {
    if (event?.defaultPrevented || (event && (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey))) return;
    event?.preventDefault();
    setMoreOpen(false);
    onNavigate(page);
  };

  useEffect(() => {
    mainRef.current?.focus({ preventScroll: true });
    if (navigationReason === "push" || navigationReason === "replace") window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [activePage, navigationReason]);

  const primary = navItems.filter((item) => MOBILE_PRIMARY.has(item.id));
  const secondary = navItems.filter((item) => !MOBILE_PRIMARY.has(item.id));
  const secondaryActive = secondary.some((item) => item.id === activePage);

  return <div className="hibi-shell">
    <a className="skip-link" href="#main-content">Skip to content</a>
    <aside className="hibi-sidebar">
      <a className="hibi-brand" href="/" onClick={(event) => go(event, "home")} aria-label="Hibi home">
        <BrandMark /><strong>Hibi</strong><span aria-hidden="true">★</span>
      </a>
      <nav aria-label="Primary navigation" className="sidebar-nav">
        {navItems.map((item) => { const Icon = item.icon; return <a key={item.id} href={item.href} onClick={(event) => go(event, item.id)} className={activePage === item.id ? "sidebar-link active" : "sidebar-link"} aria-current={activePage === item.id ? "page" : undefined}><Icon size={19} strokeWidth={1.8}/><span>{item.label}</span></a>; })}
      </nav>
      <div className="sidebar-companion"><img src="/hibi-companion.png" alt="Hibi cat reading"/><p>Little by little, your students are doing amazing! 🌿</p></div>
    </aside>
    <section className="hibi-workspace">
      <header className="hibi-topbar"><a className="mobile-brand" href="/" onClick={(event) => go(event, "home")}><span>Hibi</span><b>★</b></a><div className="topbar-tools">{toolbar}</div></header>
      <main id="main-content" ref={mainRef} tabIndex="-1" className="hibi-main">{children}</main>
    </section>
    <nav className="hibi-mobile-nav" aria-label="Mobile navigation">
      {primary.map((item) => { const Icon = item.icon; return <a key={item.id} href={item.href} onClick={(event) => go(event, item.id)} className={activePage === item.id ? "mobile-link active" : "mobile-link"}><Icon size={20}/><span>{item.label}</span></a>; })}
      <button className={secondaryActive || moreOpen ? "mobile-link active" : "mobile-link"} type="button" onClick={() => setMoreOpen((value) => !value)}><Ellipsis size={21}/><span>More</span></button>
    </nav>
    {moreOpen ? <div className="mobile-more" role="dialog" aria-label="More navigation"><div className="mobile-more-head"><strong>More</strong><button type="button" aria-label="Close menu" onClick={() => setMoreOpen(false)}><X size={18}/></button></div>{secondary.map((item) => { const Icon = item.icon; return <a key={item.id} href={item.href} onClick={(event) => go(event, item.id)} className={activePage === item.id ? "sidebar-link active" : "sidebar-link"}><Icon size={19}/>{item.label}</a>; })}</div> : null}
  </div>;
}

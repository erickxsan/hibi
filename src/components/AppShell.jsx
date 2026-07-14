import { useEffect, useId, useRef, useState } from "react";
import { Ellipsis, X } from "lucide-react";
import { BrandMark } from "./BrandMark";
import { closeOverlayHistory, pushOverlayHistory, subscribeToAppHistory } from "../navigation/appHistory";

const MOBILE_PRIMARY = new Set(["home", "students", "classes", "payments"]);

export function AppShell({ navItems, activePage, navigationReason, onNavigate, toolbar, children }) {
  const mainRef = useRef(null);
  const moreRef = useRef(null);
  const moreButtonRef = useRef(null);
  const ownsMoreHistory = useRef(false);
  const moreHistoryId = useId();
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

  const closeMore = () => {
    if (!moreOpen) return;
    if (ownsMoreHistory.current && closeOverlayHistory(moreHistoryId)) return;
    setMoreOpen(false);
  };

  useEffect(() => {
    if (!moreOpen) return undefined;
    const historyTimer = window.setTimeout(() => {
      ownsMoreHistory.current = Boolean(pushOverlayHistory(moreHistoryId));
    }, 0);
    const unsubscribe = subscribeToAppHistory({
      beforePop: ({ previous, next }) => {
        const wasOpen = previous?.overlays?.includes(moreHistoryId);
        const remainsOpen = next?.overlays?.includes(moreHistoryId);
        if (wasOpen && !remainsOpen) {
          ownsMoreHistory.current = false;
          setMoreOpen(false);
        }
        return true;
      },
    });
    const handleKeyDown = (event) => {
      if (event.key === "Escape") closeMore();
    };
    const handlePointerDown = (event) => {
      if (moreRef.current?.contains(event.target) || moreButtonRef.current?.contains(event.target)) return;
      closeMore();
    };
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown);
    moreRef.current?.querySelector("a, button")?.focus();
    return () => {
      window.clearTimeout(historyTimer);
      unsubscribe();
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown);
      if (ownsMoreHistory.current) closeOverlayHistory(moreHistoryId);
      ownsMoreHistory.current = false;
      moreButtonRef.current?.focus?.({ preventScroll: true });
    };
  // `closeMore` reads only current state and the stable history id.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moreHistoryId, moreOpen]);

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
      <main id="main-content" ref={mainRef} tabIndex="-1" className="hibi-main"><div className="route-stage" key={activePage}>{children}</div></main>
    </section>
    <nav className="hibi-mobile-nav" aria-label="Mobile navigation">
      {primary.map((item) => { const Icon = item.icon; return <a key={item.id} href={item.href} onClick={(event) => go(event, item.id)} className={activePage === item.id ? "mobile-link active" : "mobile-link"}><Icon size={20}/><span>{item.label}</span></a>; })}
      <button ref={moreButtonRef} className={secondaryActive || moreOpen ? "mobile-link active" : "mobile-link"} type="button" aria-expanded={moreOpen} aria-controls={moreHistoryId} onClick={() => moreOpen ? closeMore() : setMoreOpen(true)}><Ellipsis size={21}/><span>More</span></button>
    </nav>
    {moreOpen ? <div ref={moreRef} id={moreHistoryId} className="mobile-more" role="dialog" aria-modal="true" aria-label="More navigation"><div className="mobile-more-head"><strong>More</strong><button type="button" aria-label="Close menu" onClick={closeMore}><X size={18}/></button></div>{secondary.map((item) => { const Icon = item.icon; return <a key={item.id} href={item.href} onClick={(event) => go(event, item.id)} className={activePage === item.id ? "sidebar-link active" : "sidebar-link"}><Icon size={19}/>{item.label}</a>; })}</div> : null}
  </div>;
}

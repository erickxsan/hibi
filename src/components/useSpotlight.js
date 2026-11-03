import { useCallback, useEffect, useState } from "react";

/** How long a spotlit row stays marked; the CSS animation fades it out within the same time. */
export const SPOTLIGHT_MS = 2600;

/**
 * Marks what an Inicio alert points at once its page opens: the students it names, a monthly fee or a class.
 * `light({ kind, ids })` stamps them for a moment and, with `scroll`, brings the first visible one into view;
 * `spotlit(kind, id)` is the class name each row adds.
 * @param {{ scroll?: boolean }} [options]
 */
export function useSpotlight({ scroll = true } = {}) {
  const [spot, setSpot] = useState(/** @type {{ kind: string, ids: Set<string> } | null} */ (null));
  const light = useCallback((next) => {
    if (next?.kind && next.ids?.length) setSpot({ kind: next.kind, ids: new Set(next.ids) });
  }, []);
  useEffect(() => {
    const win = globalThis.window;
    if (!spot || !win) return undefined;
    const frame = scroll
      ? win.requestAnimationFrame(() => {
          // Phone and desktop render different markup; only one of them is on screen.
          const target = [...win.document.querySelectorAll(".is-spotlit")].find(
            (element) => element.getClientRects().length,
          );
          const reduce = win.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
          target?.scrollIntoView?.({ block: "center", behavior: reduce ? "auto" : "smooth" });
        })
      : null;
    const timer = win.setTimeout(() => setSpot(null), SPOTLIGHT_MS);
    return () => {
      if (frame !== null) win.cancelAnimationFrame(frame);
      win.clearTimeout(timer);
    };
  }, [scroll, spot]);
  const spotlit = useCallback(
    (kind, id) => (spot?.kind === kind && spot.ids.has(String(id)) ? "is-spotlit" : ""),
    [spot],
  );
  return { light, spotlit };
}

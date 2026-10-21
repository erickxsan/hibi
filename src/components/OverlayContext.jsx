import { createContext, useEffect, useState } from "react";

export const OverlayDepthContext = createContext(0);

export function useCompactViewport() {
  const [compact, setCompact] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 780px)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(max-width: 780px)");
    const update = () => setCompact(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);
  return compact;
}

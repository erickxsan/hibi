import { useContext, useEffect, useState } from "react";
import { Drawer } from "./Drawer";
import { OverlayDepthContext, useCompactViewport } from "./OverlayContext";
import { useI18n } from "../i18n";

/** Shared anchored menu / mobile sheet; uses the existing dialog, history and focus lifecycle. */
export function PickerPopover({ open, onClose, triggerRef, title, children, className = "", onKeyDown = undefined }) {
  const { t } = useI18n();
  const mobile = useCompactViewport();
  const depth = useContext(OverlayDepthContext);
  const [position, setPosition] = useState({});
  useEffect(() => {
    if (!open || mobile) return undefined;
    const update = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(Math.max(rect.width, 300), window.innerWidth - 20);
      const above = window.innerHeight - rect.bottom < 380 && rect.top > window.innerHeight - rect.bottom;
      setPosition({
        position: "fixed",
        width,
        minWidth: 0,
        maxHeight: Math.min(520, Math.max(120, above ? rect.top - 16 : window.innerHeight - rect.bottom - 16)),
        left: Math.max(10, Math.min(rect.left, window.innerWidth - width - 10)),
        top: above ? undefined : Math.min(window.innerHeight - 40, rect.bottom + 6),
        bottom: above ? window.innerHeight - rect.top + 6 : undefined,
      });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [mobile, open, triggerRef]);
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={title}
      presentation={mobile ? "sheet" : "popover"}
      showHeader={mobile}
      backLabel={mobile && depth ? t("Back") : undefined}
      onKeyDown={onKeyDown}
      className={`select-menu ${className}`.trim()}
      panelStyle={mobile ? undefined : position}
    >
      {children}
    </Drawer>
  );
}

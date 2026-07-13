import { useEffect, useRef } from "react";
import { getUiLanguage, translateUiText } from "../i18n";

export const DEFAULT_DISCARD_MESSAGE = "Discard your unsaved changes?";

export function draftSignature(value) {
  if (value == null) return "";
  return JSON.stringify(value);
}

export function draftChanged(current, baseline) {
  return draftSignature(current) !== draftSignature(baseline);
}

export function confirmDiscard(dirty, message = DEFAULT_DISCARD_MESSAGE) {
  if (!dirty) return true;
  if (typeof globalThis.confirm !== "function") return false;
  return globalThis.confirm(translateUiText(message, getUiLanguage()));
}

/**
 * Registers one page-level navigation blocker and protects browser refresh/close.
 * The latest dirty state is kept in a ref so callers do not repeatedly attach
 * global listeners while typing.
 */
export function useUnsavedChanges(registerNavigationBlocker, dirty, message = DEFAULT_DISCARD_MESSAGE) {
  const stateRef = useRef({ dirty, message });
  stateRef.current = { dirty, message };

  useEffect(() => {
    if (typeof registerNavigationBlocker !== "function") return undefined;
    return registerNavigationBlocker(() => (stateRef.current.dirty
      ? translateUiText(stateRef.current.message, getUiLanguage())
      : ""));
  }, [registerNavigationBlocker]);

  useEffect(() => {
    if (!dirty) return undefined;
    const handleBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    globalThis.addEventListener?.("beforeunload", handleBeforeUnload);
    return () => globalThis.removeEventListener?.("beforeunload", handleBeforeUnload);
  }, [dirty]);
}

import { useEffect, useRef } from "react";
import { getUiLanguage, translateUiText } from "../i18n";
import { readAppHistoryState } from "../navigation/appHistory";

export const DEFAULT_DISCARD_MESSAGE = "Discard your unsaved changes?";

export function draftSignature(value) {
  if (value == null) return "";
  return JSON.stringify(value);
}

export function draftChanged(current, baseline) {
  return draftSignature(current) !== draftSignature(baseline);
}

/**
 * The in-app «discard changes?» question: destructive, with «Seguir editando» as the safe answer.
 * `title` arrives already translated (blockers translate their own message).
 * @param {string} title
 * @returns {import("../components/ConfirmPrompt").ConfirmRequest}
 */
export function discardChangesRequest(title) {
  const language = getUiLanguage();
  return {
    title: title || translateUiText(DEFAULT_DISCARD_MESSAGE, language),
    description: translateUiText("The changes you haven't saved will be lost.", language),
    confirmLabel: translateUiText("Discard changes", language),
    cancelLabel: translateUiText("Keep editing", language),
    tone: "danger",
  };
}

function currentHistoryEntry() {
  return readAppHistoryState(globalThis.history?.state)?.entry;
}

/**
 * Call inside a guard that is blocking a browser Back/Forward move (the browser already shows the
 * destination entry; the history dispatcher then restores the previous one). The returned function
 * repeats the same move from wherever history stands now, so an asynchronous «discard?» answer can finish
 * what the teacher started. It returns false when there is nothing to replay.
 */
export function replayableHistoryMove() {
  const target = currentHistoryEntry();
  return () => {
    const current = currentHistoryEntry();
    if (!Number.isInteger(target) || !Number.isInteger(current) || target === current) return false;
    globalThis.history.go(target - current);
    return true;
  };
}

/**
 * One-shot permission for a navigation the teacher already approved in the in-app prompt. Guards call
 * `consume(target)` first; it is true once for the granted target and only for a short while.
 */
export function createNavigationPass() {
  /** @type {{ target: string, until: number } | null} */
  let pass = null;
  return {
    /** @param {string} target @param {number} [ttl] */
    grant(target, ttl = 2000) {
      pass = { target, until: Date.now() + ttl };
    },
    /** @param {string} target */
    consume(target) {
      const allowed = Boolean(pass) && pass.target === target && Date.now() <= pass.until;
      if (allowed) pass = null;
      return allowed;
    },
    clear() {
      pass = null;
    },
  };
}

/**
 * Registers one page-level navigation blocker and protects browser refresh/close.
 * The latest dirty state is kept in a ref so callers do not repeatedly attach
 * global listeners while typing. The app shell asks the in-app question for page
 * changes; refresh and tab close keep the browser's own `beforeunload` dialog.
 */
export function useUnsavedChanges(registerNavigationBlocker, dirty, message = DEFAULT_DISCARD_MESSAGE) {
  const stateRef = useRef({ dirty, message });
  stateRef.current = { dirty, message };

  useEffect(() => {
    if (typeof registerNavigationBlocker !== "function") return undefined;
    return registerNavigationBlocker(() =>
      stateRef.current.dirty ? translateUiText(stateRef.current.message, getUiLanguage()) : "",
    );
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

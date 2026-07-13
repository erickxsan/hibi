import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  APP_ROUTES,
  currentHistoryView,
  ensurePageHistory,
  pageFromPath,
  pathForPage,
  pushPageHistory,
  pushViewHistory,
  replacePageHistory,
  replaceViewHistory,
  subscribeToAppHistory,
} from "../navigation/appHistory";

const useBrowserLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

function allowedValue(value, allowedValues) {
  return typeof value === "string" && (!allowedValues || allowedValues.includes(value));
}

/**
 * URL-backed navigation for hibi's primary pages.
 *
 * `canNavigate` is intentionally synchronous so a feature-level dirty-form
 * guard can return false (or show window.confirm and return its result) before
 * either a click or browser Back changes the rendered page.
 */
export function usePageNavigation({
  routes = APP_ROUTES,
  defaultPage = "home",
  canNavigate,
  onPageChange,
} = {}) {
  const [page, setPage] = useState(() => {
    if (typeof window === "undefined") return defaultPage;
    return pageFromPath(window.location.pathname, routes) ?? defaultPage;
  });
  const [navigationReason, setNavigationReason] = useState("initial");
  const pageRef = useRef(page);
  const routesRef = useRef(routes);
  const canNavigateRef = useRef(canNavigate);
  const onPageChangeRef = useRef(onPageChange);
  routesRef.current = routes;
  canNavigateRef.current = canNavigate;
  onPageChangeRef.current = onPageChange;

  useBrowserLayoutEffect(() => {
    const canonicalPage = pageFromPath(window.location.pathname, routesRef.current) ?? defaultPage;
    pageRef.current = canonicalPage;
    if (canonicalPage !== page) setPage(canonicalPage);
    ensurePageHistory(canonicalPage, routesRef.current);

    return subscribeToAppHistory({
      beforePop: ({ pathname }) => {
        const nextPage = pageFromPath(pathname, routesRef.current);
        if (!nextPage || nextPage === pageRef.current) return true;
        return canNavigateRef.current?.({
          from: pageRef.current,
          to: nextPage,
          reason: "popstate",
        }) !== false;
      },
      onPop: ({ pathname }) => {
        const nextPage = pageFromPath(pathname, routesRef.current);
        if (!nextPage || nextPage === pageRef.current) return;
        const previousPage = pageRef.current;
        pageRef.current = nextPage;
        setNavigationReason("popstate");
        setPage(nextPage);
        onPageChangeRef.current?.(nextPage, { from: previousPage, reason: "popstate" });
      },
    });
  // The refs deliberately keep this subscription stable while callbacks change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultPage]);

  const navigate = useCallback((nextPage, { replace = false } = {}) => {
    if (!pathForPage(nextPage, routesRef.current)) return false;
    const previousPage = pageRef.current;
    if (nextPage === previousPage) return true;
    if (canNavigateRef.current?.({ from: previousPage, to: nextPage, reason: replace ? "replace" : "push" }) === false) {
      return false;
    }

    const historyState = replace
      ? replacePageHistory(nextPage, routesRef.current)
      : pushPageHistory(nextPage, routesRef.current);
    if (!historyState) return false;
    pageRef.current = nextPage;
    setNavigationReason(replace ? "replace" : "push");
    setPage(nextPage);
    onPageChangeRef.current?.(nextPage, { from: previousPage, reason: replace ? "replace" : "push" });
    return true;
  }, []);

  return { page, navigate, navigationReason };
}

/**
 * Gives a feature's finite UI mode its own same-URL history entries. Store only
 * enum-like values here (for example "students"/"groups"), never draft data.
 *
 * Example:
 *   const changeTab = useHistoryBackedState({
 *     key: "setup-tab", value: tab, onChange: setTab,
 *     defaultValue: "students", allowedValues: ["students", "groups", "preferences"],
 *   });
 */
export function useHistoryBackedState({
  key,
  value,
  onChange,
  defaultValue,
  allowedValues,
  canChange,
  enabled = true,
}) {
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const canChangeRef = useRef(canChange);
  const allowedValuesRef = useRef(allowedValues);
  valueRef.current = value;
  onChangeRef.current = onChange;
  canChangeRef.current = canChange;
  allowedValuesRef.current = allowedValues;

  useEffect(() => {
    if (!enabled || !key) return undefined;
    const restored = currentHistoryView(key);
    if (allowedValue(restored, allowedValuesRef.current) && restored !== valueRef.current) {
      valueRef.current = restored;
      onChangeRef.current?.(restored, { reason: "restore" });
    } else if (!allowedValue(restored, allowedValuesRef.current) && allowedValue(defaultValue, allowedValuesRef.current)) {
      replaceViewHistory(key, defaultValue);
    }

    return subscribeToAppHistory({
      beforePop: ({ next }) => {
        const nextValue = next?.views?.[key] ?? defaultValue;
        if (!allowedValue(nextValue, allowedValuesRef.current) || nextValue === valueRef.current) return true;
        return canChangeRef.current?.({ from: valueRef.current, to: nextValue, reason: "popstate" }) !== false;
      },
      onPop: ({ next }) => {
        const nextValue = next?.views?.[key] ?? defaultValue;
        if (!allowedValue(nextValue, allowedValuesRef.current) || nextValue === valueRef.current) return;
        const previousValue = valueRef.current;
        valueRef.current = nextValue;
        onChangeRef.current?.(nextValue, { from: previousValue, reason: "popstate" });
      },
    });
  }, [defaultValue, enabled, key]);

  return useCallback((nextValue, { replace = false } = {}) => {
    if (!enabled || !allowedValue(nextValue, allowedValuesRef.current)) return false;
    const previousValue = valueRef.current;
    if (nextValue === previousValue) return true;
    if (canChangeRef.current?.({ from: previousValue, to: nextValue, reason: replace ? "replace" : "push" }) === false) {
      return false;
    }
    const historyState = replace
      ? replaceViewHistory(key, nextValue)
      : pushViewHistory(key, nextValue);
    if (!historyState) return false;
    valueRef.current = nextValue;
    onChangeRef.current?.(nextValue, { from: previousValue, reason: replace ? "replace" : "push" });
    return true;
  }, [enabled, key]);
}

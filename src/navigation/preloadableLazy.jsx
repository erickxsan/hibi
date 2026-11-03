import { lazy, useState } from "react";

/**
 * React.lazy that skips Suspense once its chunk has loaded. A plain lazy component suspends on its first render
 * even when the idle prefetch already downloaded the chunk, and React then holds «Cargando…» on screen for about
 * 300 ms before revealing the page. `load` resolves the module and remembers it, so later mounts render at once.
 * @param {() => Promise<{ default: import("react").ComponentType<any> }>} loader
 */
export function preloadableLazy(loader) {
  /** @type {import("react").ComponentType<any> | null} */
  let loaded = null;
  /** @type {Promise<{ default: import("react").ComponentType<any> }> | null} */
  let pending = null;
  const load = () => {
    pending ||= loader().then(
      (module) => {
        loaded = module.default;
        return module;
      },
      (error) => {
        // A failed chunk can be tried again on the next visit.
        pending = null;
        throw error;
      },
    );
    return pending;
  };
  const Lazy = lazy(load);
  /** @param {any} props */
  function Section(props) {
    // Decided once per mount: switching from Lazy to the loaded component later would remount it and lose state.
    const [Ready] = useState(() => loaded);
    return Ready ? <Ready {...props} /> : <Lazy {...props} />;
  }
  Section.load = load;
  return Section;
}

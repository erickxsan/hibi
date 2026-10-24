// Applies the saved «Apariencia» before the first paint, so a dark choice never flashes the light theme.
// index.html loads this as a blocking classic script in <head>: the CSP (public/_headers) only allows
// same-origin scripts, so it cannot be inline. src/theme/appearance.js owns the same rules after start-up;
// src/theme/darkTheme.contract.test.js keeps the two in step.
(function () {
  let preference = "system";
  try {
    const saved = localStorage.getItem("hibi:appearance:v1");
    if (saved === "light" || saved === "dark") preference = saved;
  } catch {
    // Storage can be unavailable in private or hardened contexts; follow the system.
  }
  const root = document.documentElement;
  if (preference === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", preference);
  let dark = preference === "dark";
  if (preference === "system") {
    try {
      dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    } catch {
      dark = false;
    }
  }
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#131114" : "#f6f1e8");
  // The canvas colour before the stylesheet applies.
  document
    .querySelector('meta[name="color-scheme"]')
    ?.setAttribute("content", preference === "system" ? "light dark" : preference);
})();

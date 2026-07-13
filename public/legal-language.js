(function () {
  const storageKey = "hibi:language:v1";
  const buttons = Array.from(document.querySelectorAll("[data-set-language]"));
  const sections = Array.from(document.querySelectorAll("[data-language]"));

  function preferredLanguage() {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved === "en" || saved === "es") return saved;
    } catch {
      // Use the browser language when storage is unavailable.
    }
    return navigator.language.toLowerCase().startsWith("es") ? "es" : "en";
  }

  function applyLanguage(language) {
    const next = language === "es" ? "es" : "en";
    document.documentElement.lang = next;
    for (const section of sections) section.hidden = section.dataset.language !== next;
    for (const button of buttons) {
      const active = button.dataset.setLanguage === next;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    }
    document.title = document.body.dataset.page === "privacy"
      ? (next === "es" ? "Privacidad — hibi" : "Privacy — hibi")
      : (next === "es" ? "Términos — hibi" : "Terms — hibi");
    try {
      localStorage.setItem(storageKey, next);
    } catch {
      // The selection still works for the current page.
    }
  }

  for (const button of buttons) button.addEventListener("click", () => applyLanguage(button.dataset.setLanguage));
  applyLanguage(preferredLanguage());
})();

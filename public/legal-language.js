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
    document.querySelector(".legal-language-toggle")?.setAttribute("aria-label", next === "es" ? "Idioma" : "Language");
    const description = document.body.dataset.page === "privacy"
      ? (next === "es" ? "Cómo trata Hibi los datos de tu cuenta y de tus clases." : "How hibi handles account and class-management data.")
      : (next === "es" ? "Términos de uso de Hibi para la gestión de clases." : "Terms for using the hibi class-management service.");
    document.querySelector('meta[name="description"]')?.setAttribute("content", description);
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

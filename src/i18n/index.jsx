import { createContext, useContext, useLayoutEffect, useMemo, useState } from "react";
import { Languages } from "lucide-react";
import { LANGUAGE_STORAGE_KEY, SUPPORTED_LANGUAGES, translateUiText } from "./translations";

const I18nContext = createContext(null);
/** @type {"en" | "es"} */
let activeLanguage = SUPPORTED_LANGUAGES.ENGLISH;
const UI_PARAMETER = Symbol("ui-parameter");
// Use only for application-owned enum/plural text. Names and notes stay plain strings.
export function uiText(value) {
  return { [UI_PARAMETER]: true, value: String(value) };
}

function initialLanguage() {
  try {
    const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (saved === SUPPORTED_LANGUAGES.ENGLISH || saved === SUPPORTED_LANGUAGES.SPANISH) return saved;
  } catch {
    // Browser storage can be unavailable in hardened or private contexts.
  }
  return globalThis.navigator?.language?.toLowerCase().startsWith("es")
    ? SUPPORTED_LANGUAGES.SPANISH
    : SUPPORTED_LANGUAGES.ENGLISH;
}

// Only UI sources are translated. String parameters remain opaque user data.
export function translateMessage(key, parameters = {}, language = activeLanguage) {
  const values = [];
  const source = String(key ?? "").replace(/\{(\w+)\}/g, (token, name) => {
    if (!(name in parameters)) return token;
    const value = parameters[name];
    if (value?.[UI_PARAMETER]) return value.value;
    if (typeof value === "number") return String(value);
    const marker = `__HIBI_PARAM_${values.length}__`;
    values.push([marker, String(value ?? "")]);
    return marker;
  });
  const trimmed = source.trim();
  let result =
    source.slice(0, source.indexOf(trimmed)) +
    translateUiText(trimmed, language) +
    source.slice(source.indexOf(trimmed) + trimmed.length);
  for (const [marker, value] of values) result = result.replaceAll(marker, value);
  return result;
}

export function getUiLanguage() {
  return activeLanguage;
}

export function getUiLocale() {
  return activeLanguage === SUPPORTED_LANGUAGES.SPANISH ? "es-MX" : "en-MX";
}

export function I18nProvider({ children }) {
  const [language, setLanguageState] = useState(initialLanguage);
  activeLanguage = language;

  const setLanguage = (nextLanguage) => {
    if (nextLanguage !== SUPPORTED_LANGUAGES.ENGLISH && nextLanguage !== SUPPORTED_LANGUAGES.SPANISH) return;
    activeLanguage = nextLanguage;
    setLanguageState(nextLanguage);
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, nextLanguage);
    } catch {
      // The in-memory preference still works for this session.
    }
  };

  useLayoutEffect(() => {
    document.documentElement.lang = language;
    document.title =
      language === SUPPORTED_LANGUAGES.SPANISH ? "hibi — Enseñando, día a día" : "hibi — Teaching, day by day";
  }, [language]);

  const value = useMemo(
    () => ({
      language,
      locale: language === SUPPORTED_LANGUAGES.SPANISH ? "es-MX" : "en-MX",
      setLanguage,
      t: (key, parameters) => translateMessage(key, parameters, language),
    }),
    [language],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const value = useContext(I18nContext);
  return (
    value || {
      language: "en",
      locale: "en-MX",
      setLanguage: () => {},
      t: (key, parameters) => translateMessage(key, parameters, "en"),
    }
  );
}

export function LanguageToggle({ className = "" }) {
  const { language, setLanguage, t } = useI18n();
  return (
    <div className={`language-toggle ${className}`.trim()} role="group" aria-label={t("Language")}>
      <Languages aria-hidden="true" size={16} />
      <button
        type="button"
        className={language === "en" ? "is-active" : ""}
        aria-pressed={language === "en"}
        onClick={() => setLanguage("en")}
      >
        EN
      </button>
      <button
        type="button"
        className={language === "es" ? "is-active" : ""}
        aria-pressed={language === "es"}
        onClick={() => setLanguage("es")}
      >
        ES
      </button>
    </div>
  );
}

export { SUPPORTED_LANGUAGES, translateUiText } from "./translations";

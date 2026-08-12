import { createContext, useContext, useLayoutEffect, useMemo, useState } from "react";
import { Languages } from "lucide-react";
import { LANGUAGE_STORAGE_KEY, SUPPORTED_LANGUAGES, translateUiText } from "./translations";

const I18nContext = createContext(null);
const TRANSLATED_ATTRIBUTES = ["aria-label", "placeholder", "title", "alt"];
const textOriginals = new WeakMap();
const attributeOriginals = new WeakMap();
let activeLanguage = SUPPORTED_LANGUAGES.ENGLISH;

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

function preserveWhitespace(source, translated) {
  const leading = source.match(/^\s*/)?.[0] ?? "";
  const trailing = source.match(/\s*$/)?.[0] ?? "";
  return `${leading}${translated}${trailing}`;
}

function translateTextNode(node, language) {
  const current = node.nodeValue ?? "";
  const stored = textOriginals.get(node);
  let source = stored ?? current;
  if (language === SUPPORTED_LANGUAGES.SPANISH && stored !== undefined) {
    const storedTranslation = preserveWhitespace(stored, translateUiText(stored.trim(), language));
    if (current !== storedTranslation) {
      source = current;
      textOriginals.set(node, current);
    }
  }
  const trimmed = source.trim();
  if (!trimmed) return;
  if (language === SUPPORTED_LANGUAGES.ENGLISH) {
    if (stored !== undefined && current !== stored) node.nodeValue = stored;
    return;
  }
  const translated = translateUiText(trimmed, language);
  if (translated === trimmed) return;
  if (stored === undefined) textOriginals.set(node, current);
  const next = preserveWhitespace(source, translated);
  if (current !== next) node.nodeValue = next;
}

function translateElementAttributes(element, language) {
  let originals = attributeOriginals.get(element);
  for (const attribute of TRANSLATED_ATTRIBUTES) {
    if (!element.hasAttribute(attribute)) continue;
    const current = element.getAttribute(attribute) ?? "";
    const stored = originals?.get(attribute);
    let source = stored ?? current;
    if (language === SUPPORTED_LANGUAGES.ENGLISH) {
      if (stored !== undefined && current !== stored) element.setAttribute(attribute, stored);
      continue;
    }
    if (stored !== undefined && current !== translateUiText(stored, language)) {
      source = current;
      originals.set(attribute, current);
    }
    const translated = translateUiText(source, language);
    if (translated === source) continue;
    if (!originals) {
      originals = new Map();
      attributeOriginals.set(element, originals);
    }
    if (!originals.has(attribute)) originals.set(attribute, current);
    if (current !== translated) element.setAttribute(attribute, translated);
  }
}

function translateSubtree(root, language) {
  if (!root) return;
  if (root.nodeType === Node.TEXT_NODE) {
    translateTextNode(root, language);
    return;
  }
  if (!(root instanceof Element || root instanceof DocumentFragment || root instanceof Document)) return;
  if (root instanceof Element) translateElementAttributes(root, language);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) translateTextNode(node, language);
    else translateElementAttributes(node, language);
    node = walker.nextNode();
  }
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

    const translate = (root = document.body) => translateSubtree(root, language);
    translate();
    let scheduled = false;
    let active = true;
    const observerOptions = {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: TRANSLATED_ATTRIBUTES,
    };
    const observer = new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        if (!active) return;
        observer.disconnect();
        translate();
        observer.observe(document.body, observerOptions);
      });
    });
    observer.observe(document.body, observerOptions);
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [language]);

  const value = useMemo(
    () => ({
      language,
      locale: language === SUPPORTED_LANGUAGES.SPANISH ? "es-MX" : "en-MX",
      setLanguage,
      t: (value) => translateUiText(value, language),
    }),
    [language],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside I18nProvider");
  return value;
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

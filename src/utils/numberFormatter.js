/** Reuse one formatter per display format; rebuild it when the UI locale changes. */
export function createNumberFormatter(options) {
  let formatter;
  let currentLocale;

  return (value, locale) => {
    if (!formatter || currentLocale !== locale) {
      formatter = new Intl.NumberFormat(locale, options);
      currentLocale = locale;
    }
    return formatter.format(value);
  };
}

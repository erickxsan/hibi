import { useI18n } from "../i18n/index.jsx";

/** Horizontal logo: the seal with ears beside the «hibi» wordmark. */
export function HibiLogo({ className = "", height = 40 }) {
  return (
    <img className={`hibi-logo ${className}`.trim()} src="/brand/hibi-logo-horizontal.svg" alt="hibi" height={height} />
  );
}

/** The cat stamp mascot. Decorative unless a label is given. */
export function HibiStamp({ className = "", size = 52, label = "" }) {
  const { t: uiT } = useI18n();
  return (
    <img
      className={`hibi-stamp ${className}`.trim()}
      src="/brand/hibi-gato-sello.svg"
      alt={label ? uiT(label) : ""}
      width={size}
      height={size}
    />
  );
}

// Kept for legacy callers: the stamp replaces the former line-drawn cat mark.
export function BrandMark() {
  return <HibiStamp size={40} />;
}

/** @param {import("./ui.types").ButtonProps} props */
export function Button({ children, variant = "secondary", icon: Icon, className = "", ...props }) {
  const accessibleName = props["aria-label"] || (typeof children === "string" ? children : undefined);
  return (
    <button
      className={`button button-${variant} ${className}`.trim()}
      type="button"
      aria-label={accessibleName}
      {...props}
    >
      {Icon ? <Icon aria-hidden="true" size={18} strokeWidth={1.8} /> : null}
      <span>{children}</span>
    </button>
  );
}

/** @param {import("./ui.types").IconButtonProps} props */
export function IconButton({ label, icon: Icon, className = "", ...props }) {
  return (
    <button className={`icon-button ${className}`.trim()} type="button" aria-label={label} title={label} {...props}>
      <Icon aria-hidden="true" size={19} strokeWidth={1.8} />
    </button>
  );
}

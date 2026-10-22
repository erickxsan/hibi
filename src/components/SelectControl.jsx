import { useI18n } from "../i18n/index.jsx";
import { Children, isValidElement, useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, LoaderCircle, Search, UsersRound, X } from "lucide-react";
import { normalizeSearchText } from "../utils/searchText";
import { StudentAvatar } from "./StudentAvatar";
import { PickerPopover } from "./PickerPopover";

function optionLabel(children) {
  return Children.toArray(children)
    .map((child) => {
      if (typeof child === "string" || typeof child === "number") return String(child);
      return isValidElement(child)
        ? optionLabel(
            /** @type {import("react").ReactElement<{children?: import("react").ReactNode}>} */ (child).props.children,
          )
        : "";
    })
    .join("");
}

function optionsFromChildren(children) {
  const options = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    if (child.type === "option") {
      const label = optionLabel(child.props.children);
      options.push({
        value: String(child.props.value ?? label),
        label,
        disabled: Boolean(child.props.disabled),
        avatarId: child.props["data-avatar-id"],
        meta: child.props["data-meta"],
        detail: child.props["data-detail"],
        mark: child.props["data-mark"],
      });
      return;
    }
    options.push(...optionsFromChildren(child.props.children));
  });
  return options;
}

function OptionArtwork({ option, variant }) {
  if (option.value === "") return null;
  if (option.avatarId || variant === "student") {
    return <StudentAvatar avatarId={option.avatarId || "cat"} name={option.label} size="tiny" decorative />;
  }
  if (variant === "group")
    return (
      <span className="select-mark" aria-hidden="true">
        {option.mark || <UsersRound size={17} />}
      </span>
    );
  return null;
}

function ChoiceControl({
  options,
  value = "",
  onChange = undefined,
  multiple = false,
  disabled = false,
  loading = false,
  searchable = false,
  searchThreshold = 8,
  variant = "standard",
  className = "",
  emptyMessage = "No options found",
  placeholder = "Choose an option",
  small = false,
  ...props
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const triggerRef = useRef(null);
  const searchRef = useRef(null);
  const listId = useId();
  const selectedValues = (multiple && Array.isArray(value) ? value : [value ?? ""]).map(String);
  const selected = options.filter((option) => selectedValues.includes(String(option.value)));
  const shouldSearch = searchable || options.length >= searchThreshold;
  const filtered = useMemo(() => {
    const needle = normalizeSearchText(query);
    return options
      .map((option) => ({ ...option, value: String(option.value) }))
      .filter((option) => !needle || normalizeSearchText(`${option.label} ${option.meta || ""}`).includes(needle));
  }, [options, query]);
  useEffect(() => {
    if (disabled) setOpen(false);
    if (!open || disabled) setQuery("");
  }, [disabled, open]);
  useEffect(() => {
    if (!open) return undefined;
    const timer = setTimeout(() => (shouldSearch ? searchRef.current : document.getElementById(listId))?.focus(), 0);
    return () => clearTimeout(timer);
  }, [listId, open, shouldSearch]);
  const choose = (index) => {
    const option = filtered[index];
    if (disabled || loading || !option || option.disabled) return;
    if (multiple)
      onChange(
        selectedValues.includes(option.value)
          ? selectedValues.filter((item) => item !== option.value)
          : [...selectedValues, option.value],
      );
    else {
      const target = { value: option.value, ...(props.name ? { name: props.name } : {}) };
      onChange?.({ target, currentTarget: target });
      setOpen(false);
    }
  };
  const move = (direction, from = activeIndex) => {
    for (let i = 1; i <= filtered.length; i++) {
      const index = (from + i * direction + filtered.length * 2) % filtered.length;
      if (!filtered[index].disabled) {
        setActiveIndex(index);
        return;
      }
    }
  };
  const keyDown = (event) => {
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const direction = event.key === "ArrowUp" || event.key === "End" ? -1 : 1;
      move(direction, event.key === "Home" ? -1 : event.key === "End" ? 0 : activeIndex);
    } else if (event.key === "Enter" || (event.key === " " && event.target !== searchRef.current)) {
      event.preventDefault();
      choose(activeIndex);
    }
  };
  const openMenu = () => {
    setActiveIndex(
      Math.max(
        0,
        options.findIndex((option) => selectedValues.includes(String(option.value)) && !option.disabled),
      ),
    );
    setOpen(true);
  };
  const title = props["aria-label"] || props.ariaLabel || t("Choose an option");
  return (
    <span
      className={`select-menu-wrap select-wrap ${multiple ? "multi-select" : ""} select-${variant} ${open ? "is-open" : ""} ${className}`.trim()}
    >
      {props.name ? (
        <input type="hidden" name={props.name} value={selectedValues.join(",")} disabled={disabled} />
      ) : null}
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        disabled={disabled || loading}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={props["aria-label"] || props.ariaLabel}
        aria-labelledby={props["aria-labelledby"]}
        aria-describedby={props["aria-describedby"]}
        aria-invalid={props["aria-invalid"]}
        aria-required={props.required || props["aria-required"]}
        className={`select-trigger-hibi select-trigger ${open ? "is-open" : ""} ${!multiple && selected[0]?.meta ? "is-two-line" : ""} ${small ? "is-small" : ""}`}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={(event) => {
          if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
            event.preventDefault();
            openMenu();
          } else if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
            const index = options.findIndex(
              (option) =>
                !option.disabled && normalizeSearchText(option.label).startsWith(normalizeSearchText(event.key)),
            );
            if (index >= 0) {
              setActiveIndex(index);
              setOpen(true);
            }
          }
        }}
      >
        {loading ? (
          <LoaderCircle className="select-spinner" size={18} aria-hidden="true" />
        ) : !multiple && selected[0] ? (
          <OptionArtwork option={selected[0]} variant={variant} />
        ) : null}
        <span className="select-value">
          <strong>
            {multiple
              ? selected.length
                ? selected.map((option) => option.label).join(", ")
                : t(placeholder)
              : selected[0]?.label || t(placeholder)}
          </strong>
          {!multiple && selected[0]?.meta ? <small>{selected[0].meta}</small> : null}
        </span>
        <ChevronDown className="select-chevron" aria-hidden="true" size={18} />
      </button>
      {multiple ? (
        <span className="multi-select-summary">
          <span>{selected.length ? t("{p0} selected", { p0: selected.length }) : t("None selected")}</span>
          {selected.length ? (
            <button type="button" className="link-button" disabled={disabled} onClick={() => onChange([])}>
              {t("Clear")}
            </button>
          ) : null}
        </span>
      ) : null}
      {multiple && selected.length ? (
        <span className="multi-select-values">
          {selected.map((option) => (
            <button
              type="button"
              key={option.value}
              className="multi-select-chip"
              disabled={disabled}
              aria-label={t("Remove {p0}", { p0: option.label })}
              onClick={() => onChange(selectedValues.filter((item) => item !== String(option.value)))}
            >
              <span>{option.label}</span>
              <X size={13} aria-hidden="true" />
            </button>
          ))}
        </span>
      ) : null}
      <PickerPopover
        open={open && !disabled}
        onClose={() => setOpen(false)}
        triggerRef={triggerRef}
        title={title}
        className="select-popover"
        onKeyDown={keyDown}
      >
        {shouldSearch ? (
          <label className="select-search">
            <Search size={17} aria-hidden="true" />
            <input
              ref={searchRef}
              role="combobox"
              aria-label={t("Search options")}
              aria-expanded="true"
              aria-controls={listId}
              aria-activedescendant={filtered[activeIndex] ? `${listId}-${activeIndex}` : undefined}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveIndex(0);
              }}
              placeholder={t("Search…")}
              autoComplete="off"
            />
          </label>
        ) : null}
        <div
          id={listId}
          className="select-options"
          role="listbox"
          aria-label={t("Options")}
          aria-multiselectable={multiple || undefined}
          tabIndex={0}
          aria-activedescendant={filtered[activeIndex] ? `${listId}-${activeIndex}` : undefined}
        >
          {filtered.map((option, index) => (
            <button
              type="button"
              role="option"
              id={`${listId}-${index}`}
              key={option.value}
              tabIndex={-1}
              disabled={option.disabled}
              aria-selected={selectedValues.includes(option.value)}
              className={`select-option ${selectedValues.includes(option.value) ? "is-selected" : ""} ${index === activeIndex ? "is-active" : ""}`}
              onPointerMove={() => setActiveIndex(index)}
              onClick={() => choose(index)}
            >
              <OptionArtwork option={option} variant={variant} />
              <span className="select-option-text">
                <strong>{option.label}</strong>
                {option.meta ? <small>{option.meta}</small> : null}
              </span>
              {option.detail ? <span className="select-option-meta">{option.detail}</span> : null}
              <Check className="select-check" aria-hidden="true" size={18} />
            </button>
          ))}
          {!filtered.length ? (
            <div className="select-message" role="status">
              {t(emptyMessage)}
            </div>
          ) : null}
        </div>
        {multiple ? (
          <button type="button" className="select-sheet-done" onClick={() => setOpen(false)}>
            {t("Done")}
          </button>
        ) : null}
      </PickerPopover>
    </span>
  );
}

// Existing Select callers retain their option children and change-event contract.
export function Select({ children, ...props }) {
  const options = useMemo(() => optionsFromChildren(children), [children]);
  return <ChoiceControl options={options} {...props} />;
}

export const SelectMenu = Select;

export function MultiSelect(props) {
  return <ChoiceControl {...props} multiple />;
}

export function GroupSelect({ groups, include = [], ...props }) {
  return (
    <Select {...props} variant="group">
      {[...include, ...groups].map((group) => (
        <option
          key={group.id}
          value={group.id}
          data-meta={group.meta}
          data-detail={group.detail}
          data-mark={group.mark}
        >
          {group.name}
        </option>
      ))}
    </Select>
  );
}

export function StudentSelect({ students, ...props }) {
  return (
    <Select {...props} variant="student">
      {students.map((student) => (
        <option
          key={student.id}
          value={student.id}
          data-avatar-id={student.avatarId}
          data-meta={student.code || student.meta}
          data-detail={student.detail}
        >
          {student.fullName || student.name}
        </option>
      ))}
    </Select>
  );
}

import { Children, isValidElement, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, LoaderCircle, Search, UsersRound, X } from "lucide-react";
import { closeOverlayHistory, pushOverlayHistory, subscribeToAppHistory } from "../navigation/appHistory";
import { normalizeSearchText } from "../utils/searchText";
import { StudentAvatar } from "./StudentAvatar";

function optionLabel(children) {
  return Children.toArray(children).map((child) => {
    if (typeof child === "string" || typeof child === "number") return String(child);
    return isValidElement(child) ? optionLabel(child.props.children) : "";
  }).join("");
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
  if (variant === "group") return <span className="select-option-icon" aria-hidden="true"><UsersRound size={17} /></span>;
  return null;
}

function useChoicePopover({ open, setOpen, triggerRef, menuRef, activeIndex, setActiveIndex, optionCount, onChoose, searchable }) {
  const overlayId = useId();
  const ownsHistory = useRef(false);
  const previousFocus = useRef(null);

  const close = (returnFocus = true) => {
    if (ownsHistory.current && closeOverlayHistory(overlayId)) return;
    setOpen(false);
    if (returnFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  };

  useEffect(() => {
    if (!open) return undefined;
    previousFocus.current = document.activeElement;
    const timer = window.setTimeout(() => { ownsHistory.current = Boolean(pushOverlayHistory(overlayId)); }, 0);
    const unsubscribe = subscribeToAppHistory({
      beforePop: ({ previous, next }) => {
        if (!previous?.overlays?.includes(overlayId) || next?.overlays?.includes(overlayId)) return true;
        ownsHistory.current = false;
        setOpen(false);
        requestAnimationFrame(() => triggerRef.current?.focus());
        return true;
      },
    });
    const onPointerDown = (event) => {
      if (triggerRef.current?.contains(event.target) || menuRef.current?.contains(event.target)) return;
      close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.clearTimeout(timer);
      unsubscribe();
      document.removeEventListener("pointerdown", onPointerDown);
      if (ownsHistory.current) closeOverlayHistory(overlayId);
      ownsHistory.current = false;
    };
  }, [menuRef, open, overlayId, setOpen, triggerRef]);

  const onKeyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === "Tab") {
      close(false);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((current) => {
        if (!optionCount) return -1;
        const next = current < 0 ? (direction > 0 ? 0 : optionCount - 1) : (current + direction + optionCount) % optionCount;
        requestAnimationFrame(() => document.getElementById(`${overlayId}-option-${next}`)?.scrollIntoView({ block: "nearest" }));
        return next;
      });
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setActiveIndex(event.key === "Home" ? 0 : Math.max(0, optionCount - 1));
      return;
    }
    if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      onChoose(activeIndex);
      return;
    }
    if (!searchable && event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
      // The trigger handles printable type-ahead before the menu opens. Keeping
      // focus in the list avoids swallowing screen-reader navigation keys here.
    }
  };

  return { close, onKeyDown, optionId: (index) => `${overlayId}-option-${index}` };
}

function usePopoverPosition(open, triggerRef) {
  const [position, setPosition] = useState({});
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    if (!open) return undefined;
    const update = () => {
      const compact = window.matchMedia("(max-width: 640px)").matches;
      setMobile(compact);
      if (compact || !triggerRef.current) return;
      const rect = triggerRef.current.getBoundingClientRect();
      const margin = 10;
      const width = Math.min(Math.max(rect.width, 260), window.innerWidth - margin * 2);
      const maxHeight = Math.min(340, window.innerHeight - margin * 2);
      const spaceBelow = window.innerHeight - rect.bottom - margin;
      const above = spaceBelow < 230 && rect.top > spaceBelow;
      setPosition({
        position: "fixed",
        left: Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin)),
        top: above ? undefined : rect.bottom + 7,
        bottom: above ? window.innerHeight - rect.top + 7 : undefined,
        width,
        maxHeight,
      });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, triggerRef]);
  return { mobile, position };
}

function ChoiceMenu({
  activeIndex,
  emptyMessage,
  filteredOptions,
  listId,
  loading,
  menuRef,
  mobile,
  multiple,
  onChoose,
  onClose,
  onKeyDown,
  optionId,
  position,
  query,
  searchable,
  selectedValues,
  setActiveIndex,
  setQuery,
  variant,
}) {
  const searchRef = useRef(null);
  useEffect(() => {
    const focusMenu = () => (searchable ? searchRef.current : menuRef.current)?.focus();
    focusMenu();
    const timer = window.setTimeout(focusMenu, 0);
    return () => window.clearTimeout(timer);
  }, [menuRef, mobile, searchable]);
  const list = (
    <div
      className={`select-popover ${mobile ? "select-sheet" : ""}`.trim()}
      ref={menuRef}
      style={mobile ? undefined : position}
      role={mobile ? "dialog" : (!searchable ? "listbox" : undefined)}
      aria-modal={mobile ? "true" : undefined}
      aria-label={mobile ? "Choose an option" : undefined}
      aria-multiselectable={!searchable && multiple ? "true" : undefined}
      aria-activedescendant={!searchable && activeIndex >= 0 ? optionId(activeIndex) : undefined}
      tabIndex={searchable ? -1 : 0}
      autoFocus={!searchable}
      onKeyDown={onKeyDown}
    >
      {mobile ? <div className="select-sheet-head"><span aria-hidden="true" /><strong>Choose an option</strong><button type="button" aria-label="Close selector" onClick={onClose}><X size={18} /></button></div> : null}
      {searchable ? (
        <label className="select-search">
          <Search aria-hidden="true" size={17} />
          <span className="sr-only">Search options</span>
          <input ref={searchRef} role="combobox" aria-label="Search options" aria-expanded="true" aria-controls={listId} aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined} value={query} onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }} placeholder="Search…" autoComplete="off" autoFocus />
          {query ? <button type="button" aria-label="Clear search" onClick={() => { setQuery(""); setActiveIndex(0); }}><X size={15} /></button> : null}
        </label>
      ) : null}
      <div id={listId} className="select-options" role={searchable || mobile ? "listbox" : "presentation"} aria-multiselectable={(searchable || mobile) && multiple ? "true" : undefined} aria-label={searchable || mobile ? "Options" : undefined}>
        {loading ? <div className="select-message" role="status"><LoaderCircle className="select-spinner" /><span>Loading options…</span></div> : null}
        {!loading && filteredOptions.map((option, index) => {
          const selected = selectedValues.includes(option.value);
          return (
            <button
              type="button"
              id={optionId(index)}
              key={`${option.value}-${index}`}
              role="option"
              aria-selected={selected}
              disabled={option.disabled}
              className={`select-option ${selected ? "is-selected" : ""} ${activeIndex === index ? "is-active" : ""}`.trim()}
              onPointerMove={() => setActiveIndex(index)}
              onClick={() => onChoose(index)}
              title={option.label}
            >
              <OptionArtwork option={option} variant={variant} />
              <span className="select-option-copy"><strong>{option.label}</strong>{option.meta ? <small>{option.meta}</small> : null}</span>
              {selected ? <Check className="select-option-check" aria-hidden="true" size={18} /> : null}
            </button>
          );
        })}
        {!loading && !filteredOptions.length ? <div className="select-message"><Search aria-hidden="true" /><strong>{emptyMessage}</strong><span>Try a different search.</span></div> : null}
      </div>
      {mobile && multiple ? <button type="button" className="select-sheet-done" onClick={onClose}>Done</button> : null}
    </div>
  );
  return mobile ? <div className="select-mobile-overlay" role="presentation">{list}</div> : list;
}

export function Select({
  className = "",
  children,
  disabled = false,
  emptyMessage = "No options found",
  loading = false,
  onChange,
  searchable = false,
  searchThreshold = 9,
  variant = "standard",
  value,
  ...props
}) {
  const options = useMemo(() => optionsFromChildren(children), [children]);
  const selectedValue = String(value ?? "");
  const selected = options.find((option) => option.value === selectedValue) || options[0];
  const shouldSearch = searchable || options.length >= searchThreshold;
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const listId = useId();
  const valueId = useId();
  const filteredOptions = useMemo(() => {
    const needle = normalizeSearchText(query);
    return needle ? options.filter((option) => normalizeSearchText(`${option.label} ${option.meta || ""}`).includes(needle)) : options;
  }, [options, query]);
  useEffect(() => { if (!open) setQuery(""); }, [open]);
  const { mobile, position } = usePopoverPosition(open, triggerRef);
  const choose = (index) => {
    const option = filteredOptions[index];
    if (!option || option.disabled) return;
    onChange?.({ target: { value: option.value, name: props.name }, currentTarget: { value: option.value, name: props.name } });
    setOpen(false);
    setQuery("");
    requestAnimationFrame(() => triggerRef.current?.focus());
  };
  const popover = useChoicePopover({ open, setOpen, triggerRef, menuRef, activeIndex, setActiveIndex, optionCount: filteredOptions.length, onChoose: choose, searchable: shouldSearch });

  const openMenu = (preferredIndex) => {
    if (disabled || loading) return;
    const selectedIndex = options.findIndex((option) => option.value === selectedValue);
    setActiveIndex(Number.isInteger(preferredIndex) ? preferredIndex : Math.max(0, selectedIndex));
    setOpen(true);
  };
  const onTriggerKeyDown = (event) => {
    if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      openMenu(event.key === "ArrowUp" ? Math.max(0, options.length - 1) : undefined);
      return;
    }
    if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
      const match = options.findIndex((option) => normalizeSearchText(option.label).startsWith(normalizeSearchText(event.key)));
      if (match >= 0) openMenu(match);
    }
  };

  return (
    <span className={`select-wrap select-${variant} ${open ? "is-open" : ""} ${props["aria-invalid"] ? "is-invalid" : ""} ${className}`.trim()}>
      <select className="select-native-input" value={selectedValue} onChange={() => {}} disabled={disabled} name={props.name} required={props.required} tabIndex={-1} aria-hidden="true">{children}</select>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        className="control select-trigger"
        disabled={disabled || loading}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={props["aria-label"]}
        aria-labelledby={!props["aria-label"] && props["aria-labelledby"] ? `${props["aria-labelledby"]} ${valueId}` : undefined}
        aria-invalid={props["aria-invalid"]}
        title={selected?.label}
        onClick={() => (open ? popover.close() : openMenu())}
        onKeyDown={onTriggerKeyDown}
      >
        {loading ? <LoaderCircle className="select-spinner" aria-hidden="true" size={17} /> : <OptionArtwork option={selected || {}} variant={variant} />}
        <span className="select-trigger-copy" id={valueId}><strong>{selected?.label || props.placeholder || "Choose an option"}</strong>{selected?.meta ? <small>{selected.meta}</small> : null}</span>
        <ChevronDown className="select-chevron" aria-hidden="true" size={17} strokeWidth={1.8} />
      </button>
      {open && typeof document !== "undefined" ? createPortal(
        <ChoiceMenu
          activeIndex={activeIndex}
          emptyMessage={emptyMessage}
          filteredOptions={filteredOptions}
          listId={listId}
          loading={loading}
          menuRef={menuRef}
          mobile={mobile}
          multiple={false}
          onChoose={choose}
          onClose={popover.close}
          onKeyDown={popover.onKeyDown}
          optionId={popover.optionId}
          position={position}
          query={query}
          searchable={shouldSearch}
          selectedValues={[selectedValue]}
          setActiveIndex={setActiveIndex}
          setQuery={setQuery}
          variant={variant}
        />,
        document.body,
      ) : null}
    </span>
  );
}

export function MultiSelect({
  ariaLabel,
  className = "",
  disabled = false,
  emptyMessage = "No options found",
  onChange,
  options,
  placeholder = "Choose options",
  searchable = true,
  value = [],
  variant = "standard",
}) {
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const listId = useId();
  const selectedValues = value.map(String);
  const selectedOptions = options.filter((option) => selectedValues.includes(String(option.value)));
  const filteredOptions = useMemo(() => {
    const needle = normalizeSearchText(query);
    return options.map((option) => ({ ...option, value: String(option.value) })).filter((option) => !needle || normalizeSearchText(`${option.label} ${option.meta || ""}`).includes(needle));
  }, [options, query]);
  useEffect(() => { if (!open) setQuery(""); }, [open]);
  const { mobile, position } = usePopoverPosition(open, triggerRef);
  const choose = (index) => {
    const option = filteredOptions[index];
    if (!option || option.disabled) return;
    const next = selectedValues.includes(option.value)
      ? selectedValues.filter((item) => item !== option.value)
      : [...selectedValues, option.value];
    onChange(next);
  };
  const popover = useChoicePopover({ open, setOpen, triggerRef, menuRef, activeIndex, setActiveIndex, optionCount: filteredOptions.length, onChoose: choose, searchable });
  const visible = selectedOptions.slice(0, 2);

  return (
    <div className={`multi-select ${open ? "is-open" : ""} ${disabled ? "is-disabled" : ""} ${className}`.trim()}>
      <div className="control multi-select-trigger" onClick={(event) => {
        if (disabled || event.target.closest(".multi-select-chip")) return;
        if (open) popover.close(); else setOpen(true);
      }}>
        <span className="multi-select-values">
          {!visible.length ? <span className="multi-select-placeholder">{placeholder}</span> : null}
          {visible.map((option) => <button type="button" className="multi-select-chip" key={option.value} aria-label={`Remove ${option.label}`} onClick={(event) => { event.stopPropagation(); onChange(selectedValues.filter((item) => item !== String(option.value))); }}>{variant === "student" ? <StudentAvatar avatarId={option.avatarId} name={option.label} size="micro" decorative /> : null}<span>{option.label}</span><X aria-hidden="true" size={13} /></button>)}
          {selectedOptions.length > visible.length ? <span className="multi-select-more">+{selectedOptions.length - visible.length} more</span> : null}
        </span>
        <button ref={triggerRef} className="multi-select-toggle" type="button" disabled={disabled} aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined} onClick={(event) => { event.stopPropagation(); if (open) popover.close(); else setOpen(true); }} onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => {
          if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)) {
            event.preventDefault();
            setActiveIndex(event.key === "ArrowUp" ? Math.max(0, filteredOptions.length - 1) : 0);
            setOpen(true);
          }
        }}><ChevronDown className="select-chevron" aria-hidden="true" size={17} /></button>
      </div>
      <div className="multi-select-summary"><span>{selectedOptions.length ? `${selectedOptions.length} selected` : "None selected"}</span>{selectedOptions.length ? <button type="button" onClick={() => onChange([])}>Clear</button> : null}</div>
      {open && typeof document !== "undefined" ? createPortal(
        <ChoiceMenu
          activeIndex={activeIndex}
          emptyMessage={emptyMessage}
          filteredOptions={filteredOptions}
          listId={listId}
          loading={false}
          menuRef={menuRef}
          mobile={mobile}
          multiple
          onChoose={choose}
          onClose={popover.close}
          onKeyDown={popover.onKeyDown}
          optionId={popover.optionId}
          position={position}
          query={query}
          searchable={searchable}
          selectedValues={selectedValues}
          setActiveIndex={setActiveIndex}
          setQuery={setQuery}
          variant={variant}
        />,
        document.body,
      ) : null}
    </div>
  );
}

export function GroupSelect({ groups, include = [], value, onChange, ...props }) {
  return <Select variant="group" searchable={groups.length > 7} value={value} onChange={onChange} {...props}>{[...include, ...groups].map((group) => <option key={group.id} value={group.id} data-meta={group.meta}>{group.name}</option>)}</Select>;
}

export function StudentSelect({ students, value, onChange, ...props }) {
  return <Select variant="student" searchable={students.length > 6} value={value} onChange={onChange} {...props}>{students.map((student) => <option key={student.id} value={student.id} data-avatar-id={student.avatarId} data-meta={student.code || student.meta}>{student.fullName || student.name}</option>)}</Select>;
}

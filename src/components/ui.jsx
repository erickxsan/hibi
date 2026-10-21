export { Button, IconButton } from "./BaseButtons";
export { Drawer, BottomSheet } from "./Drawer";
import { useI18n } from "../i18n/index.jsx";
import { Children, Fragment, cloneElement, isValidElement, useId } from "react";
import { Search } from "lucide-react";
import { DatePicker, TimePicker } from "./LazyPickers";
export { DatePicker, TimePicker, RepeatPicker } from "./LazyPickers";
export { GroupSelect, MultiSelect, Select, SelectMenu, StudentSelect } from "./SelectControl";

/** @param {import("./ui.types").FieldProps} props */
export function Field({ label, hint, error, required, children, className = "" }) {
  const { t: uiT } = useI18n();
  const labelId = useId();
  const hintId = `${labelId}-hint`;
  const errorId = `${labelId}-error`;
  const labelControls = (nodes) =>
    Children.map(nodes, (child) => {
      if (!isValidElement(child)) return child;
      if (child.type === Fragment) return cloneElement(child, {}, labelControls(child.props.children));
      if (typeof child.type === "string" && !["input", "select", "textarea"].includes(child.type)) {
        return child.props.children ? cloneElement(child, {}, labelControls(child.props.children)) : child;
      }
      return cloneElement(child, {
        "aria-labelledby": child.props["aria-labelledby"] || (child.props["aria-label"] ? undefined : labelId),
        "aria-invalid": error ? "true" : child.props["aria-invalid"],
        "aria-describedby":
          [child.props["aria-describedby"], error ? errorId : hint ? hintId : ""].filter(Boolean).join(" ") ||
          undefined,
        "aria-required": required ? "true" : child.props["aria-required"],
        ...((typeof child.type === "string" && ["input", "select", "textarea"].includes(child.type)) ||
        child.type === Input ||
        child.type === TextArea
          ? { required: Boolean(required || child.props.required) }
          : {}),
      });
    });
  const labelledChild = labelControls(children);
  return (
    <label className={`field ${className}`.trim()}>
      <span className="field-label" id={labelId}>
        {label}
        {required ? (
          <span className="req" aria-hidden="true">
            {" "}
            *
          </span>
        ) : null}
      </span>
      {labelledChild}
      {error ? (
        <span className="field-error" role="alert" id={errorId}>
          {uiT(error)}
        </span>
      ) : null}
      {!error && hint ? (
        <span className="field-hint" id={hintId}>
          {hint}
        </span>
      ) : null}
    </label>
  );
}

export function Input({ className = "", ...props }) {
  if (props.type === "date")
    return <DatePicker className={className} allowPast {...props} onChange={props.onChange || props.onInput} />;
  if (props.type === "time") return <TimePicker className={className} minMinutes={0} maxMinutes={1440} {...props} />;
  return <input className={`control ${className}`.trim()} {...props} />;
}

export function TextArea({ className = "", ...props }) {
  return <textarea className={`control textarea ${className}`.trim()} {...props} />;
}

export function SearchInput({ value, onChange, placeholder = "Search", className = "", ...props }) {
  const { t: uiT } = useI18n();
  return (
    <label className={`search-control ${className}`.trim()}>
      <Search aria-hidden="true" size={17} strokeWidth={1.8} />
      <span className="sr-only">{uiT("Search")}</span>
      <input value={value} onChange={onChange} placeholder={placeholder} {...props} />
    </label>
  );
}

export {
  StatusBadge,
  Tabs,
  TableShell,
  EmptyState,
  Switch,
  FieldRow,
  ListRow,
  AttendanceRing,
  ConfirmDialog,
  ToastRegion,
  SectionHeading,
  Segmented,
  AttendanceChoice,
  PaymentChoice,
  MoneyInput,
  DurationStepper,
} from "./uiPrimitives";

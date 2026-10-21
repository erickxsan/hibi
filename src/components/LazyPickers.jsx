import { lazy, Suspense } from "react";
import { LoaderCircle } from "lucide-react";
import { useI18n } from "../i18n";

const DateControl = lazy(() => import("./DateTimePickers").then((module) => ({ default: module.DatePicker })));
const TimeControl = lazy(() => import("./DateTimePickers").then((module) => ({ default: module.TimePicker })));
const RepeatControl = lazy(() => import("./RepeatPicker").then((module) => ({ default: module.RepeatPicker })));

function PendingControl(props) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      role="combobox"
      disabled
      aria-expanded="false"
      aria-busy="true"
      aria-label={props["aria-label"]}
      aria-labelledby={props["aria-labelledby"]}
      className="select-trigger-hibi"
    >
      <LoaderCircle className="select-spinner" size={18} aria-hidden="true" />
      <span>{t("Loading options…")}</span>
    </button>
  );
}

/** @param {import("./picker.types").DatePickerProps} props */
export function DatePicker(props) {
  return (
    <Suspense fallback={<PendingControl {...props} />}>
      <DateControl {...props} />
    </Suspense>
  );
}

/** @param {import("./picker.types").TimePickerProps} props */
export function TimePicker(props) {
  return (
    <Suspense fallback={<PendingControl {...props} />}>
      <TimeControl {...props} />
    </Suspense>
  );
}

export function RepeatPicker(props) {
  return (
    <Suspense fallback={<PendingControl {...props} />}>
      <RepeatControl {...props} />
    </Suspense>
  );
}

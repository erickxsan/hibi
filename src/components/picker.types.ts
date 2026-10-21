import type { InputHTMLAttributes } from "react";

export interface PickerProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value" | "min" | "max"> {
  value?: string;
  onChange?: (event: {
    target: { value: string; name?: string };
    currentTarget: { value: string; name?: string };
  }) => void;
}
export interface DatePickerProps extends PickerProps {
  today?: string;
  allowPast?: boolean;
  min?: string;
  max?: string;
  classDates?: string[];
  repeatDates?: string[];
}
export interface BusyBlock {
  start: number;
  end: number;
  label?: string;
}
export interface TimePickerProps extends PickerProps {
  durationMinutes?: number;
  busy?: BusyBlock[];
  minMinutes?: number;
  maxMinutes?: number;
}

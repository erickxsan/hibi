import type { ButtonHTMLAttributes, ElementType, ReactNode } from "react";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: string;
  icon?: ElementType;
}
export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  icon: ElementType;
}
export interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  children?: ReactNode;
  className?: string;
}
export interface DrawerProps {
  open: boolean;
  onClose: () => unknown;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: string;
  className?: string;
}
export interface EmptyStateProps {
  icon?: ElementType;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}
export interface SectionHeadingProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}
export interface StatusBadgeProps {
  children?: ReactNode;
  tone?: string;
  icon?: ElementType;
}
export interface ConfirmDialogProps extends Omit<DrawerProps, "onClose" | "open"> {
  open: boolean;
  onClose: () => unknown;
  onConfirm: () => unknown;
  confirmLabel?: ReactNode;
  tone?: string;
  busy?: boolean;
  confirmDisabled?: boolean;
}

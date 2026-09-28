"use client";

import React, { forwardRef } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-soft';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: React.ReactNode;
  iconPosition?: 'left' | 'right';
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    children,
    className,
    variant = 'secondary',
    size = 'md',
    icon,
    iconPosition = 'left',
    loading = false,
    disabled = false,
    type = 'button',
    ...props
  },
  ref
) {
  const isDisabled = disabled || loading;

  const baseStyles = "inline-flex items-center justify-center font-sans font-medium transition-colors select-none cursor-pointer whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-[var(--m-focus-ring)] focus-visible:ring-offset-1 disabled:opacity-45 disabled:cursor-not-allowed disabled:pointer-events-none";

  const sizeStyles: Record<ButtonSize, string> = {
    sm: "h-7 px-2.5 text-xs gap-1.5 rounded-[var(--m-radius-sm)]",
    md: "h-8 px-3 text-[13px] gap-2 rounded-[var(--m-radius-md)]",
    lg: "h-10 px-4 text-sm gap-2.5 rounded-[var(--m-radius-md)]",
    icon: "h-7 w-7 p-0 rounded-[var(--m-radius-sm)] shrink-0",
  };

  const variantStyles: Record<ButtonVariant, string> = {
    primary: "bg-[var(--m-accent)] hover:bg-[var(--m-accent-hover)] text-[var(--m-accent-contrast)] shadow-xs",
    secondary: "bg-[var(--m-bg-surface)] hover:bg-[var(--m-bg-surface-hover)] border border-[var(--m-border)] text-[var(--m-text-primary)] shadow-xs",
    ghost: "bg-transparent hover:bg-[var(--m-bg-surface-hover)] text-[var(--m-text-secondary)] hover:text-[var(--m-text-primary)]",
    danger: "bg-[var(--m-danger)] hover:opacity-90 text-white shadow-xs",
    'danger-soft': "bg-[var(--m-danger-soft)] hover:opacity-85 text-[var(--m-danger)] border border-[var(--m-danger)]/25",
  };

  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-busy={loading ? "true" : undefined}
      className={cn(baseStyles, sizeStyles[size], variantStyles[variant], className)}
      {...props}
    >
      {loading ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
      ) : (
        icon && iconPosition === 'left' && <span className="shrink-0">{icon}</span>
      )}
      {children}
      {!loading && icon && iconPosition === 'right' && (
        <span className="shrink-0">{icon}</span>
      )}
    </button>
  );
});

export default Button;

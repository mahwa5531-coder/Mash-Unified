"use client";

import * as React from "react";
import { AlertTriangle, AlertCircle, X, ShieldAlert, Sparkles, ArrowRight } from "lucide-react";
import { Button } from "@/primitives/Button";
import { cn } from "@/lib/utils";

export type QuotaBannerVariant = "warning" | "danger" | "info";

export type QuotaBannerProps = {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  actionLabel?: React.ReactNode;
  onAction?: () => void;
  onDismiss?: () => void;
  variant?: QuotaBannerVariant;
  className?: string;
  /**
   * "inline": banner occupies normal layout space directly above the chat composer.
   * "floating": positions it over the app content.
   */
  placement?: "inline" | "floating";
  /** Optional extra classes for the outer positioning wrapper. */
  wrapperClassName?: string;
};

const VARIANT_STYLES: Record<QuotaBannerVariant, {
  container: string;
  iconBox: string;
  icon: React.ReactElement;
  titleColor: string;
  descColor: string;
  buttonVariant: "primary" | "secondary" | "danger";
}> = {
  warning: {
    container: "bg-amber-50/90 dark:bg-[#1c1813] border-amber-200/90 dark:border-amber-800/40 shadow-[0_4px_20px_rgba(245,158,11,0.08)]",
    iconBox: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/25",
    icon: <AlertTriangle size={15} className="shrink-0" />,
    titleColor: "text-amber-950 dark:text-amber-100",
    descColor: "text-amber-900/80 dark:text-amber-200/80",
    buttonVariant: "primary",
  },
  danger: {
    container: "bg-rose-50/90 dark:bg-[#1c1114] border-rose-200/90 dark:border-rose-800/40 shadow-[0_4px_20px_rgba(244,63,94,0.08)]",
    iconBox: "bg-rose-500/15 text-rose-700 dark:text-rose-400 border border-rose-500/25",
    icon: <ShieldAlert size={15} className="shrink-0" />,
    titleColor: "text-rose-950 dark:text-rose-100",
    descColor: "text-rose-900/80 dark:text-rose-200/80",
    buttonVariant: "danger",
  },
  info: {
    container: "bg-sky-50/90 dark:bg-[#111722] border-sky-200/90 dark:border-sky-800/40 shadow-[0_4px_20px_rgba(14,165,233,0.08)]",
    iconBox: "bg-sky-500/15 text-sky-700 dark:text-sky-400 border border-sky-500/25",
    icon: <Sparkles size={15} className="shrink-0" />,
    titleColor: "text-sky-950 dark:text-sky-100",
    descColor: "text-sky-900/80 dark:text-sky-200/80",
    buttonVariant: "primary",
  },
};

/**
 * QuotaBanner Primitive
 * 
 * High-visibility system notification banner for LLM token limits, workspace quotas, and API cooling periods.
 * Sits directly above the chat composer dock or as an inline announcement.
 */
export function QuotaBanner({
  open = true,
  onOpenChange,
  title = "Baseline model quota reached",
  description = "Your plan's baseline quota has been reached for this billing period. To continue running substantive procedures, review your account or upgrade your workspace.",
  actionLabel = "View Plans",
  onAction,
  onDismiss,
  variant = "warning",
  className,
  placement = "inline",
  wrapperClassName,
}: QuotaBannerProps) {
  if (!open) return null;

  const dismiss = () => {
    onDismiss?.();
    onOpenChange?.(false);
  };

  const style = VARIANT_STYLES[variant] || VARIANT_STYLES.warning;

  return (
    <div
      className={cn(
        "pointer-events-auto w-full",
        placement === "floating" && "absolute inset-x-0 top-0 z-50 flex justify-center px-4 pt-4",
        wrapperClassName
      )}
    >
      <section
        role="alert"
        aria-live="polite"
        className={cn(
          "relative w-full rounded-2xl border transition-all select-text font-sans p-4",
          style.container,
          className
        )}
      >
        <div className="flex items-start justify-between gap-3">
          {/* Left: Icon + Content */}
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className={cn(
              "w-7 h-7 rounded-xl flex items-center justify-center shrink-0 shadow-2xs mt-0.5",
              style.iconBox
            )}>
              {style.icon}
            </div>

            <div className="flex-1 min-w-0">
              <h3 className={cn("text-[14px] font-semibold tracking-tight", style.titleColor)}>
                {title}
              </h3>
              {description && (
                <p className={cn("text-[13px] leading-relaxed mt-1 font-normal", style.descColor)}>
                  {description}
                </p>
              )}
            </div>
          </div>

          {/* Right: Actions */}
          <div className="flex items-center gap-2 shrink-0">
            {actionLabel && (
              <Button
                size="sm"
                variant={style.buttonVariant}
                onClick={onAction}
                iconPosition="right"
                icon={<ArrowRight size={13} />}
                className="shadow-xs cursor-pointer text-xs"
              >
                {actionLabel}
              </Button>
            )}

            {onDismiss && (
              <button
                type="button"
                onClick={dismiss}
                className="p-1 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer select-none"
                aria-label="Dismiss banner"
                title="Dismiss"
              >
                <X size={15} />
              </button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

export default QuotaBanner;

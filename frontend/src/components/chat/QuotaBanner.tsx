"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AlertTriangle, X } from "lucide-react";

export type QuotaBannerProps = {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  actionLabel?: React.ReactNode;
  onAction?: () => void;
  onDismiss?: () => void;
  className?: string;
  /**
   * "inline": banner occupies normal layout space directly above the chat composer.
   * "floating": positions it over the app content.
   */
  placement?: "inline" | "floating";
  /** Optional extra classes for the outer positioning wrapper. */
  wrapperClassName?: string;
};

export function QuotaBanner({
  open = true,
  onOpenChange,
  title = "Baseline model quota reached",
  description = "Your plan's baseline quota has been reached. To continue running audits now, view our available plans and upgrade your workspace.",
  actionLabel = "See Plans",
  onAction,
  onDismiss,
  className,
  placement = "inline",
  wrapperClassName,
}: QuotaBannerProps) {
  if (!open) return null;

  const dismiss = () => {
    onDismiss?.();
    onOpenChange?.(false);
  };

  return (
    <div
      className={cn(
        "pointer-events-auto w-full",
        placement === "floating" &&
          "absolute inset-x-0 top-0 z-50 flex justify-center px-4 pt-4",
        wrapperClassName,
      )}
    >
      <section
        role="alert"
        aria-live="polite"
        className={cn(
          [
            "relative w-full max-w-[1024px] overflow-hidden",
            "rounded-[20px] border border-white/[0.08] dark:border-white/[0.08]",
            "bg-[#1f1f1f] text-white",
            "shadow-[0_12px_32px_rgba(0,0,0,0.28)]",
            "px-4 pb-3.5 pt-3.5 sm:px-4 sm:pb-3.5 sm:pt-3.5",
          ].join(" "),
          className,
        )}
      >
        {/* Header row */}
        <div className="flex items-start gap-2.5 pr-10">
          <span
            aria-hidden="true"
            className="mt-[2px] inline-flex h-4 w-4 shrink-0 items-center justify-center text-amber-400"
          >
            <AlertTriangle className="h-4 w-4" />
          </span>

          <h3 className="min-w-0 text-[15px] font-medium leading-5 tracking-[-0.01em] text-[#e7e7e7]">
            {title}
          </h3>
        </div>

        {/* Body + single action */}
        <div className="pl-[26px] pr-0">
          <p className="mt-2 max-w-[920px] text-[14px] sm:text-[15px] font-normal leading-[1.48] tracking-[-0.01em] text-[#d4d4d4]">
            {description}
          </p>

          <div className="mt-3 flex justify-end sm:mt-2.5">
            <Button
              type="button"
              onClick={onAction}
              className={cn(
                "h-8 rounded-[8px] px-4",
                "bg-[#2d86e6] text-[13px] font-medium text-white shadow-xs",
                "hover:bg-[#3a93f3] active:scale-[0.98]",
                "focus-visible:ring-2 focus-visible:ring-[#2d86e6]/40 cursor-pointer",
              )}
            >
              {actionLabel}
            </Button>
          </div>
        </div>

        {/* Close */}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Dismiss"
          onClick={dismiss}
          className={cn(
            "absolute right-2.5 top-2.5 h-7 w-7 rounded-[8px]",
            "text-[#a6a6a6] hover:bg-white/[0.06] hover:text-[#e8e8e8] cursor-pointer",
          )}
        >
          <X className="h-4 w-4" />
        </Button>
      </section>
    </div>
  );
}

export default QuotaBanner;

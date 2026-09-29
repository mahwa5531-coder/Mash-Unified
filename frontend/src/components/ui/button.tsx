import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-xs font-medium transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)] disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:size-3.5 [&_svg]:shrink-0 cursor-pointer select-none",
  {
    variants: {
      variant: {
        default:
          "bg-zinc-900 text-white shadow-xs hover:bg-zinc-800 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200 active:scale-[0.98]",
        primary:
          "bg-[var(--m-accent,theme(colors.zinc.900))] text-[var(--m-accent-contrast,white)] shadow-xs hover:bg-[var(--m-accent-hover,theme(colors.zinc.800))] dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200 active:scale-[0.98]",
        secondary:
          "bg-[var(--m-bg-surface,theme(colors.zinc.100))] text-[var(--m-text-primary,theme(colors.zinc.900))] border border-[var(--m-border,theme(colors.zinc.200))] shadow-xs hover:bg-[var(--m-bg-surface-hover,theme(colors.zinc.200))] dark:border-zinc-800 dark:bg-zinc-800 dark:text-zinc-50 dark:hover:bg-zinc-700/80 active:scale-[0.98]",
        destructive:
          "bg-red-600 text-white shadow-xs hover:bg-red-700 dark:bg-red-900 dark:text-red-100 dark:hover:bg-red-800 active:scale-[0.98]",
        danger:
          "bg-red-600 text-white shadow-xs hover:bg-red-700 dark:bg-red-900 dark:text-red-100 dark:hover:bg-red-800 active:scale-[0.98]",
        "danger-soft":
          "bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20 border border-red-500/25",
        outline:
          "border border-zinc-200 dark:border-zinc-800 bg-transparent shadow-xs hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800/80 dark:hover:text-zinc-50 active:scale-[0.98]",
        ghost:
          "hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800/80 dark:hover:text-zinc-50",
        link: "text-[var(--accent)] underline-offset-4 hover:underline",
        subtle:
          "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/20",
      },
      size: {
        default: "h-8 px-3 py-1.5",
        sm: "h-7 rounded-md px-2.5 text-[11px]",
        md: "h-8 rounded-md px-3 text-[13px]",
        lg: "h-10 rounded-xl px-5 text-sm",
        icon: "h-7 w-7 rounded-md p-0 shrink-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>['variant']>;
export type ButtonSize = NonNullable<VariantProps<typeof buttonVariants>['size']>;

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
  icon?: React.ReactNode;
  iconPosition?: 'left' | 'right';
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      asChild = false,
      loading = false,
      disabled = false,
      icon,
      iconPosition = 'left',
      children,
      ...props
    },
    ref
  ) => {
    const isDisabled = disabled || loading;

    if (asChild) {
      return (
        <Slot
          className={cn(buttonVariants({ variant, size, className }))}
          ref={ref}
          {...props}
        >
          {children}
        </Slot>
      );
    }

    return (
      <button
        ref={ref}
        disabled={isDisabled}
        aria-busy={loading ? "true" : undefined}
        className={cn(buttonVariants({ variant, size, className }))}
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
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
export default Button;

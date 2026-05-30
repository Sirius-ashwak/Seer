import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "yes" | "no";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

const variants: Record<Variant, string> = {
  primary:
    "bg-primary text-canvas hover:bg-white disabled:hover:bg-primary shadow-[0_1px_0_0_rgba(255,255,255,0.12)_inset]",
  secondary:
    "bg-panel-2 text-ink border border-line hover:border-line-strong hover:bg-elevated",
  ghost: "bg-transparent text-muted hover:text-ink hover:bg-panel-2",
  yes: "bg-yes text-canvas hover:brightness-110",
  no: "bg-no text-canvas hover:brightness-110",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px] rounded-[var(--radius-control)]",
  md: "h-10 px-4 text-sm rounded-[var(--radius-control)]",
  lg: "h-12 px-5 text-[15px] rounded-[var(--radius-control)]",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, disabled, className, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        "relative inline-flex select-none items-center justify-center gap-2 font-medium",
        "transition-[background-color,border-color,color,transform,filter] duration-150",
        "active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  );
});

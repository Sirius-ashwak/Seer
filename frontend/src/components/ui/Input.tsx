import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  suffix?: ReactNode;
}

export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { label, suffix, className, id, ...props },
  ref,
) {
  return (
    <label className="grid gap-1.5">
      {label && <span className="text-xs font-medium text-muted">{label}</span>}
      <div className="relative flex items-center">
        <input
          ref={ref}
          id={id}
          className={cn(
            "h-11 w-full rounded-[var(--radius-control)] border border-line bg-canvas/60 px-3.5 text-[15px] text-ink",
            "tnum placeholder:text-faint",
            "transition-colors duration-150 hover:border-line-strong",
            "focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent",
            suffix && "pr-14",
            className,
          )}
          {...props}
        />
        {suffix && (
          <span className="pointer-events-none absolute right-3.5 text-xs font-medium text-faint">
            {suffix}
          </span>
        )}
      </div>
    </label>
  );
});

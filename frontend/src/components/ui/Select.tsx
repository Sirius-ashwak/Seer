import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SelectOption<T extends string> {
  label: string;
  value: T;
  hint?: string;
}

interface SelectProps<T extends string> {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  "aria-label"?: string;
  className?: string;
  /** Optional leading label rendered inside the trigger (e.g. an icon). */
  leading?: React.ReactNode;
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  className,
  leading,
  ...props
}: SelectProps<T>) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={props["aria-label"]}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex h-9 w-full items-center gap-2 rounded-[var(--radius-control)] border border-line bg-panel-2 px-3 text-[13px] text-ink",
          "transition-colors duration-150 hover:border-line-strong",
          "focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent",
        )}
      >
        {leading}
        <span className="truncate">{current?.label ?? "Select"}</span>
        <ChevronDown
          className={cn("ml-auto size-4 shrink-0 text-faint transition-transform", open && "rotate-180")}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.ul
            role="listbox"
            initial={{ opacity: 0, scale: 0.97, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: -2 }}
            transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
            className="surface-pop absolute right-0 z-30 mt-1.5 min-w-full overflow-hidden rounded-[var(--radius-control)] p-1"
          >
            {options.map((opt) => {
              const active = opt.value === value;
              return (
                <li key={opt.value}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => {
                      onChange(opt.value);
                      setOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-[calc(var(--radius-control)-3px)] px-2.5 py-2 text-left text-[13px]",
                      "transition-colors duration-100",
                      active ? "bg-panel-2 text-ink" : "text-muted hover:bg-panel-2 hover:text-ink",
                    )}
                  >
                    <span className="flex-1 truncate">
                      {opt.label}
                      {opt.hint && <span className="ml-1.5 text-faint">{opt.hint}</span>}
                    </span>
                    {active && <Check className="size-3.5 shrink-0 text-ink" />}
                  </button>
                </li>
              );
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

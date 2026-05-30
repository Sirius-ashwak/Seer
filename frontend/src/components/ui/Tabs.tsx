import type { LucideIcon } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

export interface TabOption<T extends string> {
  label: string;
  value: T;
  icon?: LucideIcon;
}

interface TabsProps<T extends string> {
  options: TabOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Shared layout id so multiple Tabs instances don't cross-animate. */
  layoutId?: string;
  "aria-label"?: string;
}

export function Tabs<T extends string>({
  options,
  value,
  onChange,
  layoutId = "tab-indicator",
  ...props
}: TabsProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={props["aria-label"]}
      className="inline-flex items-center gap-1 rounded-[var(--radius-control)] border border-line bg-panel-2/60 p-1"
    >
      {options.map((opt) => {
        const active = opt.value === value;
        const Icon = opt.icon;
        return (
          <button
            key={opt.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              "relative inline-flex items-center gap-1.5 rounded-[calc(var(--radius-control)-3px)] px-3 py-1.5 text-[13px] font-medium",
              "transition-colors duration-150",
              active ? "text-ink" : "text-faint hover:text-muted",
            )}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                transition={{ type: "spring", stiffness: 380, damping: 32 }}
                className="absolute inset-0 -z-10 rounded-[calc(var(--radius-control)-3px)] border border-line-strong bg-elevated"
              />
            )}
            {Icon && <Icon className="size-4" />}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

import { cn } from "@/lib/utils";

export interface SegmentOption<T extends string | number> {
  label: string;
  value: T;
  tone?: "default" | "yes" | "no";
}

interface SegmentedProps<T extends string | number> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  "aria-label"?: string;
}

const activeTone = {
  default: "bg-elevated text-ink shadow-sm",
  yes: "bg-yes text-canvas",
  no: "bg-no text-canvas",
};

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  ...props
}: SegmentedProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={props["aria-label"]}
      className="flex gap-1 rounded-[var(--radius-control)] border border-line bg-canvas/50 p-1"
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={String(opt.value)}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              "flex-1 rounded-[calc(var(--radius-control)-3px)] px-3 py-2 text-sm font-medium",
              "transition-[background-color,color] duration-150",
              active
                ? activeTone[opt.tone ?? "default"]
                : "text-faint hover:text-muted",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

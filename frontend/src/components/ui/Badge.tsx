import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "open" | "yes" | "no" | "invalid";

const tones: Record<Tone, string> = {
  neutral: "border-line text-muted",
  open: "border-line text-ink",
  yes: "border-transparent bg-yes-soft text-yes",
  no: "border-transparent bg-no-soft text-no",
  invalid: "border-line text-faint",
};

const dotTones: Record<Tone, string> = {
  neutral: "bg-faint",
  open: "bg-accent",
  yes: "bg-yes",
  no: "bg-no",
  invalid: "bg-faint",
};

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  dot?: boolean;
}

export function Badge({ tone = "neutral", dot = false, className, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wide",
        tones[tone],
        className,
      )}
      {...props}
    >
      {dot && <span className={cn("size-1.5 rounded-full", dotTones[tone])} />}
      {children}
    </span>
  );
}

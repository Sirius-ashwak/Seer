import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-[var(--animate-shimmer)] rounded-md bg-panel-2", className)}
      {...props}
    />
  );
}

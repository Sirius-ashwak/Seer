import { fmt } from "@/lib/format";
import { cn } from "@/lib/utils";

function Tile({ label, value, tone }: { label: string; value: bigint; tone: "yes" | "no" }) {
  return (
    <div className="rounded-[var(--radius-control)] border border-line bg-panel-2/60 px-4 py-3">
      <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-faint">
        <span className={cn("size-1.5 rounded-full", tone === "yes" ? "bg-yes" : "bg-no")} />
        {label}
      </div>
      <div className="tnum mt-1 text-lg font-semibold text-ink">{fmt(value)}</div>
    </div>
  );
}

export function PositionStats({ yes, no }: { yes: bigint; no: bigint }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Tile label="YES shares" value={yes} tone="yes" />
      <Tile label="NO shares" value={no} tone="no" />
    </div>
  );
}

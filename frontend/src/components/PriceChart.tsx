import { useId } from "react";
import { LineChart } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { cn } from "@/lib/utils";

interface PriceChartProps {
  prices: number[]; // YES probability, 0..1, oldest → newest
  tradeCount: number; // total trades behind the series (pre-sampling)
  loading: boolean;
}

// YES-probability history on a fixed 0–100% axis (so the line's height is
// meaningful, not auto-zoomed) with a 50% reference line and a gradient fill.
// X is per-trade, not time — labeled as such. Falls back to a quiet empty
// state before the first trade.
export function PriceChart({ prices, tradeCount, loading }: PriceChartProps) {
  const gradId = useId();

  if (loading) {
    return <Skeleton className="h-44 w-full rounded-[var(--radius-card)]" />;
  }

  if (prices.length < 2) {
    return (
      <Card className="flex h-44 flex-col items-center justify-center gap-2 text-center">
        <LineChart className="size-5 text-faint" />
        <p className="text-[13px] text-faint">Price history appears after the first trade.</p>
      </Card>
    );
  }

  const W = 100;
  const H = 100;
  const padY = 8;
  const x = (i: number) => (i / (prices.length - 1)) * W;
  const y = (p: number) => padY + (1 - p) * (H - 2 * padY);

  const linePoints = prices.map((p, i) => `${x(i).toFixed(2)},${y(p).toFixed(2)}`).join(" ");
  const areaPoints = `0,${H} ${linePoints} ${W},${H}`;

  const first = prices[0];
  const last = prices[prices.length - 1];
  const deltaPp = (last - first) * 100;
  const up = last >= first;
  const stroke = up ? "var(--color-yes)" : "var(--color-no)";

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted">
          <LineChart className="size-3.5 text-faint" />
          YES probability
          <span className="font-normal text-faint">
            · {tradeCount} trade{tradeCount === 1 ? "" : "s"}
          </span>
        </div>
        <div className="tnum flex items-baseline gap-2 text-sm">
          <span className="font-semibold text-ink">{(last * 100).toFixed(1)}%</span>
          <span className={cn("text-xs font-medium", up ? "text-yes" : "text-no")}>
            {up ? "+" : "−"}
            {Math.abs(deltaPp).toFixed(1)}pp
          </span>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-32 w-full overflow-visible"
        aria-hidden
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity={0.22} />
            <stop offset="100%" stopColor={stroke} stopOpacity={0} />
          </linearGradient>
        </defs>

        {/* 50% reference line */}
        <line
          x1="0"
          y1={y(0.5)}
          x2={W}
          y2={y(0.5)}
          stroke="var(--color-line-strong)"
          strokeWidth={1}
          strokeDasharray="3 3"
          vectorEffect="non-scaling-stroke"
        />

        <polygon points={areaPoints} fill={`url(#${gradId})`} stroke="none" />
        <polyline
          points={linePoints}
          fill="none"
          stroke={stroke}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      <div className="mt-2 flex justify-between text-[11px] text-faint">
        <span>earliest</span>
        <span>now</span>
      </div>
    </Card>
  );
}

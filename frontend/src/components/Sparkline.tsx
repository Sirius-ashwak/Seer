import { cn } from "@/lib/utils";

interface SparklineProps {
  prices: number[]; // YES probability, 0..1, oldest → newest
  className?: string;
  height?: number;
}

// Tiny trend line for market cards. Scales to its own range but floored at
// MIN_RANGE and centered on the data's midpoint, so a sub-percent wiggle reads
// as a sub-percent wiggle instead of filling the card. Stroke is YES-green when
// the last point is up vs. the first, NO-red when down. Renders an empty box
// until there are ≥2 points so the card height stays stable.
const MIN_RANGE = 0.06;

export function Sparkline({ prices, className, height = 26 }: SparklineProps) {
  if (prices.length < 2) {
    return <div className={cn("w-full", className)} style={{ height }} aria-hidden />;
  }

  const W = 100;
  const H = 100;
  const pad = 8;
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  const span = Math.max(hi - lo, MIN_RANGE);
  const min = (lo + hi) / 2 - span / 2;
  const x = (i: number) => (i / (prices.length - 1)) * W;
  const y = (p: number) => pad + (1 - (p - min) / span) * (H - 2 * pad);

  const points = prices.map((p, i) => `${x(i).toFixed(2)},${y(p).toFixed(2)}`).join(" ");
  const up = prices[prices.length - 1] >= prices[0];
  const stroke = up ? "var(--color-yes)" : "var(--color-no)";

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className={cn("w-full overflow-visible", className)}
      style={{ height }}
      aria-hidden
    >
      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

import { Card } from "@/components/ui/Card";
import { WAD, fmt, fmtCompact } from "@/lib/format";
import type { MarketDetail, Resolution } from "@/types";

// Compact, honest market stats. SEER has no on-chain volume; we surface the
// LS-LMSR liquidity parameter and outstanding shares as the size axis, plus the
// connected wallet's blended cost basis.
export function MarketStats({
  detail,
  resolution,
}: {
  detail: MarketDetail;
  resolution: Resolution | null;
}) {
  const held = detail.yes + detail.no;
  const avg = held > 0n ? (detail.collateral * WAD) / held : 0n;

  const stats: { label: string; value: string }[] = [
    { label: "Liquidity (b)", value: fmtCompact(detail.liquidity) },
    { label: "Shares YES / NO", value: `${fmtCompact(detail.qYes)} / ${fmtCompact(detail.qNo)}` },
  ];
  if (resolution?.exists && resolution.protocolFeeBps > 0) {
    stats.push({
      label: "Dispute fee",
      value: `${(resolution.protocolFeeBps / 100).toFixed(2)}%`,
    });
  }
  if (held > 0n) {
    stats.push({ label: "Your avg cost", value: `${fmt(avg, 3)}/sh` });
  }

  return (
    <Card className="grid grid-cols-2 gap-x-6 gap-y-3 p-4 sm:grid-cols-4">
      {stats.map((s) => (
        <div key={s.label} className="grid gap-0.5">
          <span className="text-[11px] uppercase tracking-wide text-faint">{s.label}</span>
          <span className="tnum text-sm text-ink">{s.value}</span>
        </div>
      ))}
    </Card>
  );
}

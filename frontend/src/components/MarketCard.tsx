import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { ArrowUpRight, Clock, Layers } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { PriceBar } from "@/components/PriceBar";
import { Sparkline } from "@/components/Sparkline";
import { OUTCOME_LABELS } from "@/abi";
import { useMarketHistory } from "@/hooks/useMarketHistory";
import { fmtCompact, short, timeUntil } from "@/lib/format";
import type { MarketSummary } from "@/types";

const outcomeTone = ["open", "yes", "no", "invalid"] as const;

interface MarketCardProps {
  market: MarketSummary;
  index: number;
  onSelect: (address: string) => void;
}

export function MarketCard({ market, index, onSelect }: MarketCardProps) {
  const resolved = market.outcome !== 0;
  const ref = useRef<HTMLButtonElement>(null);
  // Defer the per-card archival price scan until the card is near the viewport,
  // so a long grid doesn't fan out one RPC sweep per card on first paint.
  const [inView, setInView] = useState(false);
  const { prices } = useMarketHistory(market.address, { maxPoints: 24, enabled: inView });

  useEffect(() => {
    const el = ref.current;
    if (!el || inView) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [inView]);

  return (
    <motion.button
      ref={ref}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: Math.min(index * 0.04, 0.3), ease: [0.16, 1, 0.3, 1] }}
      onClick={() => onSelect(market.address)}
      className="group block text-left"
    >
      <Card className="h-full p-5 transition-[border-color,transform] duration-150 hover:-translate-y-0.5 hover:border-line-strong">
        <div className="mb-3 flex items-center justify-between">
          <Badge tone={resolved ? outcomeTone[market.outcome] : "open"} dot>
            {resolved ? OUTCOME_LABELS[market.outcome] : "Open"}
          </Badge>
          <span className="flex items-center gap-1 font-mono text-xs text-faint">
            {short(market.address)}
            <ArrowUpRight className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
          </span>
        </div>

        <h3 className="mb-4 line-clamp-2 min-h-[2.6rem] text-[15px] font-semibold leading-snug text-ink">
          {market.question}
        </h3>

        <PriceBar priceYes={market.priceYes} priceNo={market.priceNo} />

        <Sparkline prices={prices} className="mt-3" />

        <div className="mt-2 flex items-center justify-between text-xs text-faint">
          <span className="inline-flex items-center gap-1">
            <Layers className="size-3.5" />
            {fmtCompact(market.qYes + market.qNo)} liquidity
          </span>
          {!resolved && (
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3.5" />
              {timeUntil(market.deadline)}
            </span>
          )}
        </div>
      </Card>
    </motion.button>
  );
}

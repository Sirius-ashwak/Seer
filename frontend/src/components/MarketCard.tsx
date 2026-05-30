import { motion } from "framer-motion";
import { ArrowUpRight } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { PriceBar } from "@/components/PriceBar";
import { OUTCOME_LABELS } from "@/abi";
import { short } from "@/lib/format";
import type { MarketSummary } from "@/types";

const outcomeTone = ["open", "yes", "no", "invalid"] as const;

interface MarketCardProps {
  market: MarketSummary;
  index: number;
  onSelect: (address: string) => void;
}

export function MarketCard({ market, index, onSelect }: MarketCardProps) {
  const resolved = market.outcome !== 0;

  return (
    <motion.button
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

        {!resolved && <p className="mt-3 text-xs text-faint">Trading open</p>}
      </Card>
    </motion.button>
  );
}

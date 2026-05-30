import { motion } from "framer-motion";
import { pct, pctNum } from "@/lib/format";
import { cn } from "@/lib/utils";

interface PriceBarProps {
  priceYes: bigint;
  priceNo: bigint;
  size?: "sm" | "lg";
}

export function PriceBar({ priceYes, priceNo, size = "sm" }: PriceBarProps) {
  const yes = pctNum(priceYes);
  const big = size === "lg";

  return (
    <div
      className={cn(
        "flex w-full overflow-hidden rounded-lg border border-line/60 font-medium text-canvas",
        big ? "h-10 text-sm" : "h-7 text-[11px]",
      )}
    >
      <motion.div
        className="flex items-center gap-1.5 bg-yes pl-3"
        initial={false}
        animate={{ width: `${yes}%` }}
        transition={{ type: "spring", stiffness: 240, damping: 32 }}
        style={{ minWidth: big ? "4.5rem" : "3rem" }}
      >
        <span className="tnum">YES {pct(priceYes)}%</span>
      </motion.div>
      <div className="flex flex-1 items-center justify-end bg-no pr-3">
        <span className="tnum">{pct(priceNo)}% NO</span>
      </div>
    </div>
  );
}

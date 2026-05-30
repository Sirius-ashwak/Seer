import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { PriceBar } from "@/components/PriceBar";
import { PositionStats } from "@/components/PositionStats";
import { TradePanel } from "@/components/TradePanel";
import { CommitRevealPanel } from "@/components/CommitRevealPanel";
import { ClaimPanel } from "@/components/ClaimPanel";
import { ResolutionReceipt } from "@/components/ResolutionReceipt";
import { OUTCOME_LABELS } from "@/abi";
import { useMarket } from "@/hooks/useMarket";
import { useResolution } from "@/hooks/useResolution";
import { loadCommit } from "@/lib/commits";
import { short, timeUntil } from "@/lib/format";
import type { PendingCommit } from "@/types";

const outcomeTone = ["open", "yes", "no", "invalid"] as const;

interface MarketDetailProps {
  address: string;
  account: string | null;
  onBack: () => void;
  afterTrade: () => void;
}

export function MarketDetail({ address, account, onBack, afterTrade }: MarketDetailProps) {
  const { detail, loading, refresh } = useMarket(address, account);
  const { resolution, loading: resLoading, refresh: refreshResolution } = useResolution(address);
  const [pending, setPending] = useState<PendingCommit | null>(null);

  useEffect(() => {
    setPending(account ? loadCommit(address, account) : null);
  }, [address, account]);

  const handleTraded = () => {
    void refresh();
    void refreshResolution();
    afterTrade();
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
    >
      <button
        onClick={onBack}
        className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-ink"
      >
        <ArrowLeft className="size-4" />
        All markets
      </button>

      {loading || !detail ? (
        <DetailSkeleton />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <div>
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <Badge tone={detail.outcome !== 0 ? outcomeTone[detail.outcome] : "open"} dot>
                {detail.outcome !== 0 ? OUTCOME_LABELS[detail.outcome] : "Open"}
              </Badge>
              <span className="text-sm text-muted">
                {detail.outcome !== 0
                  ? "Resolved"
                  : `Closes in ${timeUntil(detail.deadline)} · ${new Date(
                      detail.deadline * 1000,
                    ).toLocaleDateString()}`}
              </span>
              <span className="ml-auto font-mono text-xs text-faint">{short(detail.address)}</span>
            </div>

            <h2 className="mb-5 text-2xl font-semibold leading-tight tracking-tight text-ink">
              {detail.question}
            </h2>

            <PriceBar priceYes={detail.priceYes} priceNo={detail.priceNo} size="lg" />

            {account && (
              <div className="mt-6">
                <PositionStats yes={detail.yes} no={detail.no} />
              </div>
            )}
          </div>

          <div className="grid content-start gap-4">
            {detail.outcome !== 0 ? (
              <ClaimPanel detail={detail} onClaimed={handleTraded} />
            ) : (
              <>
                <TradePanel
                  detail={detail}
                  onTraded={handleTraded}
                  onCommitted={setPending}
                  hasPendingCommit={!!pending}
                />
                {pending && (
                  <CommitRevealPanel
                    market={detail.address}
                    pending={pending}
                    onResolved={() => {
                      setPending(null);
                      handleTraded();
                    }}
                    onDiscard={() => setPending(null)}
                  />
                )}
              </>
            )}
          </div>

          {resolution?.exists && (
            <div className="lg:col-span-2">
              <ResolutionReceipt resolution={resolution} loading={resLoading} />
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}

function DetailSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <div>
        <Skeleton className="mb-3 h-5 w-40" />
        <Skeleton className="mb-2 h-7 w-full" />
        <Skeleton className="mb-6 h-7 w-3/4" />
        <Skeleton className="h-10 w-full rounded-lg" />
      </div>
      <Skeleton className="h-72 w-full rounded-[var(--radius-card)]" />
    </div>
  );
}

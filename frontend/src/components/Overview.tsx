import { ArrowRight, Briefcase, LineChart, Sparkles, Trophy, Wallet } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { ChallengeCTA } from "@/components/ChallengeCTA";
import { MarketCard } from "@/components/MarketCard";
import { ActivityFeed } from "@/components/ActivityFeed";
import { usePortfolio } from "@/hooks/usePortfolio";
import { useWallet } from "@/hooks/useWallet";
import { Outcome } from "@/abi";
import { fmt } from "@/lib/format";
import type { ViewKey } from "@/components/Header";
import type { MarketSummary } from "@/types";

interface OverviewProps {
  markets: MarketSummary[];
  loading: boolean;
  account: string | null;
  onSelect: (address: string) => void;
  onView: (v: ViewKey) => void;
  onAsk: () => void;
}

const PREVIEW_COUNT = 4;

export function Overview({ markets, loading, account, onSelect, onView, onAsk }: OverviewProps) {
  const preview = markets
    .filter((m) => m.outcome === Outcome.Pending)
    .sort((a, b) => a.deadline - b.deadline)
    .slice(0, PREVIEW_COUNT);

  return (
    <div className="grid gap-6">
      <ChallengeCTA markets={markets} onSelect={onSelect} />

      <PortfolioSnapshot account={account} onView={onView} />

      {/* Markets preview */}
      <section className="grid gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">Closing soon</h2>
          <button
            onClick={() => onView("markets")}
            className="inline-flex items-center gap-1 text-[13px] text-muted transition-colors hover:text-ink"
          >
            View all markets <ArrowRight className="size-3.5" />
          </button>
        </div>
        {loading && preview.length === 0 ? (
          <div className="grid gap-5 sm:grid-cols-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-52 w-full rounded-[var(--radius-card)]" />
            ))}
          </div>
        ) : preview.length === 0 ? (
          <Card className="flex flex-col items-center gap-3 px-6 py-10 text-center">
            <LineChart className="size-5 text-faint" />
            <p className="text-sm text-faint">No open markets yet.</p>
            <Button size="sm" variant="secondary" onClick={() => onView("markets")}>
              Browse markets
            </Button>
          </Card>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2">
            {preview.map((m, i) => (
              <MarketCard key={m.address} market={m} index={i} onSelect={onSelect} />
            ))}
          </div>
        )}
      </section>

      {/* Activity + Ask SEER entry */}
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <section className="grid gap-3">
          <h2 className="text-sm font-semibold text-ink">Recent activity</h2>
          <ActivityFeed account={account} />
        </section>

        <Card className="flex flex-col gap-3 p-5">
          <span className="grid size-9 place-items-center rounded-full border border-line bg-panel-2 text-accent">
            <Sparkles className="size-4" />
          </span>
          <div>
            <h3 className="text-sm font-semibold text-ink">Ask SEER</h3>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">
              Get a read on where markets stand, your positions, and how bonded resolution works —
              answered from live data.
            </p>
          </div>
          <Button size="sm" variant="secondary" className="mt-auto self-start" onClick={onAsk}>
            <Sparkles className="size-4 text-accent" />
            Ask anything
          </Button>
        </Card>
      </div>
    </div>
  );
}

function PortfolioSnapshot({ account, onView }: { account: string | null; onView: (v: ViewKey) => void }) {
  const { connect } = useWallet();
  const { totalValue, claimableValue, claimableCount, positions, loading } = usePortfolio(account);

  if (!account) {
    return (
      <Card className="flex flex-col items-start gap-3 p-6">
        <div className="text-xs font-medium uppercase tracking-wide text-faint">Your portfolio</div>
        <p className="text-sm text-muted">
          Connect a wallet to track your positions, value, and claimable winnings.
        </p>
        <Button variant="primary" size="sm" onClick={() => void connect()}>
          <Wallet className="size-4" />
          Connect wallet
        </Button>
      </Card>
    );
  }

  const open = positions.filter((p) => p.outcome === Outcome.Pending).length;

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <Card className="p-5">
        <div className="text-xs font-medium uppercase tracking-wide text-faint">Portfolio value</div>
        {loading ? (
          <Skeleton className="mt-2 h-9 w-28" />
        ) : (
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="font-hero tnum text-[34px] leading-none text-ink">{fmt(totalValue)}</span>
            <span className="text-sm text-faint">Points</span>
          </div>
        )}
      </Card>

      <Card className="flex items-center justify-between gap-3 p-5">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-faint">Open positions</div>
          <div className="tnum mt-1 text-lg font-semibold text-ink">{loading ? "—" : open}</div>
        </div>
        <button
          onClick={() => onView("portfolio")}
          aria-label="Open portfolio"
          className="grid size-9 place-items-center rounded-full border border-line bg-panel-2 text-muted transition-colors hover:border-line-strong hover:text-ink"
        >
          <Briefcase className="size-4" />
        </button>
      </Card>

      <Card className="flex items-center justify-between gap-3 p-5">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-faint">Claimable</div>
          <div className="tnum mt-1 text-lg font-semibold text-ink">
            {fmt(claimableValue)} <span className="text-sm font-normal text-faint">Points</span>
          </div>
        </div>
        {claimableCount > 0 && (
          <Button size="sm" onClick={() => onView("portfolio")}>
            <Trophy className="size-4" />
            Claim
          </Button>
        )}
      </Card>
    </div>
  );
}

import { Inbox, PlugZap, Settings2 } from "lucide-react";
import { MarketCard } from "@/components/MarketCard";
import { MarketGridSkeleton } from "@/components/Skeletons";
import { EmptyState } from "@/components/EmptyState";
import type { MarketSummary } from "@/types";

interface MarketGridProps {
  markets: MarketSummary[];
  loading: boolean;
  error: string | null;
  configured: boolean;
  onSelect: (address: string) => void;
}

export function MarketGrid({ markets, loading, error, configured, onSelect }: MarketGridProps) {
  if (!configured) {
    return (
      <EmptyState
        icon={Settings2}
        title="Contracts not configured"
        description={
          <>
            Set the factory and points addresses in <code className="text-ink">src/config.ts</code>{" "}
            after running the deploy script.
          </>
        }
      />
    );
  }

  if (loading) return <MarketGridSkeleton />;

  if (error) {
    return <EmptyState icon={PlugZap} title="Can't reach the network" description={error} />;
  }

  if (markets.length === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title="No markets yet"
        description="Deploy a market with the factory to start trading. The list refreshes automatically."
      />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {markets.map((m, i) => (
        <MarketCard key={m.address} market={m} index={i} onSelect={onSelect} />
      ))}
    </div>
  );
}

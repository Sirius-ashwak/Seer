import { useCallback, useEffect, useState } from "react";
import { factoryContract, marketContract, readProvider } from "@/lib/contracts";
import { isConfigured } from "@/config";
import type { MarketSummary } from "@/types";

interface MarketsState {
  markets: MarketSummary[];
  loading: boolean;
  error: string | null;
  configured: boolean;
  refresh: () => Promise<void>;
}

async function loadSummary(address: string): Promise<MarketSummary> {
  const m = marketContract(address, readProvider);
  const [question, priceYes, priceNo, outcome] = await Promise.all([
    m.question() as Promise<string>,
    m.priceYes() as Promise<bigint>,
    m.priceNo() as Promise<bigint>,
    m.outcome() as Promise<bigint>,
  ]);
  return { address, question, priceYes, priceNo, outcome: Number(outcome) };
}

export function useMarkets(): MarketsState {
  const [markets, setMarkets] = useState<MarketSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const configured = isConfigured();

  const refresh = useCallback(async () => {
    if (!configured) {
      setLoading(false);
      return;
    }
    setError(null);
    try {
      const addresses = (await factoryContract(readProvider).allMarkets()) as string[];
      const summaries = await Promise.all(addresses.map(loadSummary));
      setMarkets(summaries);
    } catch {
      setError("Couldn't reach the RPC. Is anvil running and the address in config.ts correct?");
    } finally {
      setLoading(false);
    }
  }, [configured]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { markets, loading, error, configured, refresh };
}

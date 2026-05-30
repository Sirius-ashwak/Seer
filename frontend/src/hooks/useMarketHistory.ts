import { useEffect, useState } from "react";
import { formatUnits } from "ethers";
import { marketContract, readProvider } from "@/lib/contracts";
import { isConfigured } from "@/config";

// Reconstruct a market's YES-probability history. Trades don't emit the
// resulting price, but every Bought/Sold marks a block where the price moved,
// so we read priceYes() at each of those blocks via archival eth_call and let
// the chain do the LMSR math. Series is oldest → newest, with "now" appended.
// Values are YES probability in 0..1. Index-based (one point per trade), not a
// time axis — honest about what the data is.

const DEFAULT_MAX = 48;

function sampleEvenly<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr;
  const out: T[] = [];
  const step = (arr.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(arr[Math.round(i * step)]);
  return out;
}

// `refreshKey` re-runs the query when it changes (e.g. pass the current price
// so the chart picks up a fresh trade without remounting).
export function useMarketHistory(
  address: string | null,
  maxPoints = DEFAULT_MAX,
  refreshKey?: string | number,
): { prices: number[]; loading: boolean } {
  const [prices, setPrices] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!address || !isConfigured()) {
      setPrices([]);
      setLoading(false);
      return;
    }
    let live = true;
    setLoading(true);

    void (async () => {
      const m = marketContract(address, readProvider);
      try {
        const [bought, sold] = await Promise.all([
          m.queryFilter(m.filters.Bought(), 0),
          m.queryFilter(m.filters.Sold(), 0),
        ]);
        const blocks = Array.from(
          new Set([...bought, ...sold].map((l) => l.blockNumber)),
        ).sort((a, b) => a - b);

        const sampled = sampleEvenly(blocks, maxPoints);
        const sampledPrices = await Promise.all(
          sampled.map(async (bn) => {
            const p = (await m.priceYes({ blockTag: bn })) as bigint;
            return Number(formatUnits(p, 18));
          }),
        );
        const current = Number(formatUnits((await m.priceYes()) as bigint, 18));
        if (live) setPrices([...sampledPrices, current]);
      } catch {
        // Archival calls unsupported, RPC down, or no events — degrade to no chart.
        if (live) setPrices([]);
      } finally {
        if (live) setLoading(false);
      }
    })();

    return () => {
      live = false;
    };
  }, [address, maxPoints, refreshKey]);

  return { prices, loading };
}

import { useEffect, useState } from "react";
import { formatUnits } from "ethers";
import { marketContract, readProvider } from "@/lib/contracts";
import { isConfigured } from "@/config";

// Reconstruct a market's YES-probability history. Trades don't emit the
// resulting price, but every Bought/Sold marks a block where the price moved,
// so we read priceYes() at each of those blocks via archival eth_call and let
// the chain do the LMSR math. Series is oldest → newest, with "now" appended.
// Values are YES probability in 0..1. Index-based (one point per sampled
// trade), not a time axis — honest about what the data is.

const DEFAULT_MAX = 48;
// Cap the event scan so a pruned/rate-limited testnet RPC doesn't choke on a
// full-history getLogs. Recent trades carry the signal; older ones are noise.
const LOOKBACK = 500_000;

interface Options {
  maxPoints?: number;
  // Re-runs the query when it changes (e.g. pass the current price so the chart
  // picks up a fresh trade without remounting).
  refreshKey?: string | number;
  // Gate the fetch — lets callers defer per-card work until the card scrolls
  // into view (see MarketCard's IntersectionObserver).
  enabled?: boolean;
}

function sampleEvenly<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr;
  const out: T[] = [];
  const step = (arr.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(arr[Math.round(i * step)]);
  return out;
}

export function useMarketHistory(
  address: string | null,
  opts: Options = {},
): { prices: number[]; tradeCount: number; loading: boolean } {
  const { maxPoints = DEFAULT_MAX, refreshKey, enabled = true } = opts;
  const [prices, setPrices] = useState<number[]>([]);
  const [tradeCount, setTradeCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!address || !isConfigured() || !enabled) {
      setPrices([]);
      setTradeCount(0);
      setLoading(false);
      return;
    }
    let live = true;
    setLoading(true);

    void (async () => {
      const m = marketContract(address, readProvider);
      try {
        const latest = await readProvider.getBlockNumber();
        const fromBlock = latest > LOOKBACK ? latest - LOOKBACK : 0;
        const [bought, sold] = await Promise.all([
          m.queryFilter(m.filters.Bought(), fromBlock),
          m.queryFilter(m.filters.Sold(), fromBlock),
        ]);
        const trades = bought.length + sold.length;
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
        if (live) {
          setPrices([...sampledPrices, current]);
          setTradeCount(trades);
        }
      } catch {
        // Archival calls unsupported, RPC down, or no events — degrade to no chart.
        if (live) {
          setPrices([]);
          setTradeCount(0);
        }
      } finally {
        if (live) setLoading(false);
      }
    })();

    return () => {
      live = false;
    };
  }, [address, maxPoints, refreshKey, enabled]);

  return { prices, tradeCount, loading };
}

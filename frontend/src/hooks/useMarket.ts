import { useCallback, useEffect, useState } from "react";
import { marketContract, readProvider } from "@/lib/contracts";
import type { MarketDetail } from "@/types";

interface MarketState {
  detail: MarketDetail | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

export function useMarket(address: string | null, account: string | null): MarketState {
  const [detail, setDetail] = useState<MarketDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!address) {
      setDetail(null);
      return;
    }
    const m = marketContract(address, readProvider);
    const [question, deadline, outcome, priceYes, priceNo, qYes, qNo, largeBetBps, liquidity] =
      await Promise.all([
        m.question() as Promise<string>,
        m.deadline() as Promise<bigint>,
        m.outcome() as Promise<bigint>,
        m.priceYes() as Promise<bigint>,
        m.priceNo() as Promise<bigint>,
        m.qYes() as Promise<bigint>,
        m.qNo() as Promise<bigint>,
        m.largeBetBps() as Promise<bigint>,
        m.liquidity() as Promise<bigint>,
      ]);

    const [yes, no, collateral, claimed] = account
      ? await Promise.all([
          m.yesOf(account) as Promise<bigint>,
          m.noOf(account) as Promise<bigint>,
          m.collateralOf(account) as Promise<bigint>,
          m.claimed(account) as Promise<boolean>,
        ])
      : [0n, 0n, 0n, false];

    setDetail({
      address,
      question,
      deadline: Number(deadline),
      outcome: Number(outcome),
      priceYes,
      priceNo,
      qYes,
      qNo,
      largeBetBps,
      liquidity,
      yes,
      no,
      collateral,
      claimed,
    });
  }, [address, account]);

  useEffect(() => {
    setLoading(true);
    void refresh().finally(() => setLoading(false));
  }, [refresh]);

  return { detail, loading, refresh };
}

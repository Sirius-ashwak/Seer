import { useCallback, useEffect, useState } from "react";
import { factoryContract, marketContract, readProvider } from "@/lib/contracts";
import { isConfigured } from "@/config";
import { Outcome } from "@/abi";
import { WAD } from "@/lib/format";

export interface PortfolioPosition {
  address: string;
  question: string;
  outcome: number; // market Outcome: 0 Pending, 1 Yes, 2 No, 3 Invalid
  yes: bigint;
  no: bigint;
  collateral: bigint;
  claimed: boolean;
  priceYes: bigint;
  priceNo: bigint;
  value: bigint; // mark-to-market value in Points
  claimable: boolean; // resolved, holds a redeemable stake, not yet claimed
  claimAmount: bigint; // estimated payout if claimed now
}

interface PortfolioState {
  positions: PortfolioPosition[];
  totalValue: bigint;
  claimableValue: bigint;
  claimableCount: number;
  loading: boolean;
  refresh: () => Promise<void>;
}

async function loadPosition(address: string, account: string): Promise<PortfolioPosition | null> {
  const m = marketContract(address, readProvider);
  const [question, outcome, priceYes, priceNo, yes, no, collateral, claimed] = await Promise.all([
    m.question() as Promise<string>,
    m.outcome() as Promise<bigint>,
    m.priceYes() as Promise<bigint>,
    m.priceNo() as Promise<bigint>,
    m.yesOf(account) as Promise<bigint>,
    m.noOf(account) as Promise<bigint>,
    m.collateralOf(account) as Promise<bigint>,
    m.claimed(account) as Promise<boolean>,
  ]);

  // Skip markets the account never touched.
  if (yes === 0n && no === 0n && collateral === 0n) return null;

  const oc = Number(outcome);
  let value: bigint;
  let claimAmount = 0n;

  if (oc === Outcome.Pending) {
    // Open: mark shares at the current marginal price.
    value = (yes * priceYes) / WAD + (no * priceNo) / WAD;
  } else if (oc === Outcome.Yes) {
    claimAmount = yes; // winning shares redeem 1:1
    value = yes;
  } else if (oc === Outcome.No) {
    claimAmount = no;
    value = no;
  } else {
    // Invalid: net collateral is refunded.
    claimAmount = collateral;
    value = collateral;
  }

  const claimable = oc !== Outcome.Pending && !claimed && claimAmount > 0n;

  return {
    address,
    question,
    outcome: oc,
    yes,
    no,
    collateral,
    claimed,
    priceYes,
    priceNo,
    value,
    claimable,
    claimAmount,
  };
}

export function usePortfolio(account: string | null): PortfolioState {
  const [positions, setPositions] = useState<PortfolioPosition[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!account || !isConfigured()) {
      setPositions([]);
      setLoading(false);
      return;
    }
    try {
      const addresses = (await factoryContract(readProvider).allMarkets()) as string[];
      const all = await Promise.all(addresses.map((a) => loadPosition(a, account)));
      setPositions(all.filter((p): p is PortfolioPosition => p !== null));
    } catch {
      setPositions([]);
    } finally {
      setLoading(false);
    }
  }, [account]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  const totalValue = positions.reduce((sum, p) => sum + p.value, 0n);
  const claimablePositions = positions.filter((p) => p.claimable);
  const claimableValue = claimablePositions.reduce((sum, p) => sum + p.claimAmount, 0n);

  return {
    positions,
    totalValue,
    claimableValue,
    claimableCount: claimablePositions.length,
    loading,
    refresh,
  };
}

import { useEffect, useState } from "react";
import { resolverContract, readProvider } from "@/lib/contracts";
import { ResolverPhase } from "@/abi";
import { CONFIG, ZERO_ADDRESS } from "@/config";
import type { MarketSummary } from "@/types";

// A market open to dispute: its resolver is in the Challenge phase with a
// deadline still in the future.
export interface Challengeable {
  address: string;
  question: string;
  proposedOutcome: number; // resolver Outcome enum (1 Invalid, 2 Yes, 3 No)
  deadline: number; // unix seconds
}

// Scans every market's resolver phase and returns those still open to challenge,
// soonest-expiring first. Shared by the ChallengeCTA hero and the notifications
// bell so the RPC sweep happens once per consumer, not per feature.
export function useChallengeable(markets: MarketSummary[]): Challengeable[] {
  const [items, setItems] = useState<Challengeable[]>([]);

  useEffect(() => {
    const resolverAddr = CONFIG.contracts.resolver;
    if (!resolverAddr || resolverAddr === ZERO_ADDRESS || markets.length === 0) {
      setItems([]);
      return;
    }
    let live = true;
    const nowSec = Math.floor(Date.now() / 1000);
    const r = resolverContract(resolverAddr, readProvider);

    void (async () => {
      try {
        const scanned = await Promise.all(
          markets.map(async (m) => {
            const phase = Number((await r.phaseOf(m.address)) as bigint);
            if (phase !== ResolverPhase.Challenge) return null;
            const [deadline, proposed] = await Promise.all([
              r.challengeDeadlineOf(m.address) as Promise<bigint>,
              r.proposedOutcomeOf(m.address) as Promise<bigint>,
            ]);
            const dl = Number(deadline);
            if (dl <= nowSec) return null;
            return {
              address: m.address,
              question: m.question,
              proposedOutcome: Number(proposed),
              deadline: dl,
            };
          }),
        );
        if (!live) return;
        setItems(
          scanned
            .filter((c): c is Challengeable => c !== null)
            .sort((a, b) => a.deadline - b.deadline),
        );
      } catch {
        if (live) setItems([]);
      }
    })();

    return () => {
      live = false;
    };
  }, [markets]);

  return items;
}

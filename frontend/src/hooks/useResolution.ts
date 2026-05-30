import { useCallback, useEffect, useState } from "react";
import { resolverContract, readProvider } from "@/lib/contracts";
import { ResolverPhase } from "@/abi";
import { CONFIG, ZERO_ADDRESS } from "@/config";
import { bytesToText } from "@/lib/format";
import type { Resolution, ResolutionSource } from "@/types";

interface ResolutionState {
  resolution: Resolution | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

// Reads the full audit trail for a market from the canonical SeerResolver
// oracle (CONFIG.contracts.resolver). Returns a Resolution with `exists:false`
// when the oracle holds no record for this market yet (Phase.None).
export function useResolution(address: string | null): ResolutionState {
  const [resolution, setResolution] = useState<Resolution | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const resolverAddr = CONFIG.contracts.resolver;
    if (!address || !resolverAddr || resolverAddr === ZERO_ADDRESS) {
      setResolution(null);
      return;
    }
    const empty: Resolution = {
      exists: false,
      phase: ResolverPhase.None,
      proposedOutcome: 0,
      finalOutcome: 0,
      finalized: false,
      challengeDeadline: 0,
      requestDeadline: 0,
      proposer: "",
      bond: 0n,
      disputer: "",
      disputerBond: 0n,
      escalationRequestId: 0n,
      sourcesReceived: 0,
      sources: [],
      llmRequestId: 0n,
      inferencePrompt: "",
      llmRawResponse: "",
      proposedAt: 0,
      finalizedAt: 0,
      bondAmount: 0n,
      challengeWindow: 0,
      protocolFeeBps: 0,
    };

    try {
      const r = resolverContract(resolverAddr, readProvider);

      const phase = Number((await r.phaseOf(address)) as bigint);
      if (phase === ResolverPhase.None) {
        setResolution(empty);
        return;
      }

      const sourceCount = Number((await r.SOURCES()) as bigint);
      const [
        proposedOutcome,
        finalOutcome,
        finalized,
        challengeDeadline,
        requestDeadline,
        proposer,
        bond,
        disputer,
        disputerBond,
        escalationRequestId,
        sourcesReceived,
        llmRequestId,
        inferencePrompt,
        llmRawResponse,
        proposedAt,
        finalizedAt,
        bondAmount,
        challengeWindow,
        protocolFeeBps,
      ] = await Promise.all([
        r.proposedOutcomeOf(address) as Promise<bigint>,
        r.finalOutcomeOf(address) as Promise<bigint>,
        r.isFinalized(address) as Promise<boolean>,
        r.challengeDeadlineOf(address) as Promise<bigint>,
        r.requestDeadlineOf(address) as Promise<bigint>,
        r.proposerOf(address) as Promise<string>,
        r.bondOf(address) as Promise<bigint>,
        r.disputerOf(address) as Promise<string>,
        r.disputerBondOf(address) as Promise<bigint>,
        r.escalationRequestIdOf(address) as Promise<bigint>,
        r.sourcesReceivedOf(address) as Promise<bigint>,
        r.llmRequestIdOf(address) as Promise<bigint>,
        r.inferencePromptOf(address) as Promise<string>,
        r.llmRawResponseOf(address) as Promise<string>,
        r.proposedAtOf(address) as Promise<bigint>,
        r.finalizedAtOf(address) as Promise<bigint>,
        r.bondAmount() as Promise<bigint>,
        r.challengeWindow() as Promise<bigint>,
        r.protocolFeeBps() as Promise<bigint>,
      ]);

      const sources: ResolutionSource[] = await Promise.all(
        Array.from({ length: sourceCount }, async (_, i) => {
          const [requestId, data] = await Promise.all([
            r.sourceRequestIdOf(address, i) as Promise<bigint>,
            r.sourceDataOf(address, i) as Promise<string>,
          ]);
          return { index: i, requestId, data: bytesToText(data) };
        }),
      );

      setResolution({
        exists: true,
        phase,
        proposedOutcome: Number(proposedOutcome),
        finalOutcome: Number(finalOutcome),
        finalized,
        challengeDeadline: Number(challengeDeadline),
        requestDeadline: Number(requestDeadline),
        proposer,
        bond,
        disputer,
        disputerBond,
        escalationRequestId,
        sourcesReceived: Number(sourcesReceived),
        sources,
        llmRequestId,
        inferencePrompt: bytesToText(inferencePrompt),
        llmRawResponse: bytesToText(llmRawResponse),
        proposedAt: Number(proposedAt),
        finalizedAt: Number(finalizedAt),
        bondAmount,
        challengeWindow: Number(challengeWindow),
        protocolFeeBps: Number(protocolFeeBps),
      });
    } catch {
      // Oracle unreachable or not a SeerResolver — no trail to show.
      setResolution(empty);
    }
  }, [address]);

  useEffect(() => {
    setLoading(true);
    void refresh().finally(() => setLoading(false));
  }, [refresh]);

  return { resolution, loading, refresh };
}

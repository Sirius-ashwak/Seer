import { useState } from "react";
import { Bot } from "lucide-react";
import { AbiCoder, hexlify, toUtf8Bytes, type ContractTransactionResponse } from "ethers";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { RESPONSE_STATUS, ResolverPhase } from "@/abi";
import { CONFIG } from "@/config";
import { useWallet } from "@/hooks/useWallet";
import { mockContract } from "@/lib/contracts";
import { record } from "@/lib/activity";
import { runTx } from "@/lib/tx";
import type { MarketDetail, Resolution } from "@/types";

// Local-anvil only. The real Somnia agent network answers on testnet; here we
// stand in for it so propose → sources → inference → dispute → escalation can be
// driven entirely in-browser. Hidden whenever no mock requester is configured.
interface AgentSimulatorProps {
  detail: MarketDetail;
  resolution: Resolution | null;
  onAction: () => void;
}

const VERDICT_OPTIONS = [
  { label: "Yes", value: "1" },
  { label: "No", value: "2" },
  { label: "Invalid", value: "0" },
];

export function AgentSimulator({ detail, resolution, onAction }: AgentSimulatorProps) {
  const { account, signer, connect } = useWallet();
  const [verdict, setVerdict] = useState("1");
  const [busy, setBusy] = useState(false);

  if (!CONFIG.mockRequester || !resolution?.exists) return null;
  const phase = resolution.phase;
  const actionable =
    phase === ResolverPhase.AwaitingSources ||
    phase === ResolverPhase.AwaitingInference ||
    phase === ResolverPhase.Disputed;
  if (!actionable) return null;

  const encodeVerdict = () =>
    AbiCoder.defaultAbiCoder().encode(["uint8"], [Number(verdict)]);

  const guard = (): boolean => {
    if (!account || !signer) {
      void connect();
      return false;
    }
    return true;
  };

  const deliverSources = async () => {
    if (!guard()) return;
    const mock = mockContract(signer!);
    if (!mock) return;
    setBusy(true);
    try {
      // Deliver each not-yet-received source; the third callback auto-fires the
      // inference request inside the resolver.
      for (const s of resolution.sources) {
        if (s.requestId > 0n && s.data === "") {
          await runTx(
            `Source #${s.index + 1} callback`,
            () =>
              mock.simulateCallback(
                s.requestId,
                [hexlify(toUtf8Bytes(`source ${s.index + 1} payload`))],
                RESPONSE_STATUS.Succeeded,
              ) as Promise<ContractTransactionResponse>,
          );
        }
      }
      record(account, {
        type: "simulate",
        market: detail.address,
        question: detail.question,
        detail: "Simulated source callbacks",
      });
      onAction();
    } finally {
      setBusy(false);
    }
  };

  const deliverVerdict = async (kind: "inference" | "escalation") => {
    if (!guard()) return;
    const mock = mockContract(signer!);
    if (!mock) return;
    const requestId = kind === "inference" ? resolution.llmRequestId : resolution.escalationRequestId;
    if (requestId <= 0n) return;
    setBusy(true);
    try {
      const ok = await runTx(
        `${kind === "inference" ? "LLM" : "Escalation"} verdict callback`,
        () =>
          mock.simulateCallback(
            requestId,
            [encodeVerdict()],
            RESPONSE_STATUS.Succeeded,
          ) as Promise<ContractTransactionResponse>,
      );
      if (ok) {
        record(account, {
          type: "simulate",
          market: detail.address,
          question: detail.question,
          detail: `Simulated ${kind} verdict`,
        });
        onAction();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="grid gap-3 border-dashed p-5">
      <div className="flex items-center gap-2 text-sm font-semibold text-ink">
        <Bot className="size-4 text-accent" />
        Agent simulator
        <span className="ml-auto rounded-full border border-line px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-faint">
          local only
        </span>
      </div>
      <p className="text-[13px] leading-relaxed text-muted">
        Stands in for the Somnia agent network on anvil so the full resolution
        lifecycle is clickable.
      </p>

      {phase === ResolverPhase.AwaitingSources && (
        <Button variant="secondary" onClick={() => void deliverSources()} loading={busy}>
          Deliver source payloads
        </Button>
      )}

      {phase === ResolverPhase.AwaitingInference && (
        <div className="grid gap-2">
          <Select aria-label="LLM verdict" value={verdict} onChange={setVerdict} options={VERDICT_OPTIONS} />
          <Button variant="secondary" onClick={() => void deliverVerdict("inference")} loading={busy}>
            Deliver LLM verdict
          </Button>
        </div>
      )}

      {phase === ResolverPhase.Disputed && (
        <div className="grid gap-2">
          <Select aria-label="Escalation verdict" value={verdict} onChange={setVerdict} options={VERDICT_OPTIONS} />
          <Button variant="secondary" onClick={() => void deliverVerdict("escalation")} loading={busy}>
            Deliver escalation verdict
          </Button>
        </div>
      )}
    </Card>
  );
}

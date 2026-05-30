import { useEffect, useState } from "react";
import { Gavel, Scale, CheckCheck, AlertTriangle, Hourglass } from "lucide-react";
import type { ContractTransactionResponse } from "ethers";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ProposeModal } from "@/components/ProposeModal";
import { Outcome, ResolverPhase } from "@/abi";
import { CONFIG } from "@/config";
import { useWallet } from "@/hooks/useWallet";
import { resolverContract, settlementContract } from "@/lib/contracts";
import { record, type ActivityType } from "@/lib/activity";
import { runTx } from "@/lib/tx";
import { fmt, timeUntil } from "@/lib/format";
import type { MarketDetail, Resolution } from "@/types";

interface ResolutionActionsProps {
  detail: MarketDetail;
  resolution: Resolution | null;
  onAction: () => void;
}

interface ResolverConfig {
  sources: number;
  sourceDeposit: bigint;
  llmDeposit: bigint;
  escalationDeposit: bigint;
  bond: bigint;
}

export function ResolutionActions({ detail, resolution, onAction }: ResolutionActionsProps) {
  const { account, signer, balance, connect } = useWallet();
  const [cfg, setCfg] = useState<ResolverConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [proposeOpen, setProposeOpen] = useState(false);

  useEffect(() => {
    let live = true;
    const r = resolverContract(CONFIG.contracts.resolver);
    Promise.all([
      r.SOURCES() as Promise<bigint>,
      r.sourceCallDeposit() as Promise<bigint>,
      r.llmCallDeposit() as Promise<bigint>,
      r.escalationDeposit() as Promise<bigint>,
      r.bondAmount() as Promise<bigint>,
    ])
      .then(([s, sd, ld, ed, b]) => {
        if (live)
          setCfg({
            sources: Number(s),
            sourceDeposit: sd,
            llmDeposit: ld,
            escalationDeposit: ed,
            bond: b,
          });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const phase = resolution?.exists ? resolution.phase : ResolverPhase.None;
  const now = Math.floor(Date.now() / 1000);
  const marketResolved = detail.outcome !== Outcome.Pending;
  const proposeValue = cfg ? BigInt(cfg.sources) * cfg.sourceDeposit + cfg.llmDeposit : 0n;
  const insufficientBond = !!account && !!cfg && balance < cfg.bond;
  const canTimeout =
    (phase === ResolverPhase.AwaitingSources ||
      phase === ResolverPhase.AwaitingInference ||
      phase === ResolverPhase.Disputed) &&
    resolution !== null &&
    resolution.requestDeadline > 0 &&
    now >= resolution.requestDeadline;

  const run = async (
    label: string,
    type: ActivityType,
    send: () => Promise<ContractTransactionResponse>,
  ) => {
    if (!account || !signer) {
      void connect();
      return;
    }
    setBusy(true);
    try {
      const ok = await runTx(label, send);
      if (ok) {
        record(account, { type, market: detail.address, question: detail.question, detail: label });
        onAction();
      }
    } finally {
      setBusy(false);
    }
  };

  const dispute = () =>
    run(
      "Disputing outcome",
      "dispute",
      () =>
        resolverContract(CONFIG.contracts.resolver, signer!).dispute(detail.address, {
          value: cfg!.escalationDeposit,
        }) as Promise<ContractTransactionResponse>,
    );
  const finalize = () =>
    run(
      "Finalizing resolution",
      "finalize",
      () =>
        resolverContract(CONFIG.contracts.resolver, signer!).finalize(
          detail.address,
        ) as Promise<ContractTransactionResponse>,
    );
  const timeout = () =>
    run(
      "Timing out → Invalid",
      "timeout",
      () =>
        resolverContract(CONFIG.contracts.resolver, signer!).timeoutResolution(
          detail.address,
        ) as Promise<ContractTransactionResponse>,
    );
  const settle = () =>
    run(
      "Settling market",
      "settle",
      () =>
        settlementContract(signer!).settle(detail.address) as Promise<ContractTransactionResponse>,
    );

  // Decide the body. Returns null when there's nothing actionable (open market
  // pre-close, or finalized + already settled — the receipt covers that).
  const body = (() => {
    if (phase === ResolverPhase.None) {
      if (marketResolved || now < detail.deadline) return null;
      return (
        <>
          <Status
            tone="ready"
            text="This market has closed. Propose an outcome to start bonded resolution."
          />
          <Button onClick={() => setProposeOpen(true)} disabled={!cfg}>
            <Gavel className="size-4" />
            Propose resolution
          </Button>
          {insufficientBond && (
            <p className="text-xs text-no">Needs {fmt(cfg!.bond)} SEER Points to bond.</p>
          )}
        </>
      );
    }

    if (phase === ResolverPhase.AwaitingSources || phase === ResolverPhase.AwaitingInference) {
      const what = phase === ResolverPhase.AwaitingSources ? "gathering sources" : "running inference";
      return (
        <>
          <Status tone="wait" text={`Agent network is ${what}…`} />
          {canTimeout && <TimeoutButton onClick={timeout} busy={busy} />}
        </>
      );
    }

    if (phase === ResolverPhase.Challenge && resolution) {
      const open = now < resolution.challengeDeadline;
      if (open) {
        return (
          <>
            <Status
              tone="ready"
              text={`Outcome proposed. Challenge window closes in ${timeUntil(resolution.challengeDeadline)}.`}
            />
            <Button variant="secondary" onClick={dispute} loading={busy} disabled={insufficientBond}>
              <Scale className="size-4" />
              Dispute outcome
            </Button>
            {insufficientBond && (
              <p className="text-xs text-no">Needs {fmt(cfg!.bond)} SEER Points to match the bond.</p>
            )}
          </>
        );
      }
      return (
        <>
          <Status tone="ready" text="Challenge window closed with no dispute — ready to finalize." />
          <Button onClick={finalize} loading={busy}>
            <CheckCheck className="size-4" />
            Finalize outcome
          </Button>
        </>
      );
    }

    if (phase === ResolverPhase.Disputed) {
      return (
        <>
          <Status tone="wait" text="Disputed — awaiting the escalation committee's verdict." />
          {canTimeout && <TimeoutButton onClick={timeout} busy={busy} />}
        </>
      );
    }

    if (phase === ResolverPhase.Finalized && !marketResolved) {
      return (
        <>
          <Status tone="ready" text="Resolution finalized. Settle the market to unlock claims." />
          <Button onClick={settle} loading={busy}>
            <CheckCheck className="size-4" />
            Settle market
          </Button>
        </>
      );
    }

    return null;
  })();

  if (!body) return null;

  return (
    <>
      <Card className="grid gap-3 p-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Gavel className="size-4 text-accent" />
          Resolution
        </div>
        {body}
      </Card>

      {cfg && (
        <ProposeModal
          open={proposeOpen}
          onClose={() => setProposeOpen(false)}
          market={detail.address}
          question={detail.question}
          proposeValue={proposeValue}
          bond={cfg.bond}
          onProposed={onAction}
        />
      )}
    </>
  );
}

function Status({ tone, text }: { tone: "wait" | "ready"; text: string }) {
  return (
    <p className="flex items-start gap-2 text-[13px] leading-relaxed text-muted">
      {tone === "wait" ? (
        <Hourglass className="mt-0.5 size-3.5 shrink-0 text-faint" />
      ) : (
        <span className="mt-1 size-1.5 shrink-0 rounded-full bg-accent" />
      )}
      {text}
    </p>
  );
}

function TimeoutButton({ onClick, busy }: { onClick: () => void; busy: boolean }) {
  return (
    <Button variant="ghost" onClick={onClick} loading={busy}>
      <AlertTriangle className="size-4" />
      Timeout → Invalid + refund
    </Button>
  );
}

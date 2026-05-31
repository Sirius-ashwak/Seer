import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import type { ContractTransactionResponse } from "ethers";
import { Button } from "@/components/ui/Button";
import { SIDE } from "@/abi";
import { useWallet } from "@/hooks/useWallet";
import { marketContract, readProvider } from "@/lib/contracts";
import { clearCommit } from "@/lib/commits";
import { record } from "@/lib/activity";
import { runTx } from "@/lib/tx";
import { fmt } from "@/lib/format";
import type { PendingCommit } from "@/types";

interface CommitRevealPanelProps {
  market: string;
  question?: string;
  pending: PendingCommit;
  onResolved: () => void;
  onDiscard: () => void;
}

export function CommitRevealPanel({
  market,
  question,
  pending,
  onResolved,
  onDiscard,
}: CommitRevealPanelProps) {
  const { account, signer } = useWallet();
  const [busy, setBusy] = useState(false);

  const shares = BigInt(pending.shares);
  const limit = BigInt(pending.limit);
  const sideLabel = pending.side === SIDE.Yes ? "YES" : "NO";

  const reveal = async () => {
    if (!signer || !account) return;
    setBusy(true);
    try {
      const current = await readProvider.getBlockNumber();
      if (current <= pending.commitBlock) {
        toast.error(`Wait for block ${pending.commitBlock + 1} (now ${current}) before revealing.`);
        return;
      }
      const m = marketContract(market, signer);
      const ok = await runTx(
        `Revealing ${pending.isBuy ? "buy" : "sell"} of ${fmt(shares)} ${sideLabel}`,
        () =>
          (pending.isBuy
            ? m.revealBuy(pending.side, shares, limit, pending.salt)
            : m.revealSell(pending.side, shares, limit, pending.salt)) as Promise<ContractTransactionResponse>,
      );
      if (ok) {
        clearCommit(market, account);
        record(account, {
          type: "reveal",
          market,
          question,
          detail: `Reveal ${pending.isBuy ? "buy" : "sell"} ${fmt(shares)} ${sideLabel}`,
          hash: ok,
        });
        onResolved();
      }
    } finally {
      setBusy(false);
    }
  };

  const discard = () => {
    if (account) clearCommit(market, account);
    onDiscard();
  };

  return (
    <div className="rounded-[var(--radius-card)] border border-accent/40 bg-accent/5 p-5">
      <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-ink">
        <ShieldCheck className="size-4 text-accent" />
        MEV guard — reveal pending
      </div>
      <p className="mb-4 text-[13px] leading-relaxed text-muted">
        Committed a{" "}
        <span className="font-medium text-ink">
          {pending.isBuy ? "buy" : "sell"} of {fmt(shares)} {sideLabel}
        </span>{" "}
        at block {pending.commitBlock}. Reveal on a later block to execute it atomically.
      </p>
      <div className="flex gap-2.5">
        <Button variant="primary" loading={busy} onClick={() => void reveal()}>
          Reveal &amp; execute
        </Button>
        <Button variant="ghost" onClick={discard} disabled={busy}>
          Discard
        </Button>
      </div>
    </div>
  );
}

import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import type { ContractTransactionResponse } from "ethers";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { useWallet } from "@/hooks/useWallet";
import { marketContract } from "@/lib/contracts";
import { record } from "@/lib/activity";
import { runTx } from "@/lib/tx";
import type { MarketDetail } from "@/types";

export function ClaimPanel({ detail, onClaimed }: { detail: MarketDetail; onClaimed: () => void }) {
  const { account, signer, connect } = useWallet();
  const [busy, setBusy] = useState(false);

  if (detail.claimed) {
    return (
      <Card className="flex items-center gap-2.5 p-5 text-sm text-muted">
        <CheckCircle2 className="size-4 text-yes" />
        You've already claimed this market.
      </Card>
    );
  }

  const claim = async () => {
    if (!account || !signer) {
      void connect();
      return;
    }
    setBusy(true);
    try {
      const ok = await runTx(
        "Claiming winnings",
        () => marketContract(detail.address, signer).claim() as Promise<ContractTransactionResponse>,
      );
      if (ok) {
        record(account, {
          type: "claim",
          market: detail.address,
          question: detail.question,
          detail: "Claim winnings",
        });
        onClaimed();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="grid gap-3 p-5">
      <Button size="lg" loading={busy} onClick={() => void claim()}>
        {account ? "Claim winnings" : "Connect wallet to claim"}
      </Button>
      <p className="text-xs leading-relaxed text-faint">
        Winning shares redeem 1:1 for SEER; an Invalid market refunds net collateral.
      </p>
    </Card>
  );
}

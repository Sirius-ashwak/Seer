import { Droplets } from "lucide-react";
import type { ContractTransactionResponse } from "ethers";
import { Button } from "@/components/ui/Button";
import { useWallet } from "@/hooks/useWallet";
import { useFaucet } from "@/hooks/useFaucet";
import { factoryContract } from "@/lib/contracts";
import { runTx } from "@/lib/tx";
import { fmtCompact } from "@/lib/format";

export function FaucetButton() {
  const { account, signer, refreshBalance } = useWallet();
  const { amount, onCooldown, readyAt, refresh } = useFaucet();

  // Hidden unless connected and the faucet is open.
  if (!account || amount === 0n) return null;

  const claim = async () => {
    if (!signer) return;
    const ok = await runTx("Claiming test Points", () =>
      factoryContract(signer).faucet() as Promise<ContractTransactionResponse>,
    );
    if (ok) {
      await Promise.all([refreshBalance(), refresh()]);
    }
  };

  if (onCooldown) {
    const ready = new Date(readyAt * 1000).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    return (
      <Button variant="secondary" size="sm" disabled title={`Next claim at ${ready}`}>
        <Droplets className="size-4" />
        Faucet · {ready}
      </Button>
    );
  }

  return (
    <Button variant="secondary" size="sm" onClick={() => void claim()}>
      <Droplets className="size-4" />
      Get {fmtCompact(amount)} Points
    </Button>
  );
}

import { Droplets } from "lucide-react";
import type { ContractTransactionResponse } from "ethers";
import { useWallet } from "@/hooks/useWallet";
import { useFaucet } from "@/hooks/useFaucet";
import { factoryContract } from "@/lib/contracts";
import { runTx } from "@/lib/tx";
import { fmtCompact } from "@/lib/format";

const ROW =
  "flex w-full items-center gap-2 rounded-[calc(var(--radius-control)-3px)] px-2.5 py-2 text-left text-[13px] text-muted transition-colors duration-100 hover:bg-panel-2 hover:text-ink disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent disabled:hover:text-muted";

// Renders as a row inside the header overflow menu. Hidden unless connected and
// the faucet is open.
export function FaucetButton({ onDone }: { onDone?: () => void }) {
  const { account, signer, refreshBalance } = useWallet();
  const { amount, onCooldown, readyAt, refresh } = useFaucet();

  if (!account || amount === 0n) return null;

  const claim = async () => {
    if (!signer) return;
    const ok = await runTx("Claiming test Points", () =>
      factoryContract(signer).faucet() as Promise<ContractTransactionResponse>,
    );
    if (ok) {
      await Promise.all([refreshBalance(), refresh()]);
    }
    onDone?.();
  };

  if (onCooldown) {
    const ready = new Date(readyAt * 1000).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    return (
      <button type="button" role="menuitem" disabled className={ROW}>
        <Droplets className="size-3.5 shrink-0" />
        Faucet · next at {ready}
      </button>
    );
  }

  return (
    <button type="button" role="menuitem" onClick={() => void claim()} className={ROW}>
      <Droplets className="size-3.5 shrink-0" />
      Faucet · get {fmtCompact(amount)} Points
    </button>
  );
}

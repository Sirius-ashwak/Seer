import { Wallet } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useWallet } from "@/hooks/useWallet";
import { short } from "@/lib/format";

export function ConnectButton() {
  const { account, connect, connecting, hasWallet, wrongChain, switchChain } = useWallet();

  if (!hasWallet) {
    return (
      <Button
        variant="primary"
        size="sm"
        onClick={() => window.open("https://metamask.io/download/", "_blank")}
      >
        <Wallet className="size-4" />
        Install wallet
      </Button>
    );
  }

  if (account && wrongChain) {
    return (
      <Button variant="no" size="sm" onClick={() => void switchChain()}>
        Wrong network — switch
      </Button>
    );
  }

  if (account) {
    return (
      <span className="inline-flex h-8 items-center gap-2 rounded-[var(--radius-control)] border border-line bg-panel-2 px-3 font-mono text-[13px] text-ink">
        <span className="size-1.5 rounded-full bg-yes shadow-[0_0_8px] shadow-yes/70" />
        {short(account)}
      </span>
    );
  }

  return (
    <Button variant="primary" size="sm" loading={connecting} onClick={() => void connect()}>
      <Wallet className="size-4" />
      Connect wallet
    </Button>
  );
}

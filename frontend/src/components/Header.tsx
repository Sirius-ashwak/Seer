import { ConnectButton } from "@/components/ConnectButton";
import { FaucetButton } from "@/components/FaucetButton";
import { useWallet } from "@/hooks/useWallet";
import { CONFIG } from "@/config";
import { fmt } from "@/lib/format";

export function Header() {
  const { account, balance } = useWallet();

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-canvas/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5">
        <div className="flex items-baseline gap-2.5">
          <span className="text-lg font-semibold tracking-tight text-ink">SEER</span>
          <span className="hidden text-[13px] text-faint sm:inline">
            bonded prediction markets
          </span>
        </div>

        <div className="flex items-center gap-2.5">
          <span className="hidden items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs text-muted sm:inline-flex">
            <span className="size-1.5 rounded-full bg-accent" />
            {CONFIG.label}
          </span>

          {account && (
            <span className="tnum hidden text-sm text-ink sm:inline">
              {fmt(balance)} <span className="text-faint">SEER</span>
            </span>
          )}

          <FaucetButton />
          <ConnectButton />
        </div>
      </div>
    </header>
  );
}

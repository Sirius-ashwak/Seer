import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Copy, ExternalLink, LogOut, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { useWallet } from "@/hooks/useWallet";
import { explorerAddress } from "@/lib/contracts";
import { short } from "@/lib/format";
import { cn } from "@/lib/utils";

export function ConnectButton() {
  const { account, connect, connecting, hasWallet, wrongChain, switchChain, disconnect } =
    useWallet();

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
    return <AccountMenu account={account} onDisconnect={disconnect} />;
  }

  return (
    <Button variant="primary" size="sm" loading={connecting} onClick={() => void connect()}>
      <Wallet className="size-4" />
      Connect wallet
    </Button>
  );
}

function AccountMenu({ account, onDisconnect }: { account: string; onDisconnect: () => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const explorer = explorerAddress(account);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(account);
      toast.success("Address copied");
    } catch {
      toast.error("Couldn't copy address");
    }
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex h-8 items-center gap-2 rounded-[var(--radius-control)] border border-line bg-panel-2 px-3 font-mono text-[13px] text-ink",
          "transition-colors duration-150 hover:border-line-strong",
        )}
      >
        <span className="size-1.5 rounded-full bg-yes shadow-[0_0_8px] shadow-yes/70" />
        {short(account)}
        <ChevronDown
          className={cn("size-3.5 text-faint transition-transform", open && "rotate-180")}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, scale: 0.97, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: -2 }}
            transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
            className="surface-pop absolute right-0 z-30 mt-1.5 w-44 overflow-hidden rounded-[var(--radius-control)] p-1"
          >
            <MenuItem onClick={() => void copy()}>
              <Copy className="size-3.5" />
              Copy address
            </MenuItem>
            {explorer && (
              <a
                href={explorer}
                target="_blank"
                rel="noreferrer"
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex w-full items-center gap-2 rounded-[calc(var(--radius-control)-3px)] px-2.5 py-2 text-left text-[13px] text-muted transition-colors duration-100 hover:bg-panel-2 hover:text-ink"
              >
                <ExternalLink className="size-3.5" />
                View on explorer
              </a>
            )}
            <MenuItem
              onClick={() => {
                onDisconnect();
                setOpen(false);
              }}
            >
              <LogOut className="size-3.5" />
              Disconnect
            </MenuItem>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function MenuItem({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-[calc(var(--radius-control)-3px)] px-2.5 py-2 text-left text-[13px] text-muted transition-colors duration-100 hover:bg-panel-2 hover:text-ink"
    >
      {children}
    </button>
  );
}

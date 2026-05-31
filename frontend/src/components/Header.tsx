import { Briefcase, Home, LineChart, Plus, Settings, Sparkles } from "lucide-react";
import { ConnectButton } from "@/components/ConnectButton";
import { FaucetButton } from "@/components/FaucetButton";
import { Button } from "@/components/ui/Button";
import { Tabs, type TabOption } from "@/components/ui/Tabs";
import { useWallet } from "@/hooks/useWallet";
import { CONFIG } from "@/config";
import { fmt } from "@/lib/format";

export type ViewKey = "overview" | "markets" | "portfolio";

const TABS: TabOption<ViewKey>[] = [
  { label: "Overview", value: "overview", icon: Home },
  { label: "Markets", value: "markets", icon: LineChart },
  { label: "Portfolio", value: "portfolio", icon: Briefcase },
];

interface HeaderProps {
  view: ViewKey;
  onView: (v: ViewKey) => void;
  onCreate: () => void;
  onSettings: () => void;
  onAsk: () => void;
}

export function Header({ view, onView, onCreate, onSettings, onAsk }: HeaderProps) {
  const { account, balance } = useWallet();

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-canvas/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-5">
        <div className="flex items-baseline gap-2.5">
          <span className="brand-wordmark text-lg font-semibold tracking-tight">SEER</span>
          <span className="hidden text-[13px] text-faint md:inline">bonded prediction markets</span>
        </div>

        <nav className="ml-2 hidden sm:block">
          <Tabs aria-label="Views" value={view} onChange={onView} options={TABS} />
        </nav>

        <div className="ml-auto flex items-center gap-2.5">
          <span className="hidden items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs text-muted lg:inline-flex">
            <span className="size-1.5 rounded-full bg-accent" />
            {CONFIG.label}
          </span>

          {account && (
            <span className="tnum hidden text-sm text-ink sm:inline">
              {fmt(balance)} <span className="text-faint">SEER</span>
            </span>
          )}

          <Button variant="secondary" size="sm" onClick={onAsk}>
            <Sparkles className="size-4 text-accent" />
            <span className="hidden sm:inline">Ask SEER</span>
          </Button>

          <Button variant="secondary" size="sm" onClick={onCreate}>
            <Plus className="size-4" />
            <span className="hidden sm:inline">Create</span>
          </Button>

          <FaucetButton />
          <ConnectButton />

          <button
            onClick={onSettings}
            aria-label="Settings"
            className="grid size-8 shrink-0 place-items-center rounded-[var(--radius-control)] border border-line bg-panel-2 text-muted transition-colors hover:border-line-strong hover:text-ink"
          >
            <Settings className="size-4" />
          </button>
        </div>
      </div>

      {/* Tabs on mobile, below the brand row. */}
      <div className="mx-auto -mt-1 max-w-6xl px-5 pb-3 sm:hidden">
        <Tabs
          aria-label="Views"
          layoutId="tab-indicator-mobile"
          value={view}
          onChange={onView}
          options={TABS}
        />
      </div>
    </header>
  );
}

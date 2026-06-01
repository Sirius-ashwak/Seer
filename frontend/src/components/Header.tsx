import { Briefcase, Home, LineChart, Plus, Sparkles } from "lucide-react";
import { ConnectButton } from "@/components/ConnectButton";
import { HeaderMenu } from "@/components/HeaderMenu";
import { NotificationsBell } from "@/components/NotificationsBell";
import { Button } from "@/components/ui/Button";
import { Tabs, type TabOption } from "@/components/ui/Tabs";
import { useWallet } from "@/hooks/useWallet";
import { fmt } from "@/lib/format";
import type { MarketSummary } from "@/types";

export type ViewKey = "overview" | "markets" | "portfolio";

const TABS: TabOption<ViewKey>[] = [
  { label: "Overview", value: "overview", icon: Home },
  { label: "Markets", value: "markets", icon: LineChart },
  { label: "Portfolio", value: "portfolio", icon: Briefcase },
];

interface HeaderProps {
  view: ViewKey;
  onView: (v: ViewKey) => void;
  markets: MarketSummary[];
  onSelect: (address: string) => void;
  onCreate: () => void;
  onSettings: () => void;
  onAsk: () => void;
}

export function Header({
  view,
  onView,
  markets,
  onSelect,
  onCreate,
  onSettings,
  onAsk,
}: HeaderProps) {
  const { account, balance } = useWallet();

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-canvas/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-5">
        <a href="#/" className="flex items-baseline gap-2.5" aria-label="SEER home">
          <span className="brand-wordmark text-lg font-semibold tracking-tight">SEER</span>
          <span className="hidden text-[13px] text-faint md:inline">bonded prediction markets</span>
        </a>

        <nav className="ml-2 hidden sm:block">
          <Tabs aria-label="Views" value={view} onChange={onView} options={TABS} />
        </nav>

        <div className="ml-auto flex items-center gap-2.5">
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

          {account && <NotificationsBell account={account} markets={markets} onSelect={onSelect} />}
          <ConnectButton />
          <HeaderMenu onSettings={onSettings} />
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

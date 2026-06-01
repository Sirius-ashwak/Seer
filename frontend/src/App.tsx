import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Toaster } from "sonner";
import { WalletProvider, useWallet } from "@/hooks/useWallet";
import { useMarkets } from "@/hooks/useMarkets";
import { Header, type ViewKey } from "@/components/Header";
import { MarketGrid } from "@/components/MarketGrid";
import { MarketDetail } from "@/components/MarketDetail";
import {
  MarketToolbar,
  applyMarketFilters,
  type ToolbarState,
} from "@/components/MarketToolbar";
import { Portfolio } from "@/components/Portfolio";
import { Overview } from "@/components/Overview";
import { Landing } from "@/components/Landing";
import { AskSeer } from "@/components/AskSeer";
import { CreateMarketModal } from "@/components/CreateMarketModal";
import { SettingsModal } from "@/components/SettingsModal";
import { CommandPalette } from "@/components/CommandPalette";

const fade = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
  transition: { duration: 0.22, ease: [0.16, 1, 0.3, 1] as const },
};

interface Route {
  view: ViewKey;
  selected: string | null;
}

function parseHash(): Route {
  const h = window.location.hash;
  if (h.startsWith("#/m/")) return { view: "markets", selected: h.slice(4) };
  if (h === "#/markets") return { view: "markets", selected: null };
  if (h === "#/portfolio") return { view: "portfolio", selected: null };
  return { view: "overview", selected: null };
}

function routeToHash({ view, selected }: Route): string {
  if (selected) return `#/m/${selected}`;
  if (view === "portfolio") return "#/portfolio";
  if (view === "markets") return "#/markets";
  return "#/overview";
}

// `#/` (the bare root) is the marketing landing, which renders outside the app
// shell; every other hash is an in-app route handled by AppShell.
function useHashRoute(): string {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onHash = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return hash;
}

function Root() {
  const hash = useHashRoute();
  const isLanding = hash === "" || hash === "#" || hash === "#/";
  return isLanding ? <Landing /> : <AppShell />;
}

function AppShell() {
  const { account, refreshBalance } = useWallet();
  const { markets, loading, error, configured, refresh } = useMarkets();

  const initial = parseHash();
  const [view, setView] = useState<ViewKey>(initial.view);
  const [selected, setSelected] = useState<string | null>(initial.selected);
  const [toolbar, setToolbar] = useState<ToolbarState>({
    query: "",
    filter: "all",
    sort: "closing",
  });
  const [createOpen, setCreateOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // ⌘K / Ctrl+K toggles the command palette from anywhere in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Keep the URL hash in sync with the active route (shareable links).
  useEffect(() => {
    const target = routeToHash({ view, selected });
    if (window.location.hash !== target) window.location.hash = target;
  }, [view, selected]);

  useEffect(() => {
    const onHash = () => {
      const r = parseHash();
      setView(r.view);
      setSelected(r.selected);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const afterTrade = () => {
    void refreshBalance();
    void refresh();
  };

  const filtered = useMemo(() => applyMarketFilters(markets, toolbar), [markets, toolbar]);

  return (
    <div className="min-h-dvh">
      <Header
        view={view}
        onView={(v) => {
          setSelected(null);
          setView(v);
        }}
        markets={markets}
        onSelect={setSelected}
        onCreate={() => setCreateOpen(true)}
        onSettings={() => setSettingsOpen(true)}
        onAsk={() => setAskOpen(true)}
      />

      <main className="mx-auto max-w-6xl px-5 py-8">
        <AnimatePresence mode="wait">
          {selected ? (
            <motion.div key={`detail-${selected}`} {...fade}>
              <MarketDetail
                address={selected}
                account={account}
                onBack={() => {
                  setSelected(null);
                  void refresh();
                }}
                afterTrade={afterTrade}
              />
            </motion.div>
          ) : view === "overview" ? (
            <motion.div key="overview" {...fade}>
              <div className="mb-6">
                <h1 className="text-xl font-semibold tracking-tight text-ink">Overview</h1>
                <p className="mt-1 text-sm text-muted">
                  Your portfolio at a glance, markets closing soon, and anything awaiting a dispute.
                </p>
              </div>
              <Overview
                markets={markets}
                loading={loading}
                account={account}
                onSelect={setSelected}
                onView={(v) => {
                  setSelected(null);
                  setView(v);
                }}
                onAsk={() => setAskOpen(true)}
              />
            </motion.div>
          ) : view === "portfolio" ? (
            <motion.div key="portfolio" {...fade}>
              <div className="mb-6">
                <h1 className="text-xl font-semibold tracking-tight text-ink">Portfolio</h1>
                <p className="mt-1 text-sm text-muted">
                  Your positions, claimable winnings, and recent activity.
                </p>
              </div>
              <Portfolio account={account} onSelect={setSelected} afterAction={afterTrade} />
            </motion.div>
          ) : (
            <motion.div key="markets" {...fade}>
              <div className="mb-6 flex flex-col gap-4">
                <div>
                  <h1 className="text-xl font-semibold tracking-tight text-ink">Markets</h1>
                  <p className="mt-1 text-sm text-muted">
                    Trade outcomes on an LS-LMSR curve. Resolution is bonded and agent-driven.
                  </p>
                </div>
                {configured && markets.length > 0 && (
                  <MarketToolbar
                    state={toolbar}
                    onChange={setToolbar}
                    resultCount={filtered.length}
                    totalCount={markets.length}
                  />
                )}
              </div>
              <MarketGrid
                markets={filtered}
                totalCount={markets.length}
                loading={loading}
                error={error}
                configured={configured}
                onSelect={setSelected}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <footer className="mx-auto max-w-6xl px-5 py-10 text-xs text-faint">
        SEER · play-money SEER Points · bonded optimistic resolution
      </footer>

      <CreateMarketModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        afterCreate={() => {
          setView("markets");
          setToolbar((t) => ({ ...t, sort: "newest", filter: "all", query: "" }));
          void refresh();
        }}
      />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <AskSeer
        open={askOpen}
        onClose={() => setAskOpen(false)}
        markets={markets}
        account={account}
      />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        markets={markets}
        onView={(v) => {
          setSelected(null);
          setView(v);
        }}
        onSelect={setSelected}
        onCreate={() => setCreateOpen(true)}
        onAsk={() => setAskOpen(true)}
        onSettings={() => setSettingsOpen(true)}
      />
    </div>
  );
}

export default function App() {
  return (
    <WalletProvider>
      <Root />
      <Toaster
        theme="dark"
        position="top-right"
        toastOptions={{
          style: {
            background: "var(--color-panel-2)",
            border: "1px solid var(--color-line)",
            color: "var(--color-ink)",
          },
        }}
      />
    </WalletProvider>
  );
}

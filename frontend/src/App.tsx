import { useState } from "react";
import { Toaster } from "sonner";
import { WalletProvider, useWallet } from "@/hooks/useWallet";
import { useMarkets } from "@/hooks/useMarkets";
import { Header } from "@/components/Header";
import { MarketGrid } from "@/components/MarketGrid";
import { MarketDetail } from "@/components/MarketDetail";

function AppShell() {
  const { account, refreshBalance } = useWallet();
  const { markets, loading, error, configured, refresh } = useMarkets();
  const [selected, setSelected] = useState<string | null>(null);

  const afterTrade = () => {
    void refreshBalance();
    void refresh();
  };

  return (
    <div className="min-h-dvh">
      <Header />
      <main className="mx-auto max-w-6xl px-5 py-8">
        {selected ? (
          <MarketDetail
            address={selected}
            account={account}
            onBack={() => {
              setSelected(null);
              void refresh();
            }}
            afterTrade={afterTrade}
          />
        ) : (
          <>
            <div className="mb-6">
              <h1 className="text-xl font-semibold tracking-tight text-ink">Markets</h1>
              <p className="mt-1 text-sm text-muted">
                Trade outcomes on an LS-LMSR curve. Resolution is bonded and agent-driven.
              </p>
            </div>
            <MarketGrid
              markets={markets}
              loading={loading}
              error={error}
              configured={configured}
              onSelect={setSelected}
            />
          </>
        )}
      </main>
      <footer className="mx-auto max-w-6xl px-5 py-10 text-xs text-faint">
        SEER · play-money SEER Points · bonded optimistic resolution
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <WalletProvider>
      <AppShell />
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

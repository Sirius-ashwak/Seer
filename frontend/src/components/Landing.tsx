import { motion } from "framer-motion";
import {
  ArrowRight,
  Bot,
  Coins,
  Gavel,
  LineChart,
  type LucideIcon,
} from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { ConnectButton } from "@/components/ConnectButton";
import { MarketCard } from "@/components/MarketCard";
import { useMarkets } from "@/hooks/useMarkets";
import { Outcome } from "@/abi";
import { fmtCompact } from "@/lib/format";
import { CONFIG } from "@/config";

// The marketing front door at `#/`. Renders outside AppShell, so it owns its
// own nav + footer (no app tabs). Every "stat" is computed from live contract
// reads via useMarkets — nothing here is fabricated.

const go = (hash: string) => () => {
  window.location.hash = hash;
};

const FEATURES: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: Gavel,
    title: "Bonded resolution",
    body: "A proposer stakes a bond to settle a market. A public challenge window lets anyone dispute — the wrong side forfeits its bond to the right one.",
  },
  {
    icon: Bot,
    title: "On-chain agent oracle",
    body: "Resolution gathers three independent sources, then an LLM returns a verdict. Sources, prompt, and raw response are all recorded on-chain.",
  },
  {
    icon: LineChart,
    title: "LS-LMSR liquidity",
    body: "An automated market maker prices every trade along a curve — no order book, no counterparty to find, always tradable.",
  },
  {
    icon: Coins,
    title: "Play-money points",
    body: "Markets settle in soulbound SEER Points — risk-free and educational. Top up from the faucet and start trading in seconds.",
  },
];

const STEPS: { n: string; title: string; body: string }[] = [
  {
    n: "1",
    title: "Trade",
    body: "Buy YES or NO on an LS-LMSR curve. The marginal price is the market's live read on the odds.",
  },
  {
    n: "2",
    title: "Resolve",
    body: "After the deadline, a bonded proposer requests the agent oracle's verdict — open to challenge.",
  },
  {
    n: "3",
    title: "Settle",
    body: "Once final, the outcome lands on-chain and winning shares redeem 1:1 in SEER Points.",
  },
];

export function Landing() {
  const { markets, loading, error, configured } = useMarkets();

  const open = markets.filter((m) => m.outcome === Outcome.Pending);
  const preview = [...open].sort((a, b) => a.deadline - b.deadline).slice(0, 3);
  const sharesOutstanding = markets.reduce((s, m) => s + m.qYes + m.qNo, 0n);
  const statsReady = configured && !loading && !error && markets.length > 0;

  return (
    <div className="min-h-dvh">
      {/* Landing nav — mirrors the app Header chrome, but with marketing CTAs. */}
      <header className="sticky top-0 z-20 border-b border-line bg-canvas/70 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-5">
          <div className="flex items-baseline gap-2.5">
            <span className="brand-wordmark text-lg font-semibold tracking-tight">SEER</span>
            <span className="hidden text-[13px] text-faint md:inline">bonded prediction markets</span>
          </div>

          <div className="ml-auto flex items-center gap-2.5">
            <span className="hidden items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs text-muted lg:inline-flex">
              <span className="size-1.5 rounded-full bg-accent" />
              {CONFIG.label}
            </span>
            <ConnectButton />
            <Button variant="ghost" size="sm" onClick={go("#/markets")}>
              <span className="hidden sm:inline">Explore markets</span>
              <span className="sm:hidden">Markets</span>
            </Button>
            <Button variant="primary" size="sm" onClick={go("#/overview")}>
              Launch app
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5">
        {/* Hero */}
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="flex flex-col items-center gap-6 py-20 text-center sm:py-28"
        >
          <span className="inline-flex items-center gap-2 rounded-full border border-line bg-panel-2/60 px-3 py-1 text-xs text-muted">
            <span className="size-1.5 rounded-full bg-accent" />
            Play-money SEER Points · testnet · not financial advice
          </span>

          <h1 className="font-hero max-w-3xl text-balance text-5xl leading-[1.05] text-ink sm:text-6xl">
            Prediction markets that resolve themselves.
          </h1>

          <p className="max-w-2xl text-pretty text-base leading-relaxed text-muted sm:text-lg">
            SEER settles every market through a bonded, agent-run oracle — three independent sources,
            an on-chain LLM verdict, and a public challenge window. Trade outcomes on an always-on
            LS-LMSR curve, fully on-chain, with risk-free points.
          </p>

          <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
            <Button variant="primary" size="lg" className="cta-glow" onClick={go("#/markets")}>
              Explore markets
              <ArrowRight className="size-4" />
            </Button>
            <Button variant="secondary" size="lg" onClick={go("#/overview")}>
              Open dashboard
            </Button>
          </div>
        </motion.section>

        {/* Live markets strip — real open markets, soonest first. */}
        <section className="grid gap-3 pb-6">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-ink">Live markets</h2>
            <button
              onClick={go("#/markets")}
              className="inline-flex items-center gap-1 text-[13px] text-muted transition-colors hover:text-ink"
            >
              View all <ArrowRight className="size-3.5" />
            </button>
          </div>

          {loading ? (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-52 w-full rounded-[var(--radius-card)]" />
              ))}
            </div>
          ) : preview.length > 0 ? (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {preview.map((m, i) => (
                <MarketCard
                  key={m.address}
                  market={m}
                  index={i}
                  onSelect={(addr) => (window.location.hash = `#/m/${addr}`)}
                />
              ))}
            </div>
          ) : (
            <Card className="flex flex-col items-center gap-3 px-6 py-12 text-center">
              <LineChart className="size-5 text-faint" />
              <p className="text-sm text-faint">
                {configured && !error
                  ? "No open markets are trading right now."
                  : "Markets go live here once the network is reachable."}
              </p>
              <Button size="sm" variant="secondary" onClick={go("#/markets")}>
                Explore markets
              </Button>
            </Card>
          )}
        </section>

        {/* Why SEER — feature cards */}
        <section className="grid gap-4 py-12">
          <div className="grid gap-1">
            <h2 className="font-hero text-2xl text-ink">Built on bonded truth</h2>
            <p className="text-sm text-muted">
              Four pieces make SEER trustworthy without a centralized referee.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((f) => (
              <FeatureCard key={f.title} {...f} />
            ))}
          </div>
        </section>

        {/* How it works */}
        <section className="grid gap-4 py-12">
          <h2 className="font-hero text-2xl text-ink">How it works</h2>
          <div className="rule-fade" />
          <div className="grid gap-4 sm:grid-cols-3">
            {STEPS.map((s) => (
              <Card key={s.n} className="grid gap-2 p-5">
                <span className="font-hero text-3xl leading-none text-accent">{s.n}</span>
                <h3 className="text-[15px] font-semibold text-ink">{s.title}</h3>
                <p className="text-[13px] leading-relaxed text-muted">{s.body}</p>
              </Card>
            ))}
          </div>
        </section>

        {/* Live stats band — real counts from useMarkets. */}
        <section className="grid grid-cols-2 gap-4 py-12 sm:grid-cols-4">
          <Stat label="Markets" value={statsReady ? String(markets.length) : "—"} />
          <Stat label="Open" value={statsReady ? String(open.length) : "—"} />
          <Stat
            label="Resolved"
            value={statsReady ? String(markets.length - open.length) : "—"}
          />
          <Stat
            label="Shares outstanding"
            value={statsReady ? fmtCompact(sharesOutstanding) : "—"}
          />
        </section>

        {/* Final CTA */}
        <section className="py-12">
          <Card className="surface-pop flex flex-col items-center gap-5 px-6 py-14 text-center">
            <h2 className="font-hero max-w-xl text-balance text-3xl leading-tight text-ink sm:text-4xl">
              Take a position. Let the oracle settle it.
            </h2>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Button variant="primary" size="lg" className="cta-glow" onClick={go("#/markets")}>
                Start trading
                <ArrowRight className="size-4" />
              </Button>
              <Button variant="secondary" size="lg" onClick={go("#/overview")}>
                Open dashboard
              </Button>
            </div>
          </Card>
        </section>
      </main>

      <footer className="mx-auto max-w-6xl px-5 py-10 text-xs text-faint">
        SEER · play-money SEER Points · bonded optimistic resolution
      </footer>
    </div>
  );
}

function FeatureCard({ icon: Icon, title, body }: { icon: LucideIcon; title: string; body: string }) {
  return (
    <Card className="grid gap-3 p-5">
      <span className="grid size-9 place-items-center rounded-full border border-line bg-panel-2 text-accent">
        <Icon className="size-4" />
      </span>
      <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
      <p className="text-[13px] leading-relaxed text-muted">{body}</p>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="grid gap-1 p-5">
      <span className="font-hero tnum text-[34px] leading-none text-ink">{value}</span>
      <span className="text-xs font-medium uppercase tracking-wide text-faint">{label}</span>
    </Card>
  );
}

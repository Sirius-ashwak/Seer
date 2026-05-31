import { useEffect, useState } from "react";
import { Gavel, Hourglass, X } from "lucide-react";
import { resolverContract, readProvider } from "@/lib/contracts";
import { ResolverPhase, RESOLVER_OUTCOME_LABELS } from "@/abi";
import { CONFIG, ZERO_ADDRESS } from "@/config";
import type { MarketSummary } from "@/types";

interface ChallengeCTAProps {
  markets: MarketSummary[];
  onSelect: (address: string) => void;
}

interface Challengeable {
  address: string;
  question: string;
  proposedOutcome: number; // resolver Outcome enum (1 Invalid, 2 Yes, 3 No)
  deadline: number; // unix seconds
}

function fmtCountdown(secs: number): string {
  if (secs <= 0) return "0:00";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

// Surfaces SEER's differentiator — the bonded challenge window — as a hero CTA.
// Scans every market's resolver phase and shows the soonest-expiring one still
// open to dispute. Renders nothing when nothing is challengeable (no fake
// urgency). "Review & dispute" deep-links to the market, where the existing
// ResolutionActions flow lives.
export function ChallengeCTA({ markets, onSelect }: ChallengeCTAProps) {
  const [target, setTarget] = useState<Challengeable | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [dismissed, setDismissed] = useState(false);

  // Scan resolver state whenever the market set changes.
  useEffect(() => {
    const resolverAddr = CONFIG.contracts.resolver;
    if (!resolverAddr || resolverAddr === ZERO_ADDRESS || markets.length === 0) {
      setTarget(null);
      return;
    }
    let live = true;
    const nowSec = Math.floor(Date.now() / 1000);
    const r = resolverContract(resolverAddr, readProvider);

    void (async () => {
      try {
        const scanned = await Promise.all(
          markets.map(async (m) => {
            const phase = Number((await r.phaseOf(m.address)) as bigint);
            if (phase !== ResolverPhase.Challenge) return null;
            const [deadline, proposed] = await Promise.all([
              r.challengeDeadlineOf(m.address) as Promise<bigint>,
              r.proposedOutcomeOf(m.address) as Promise<bigint>,
            ]);
            const dl = Number(deadline);
            if (dl <= nowSec) return null;
            return { address: m.address, question: m.question, proposedOutcome: Number(proposed), deadline: dl };
          }),
        );
        if (!live) return;
        const open = scanned.filter((c): c is Challengeable => c !== null).sort((a, b) => a.deadline - b.deadline);
        setTarget(open[0] ?? null);
        setDismissed(false);
      } catch {
        if (live) setTarget(null);
      }
    })();

    return () => {
      live = false;
    };
  }, [markets]);

  // 1s tick only while a live countdown is showing.
  useEffect(() => {
    if (!target) return;
    const id = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(id);
  }, [target]);

  if (!target || dismissed) return null;
  const remaining = target.deadline - now;
  if (remaining <= 0) return null;

  const outcomeLabel = RESOLVER_OUTCOME_LABELS[target.proposedOutcome] ?? "an outcome";

  return (
    <button
      onClick={() => onSelect(target.address)}
      className="cta-glow relative block w-full overflow-hidden rounded-[var(--radius-card)] border border-line-strong p-5 text-left"
      style={{
        backgroundImage:
          "radial-gradient(130% 120% at 100% 0%, rgba(59,130,246,0.45), transparent 55%), linear-gradient(150deg, #1d3a8a 0%, #3a1d6e 55%, #131316 100%)",
      }}
    >
      <div className="flex items-center justify-between text-[11px] font-medium uppercase tracking-[0.14em] text-white/70">
        Resolution · challenge window open
        <span
          role="button"
          aria-label="Dismiss"
          onClick={(e) => {
            e.stopPropagation();
            setDismissed(true);
          }}
          className="grid size-6 place-items-center rounded-full text-white/60 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X className="size-4" />
        </span>
      </div>

      <div className="font-hero mt-5 text-[26px] leading-tight text-white">
        Dispute <span className="italic">or</span> it's final
      </div>
      <p className="mt-1 max-w-xl truncate text-sm text-white/75">
        {outcomeLabel} proposed on “{target.question}”
      </p>

      <div className="mt-4 flex items-center gap-3">
        <span className="tnum inline-flex items-center gap-2 rounded-full bg-black/30 px-3 py-1.5 text-[13px] text-white/90">
          <Hourglass className="size-3.5" />
          {fmtCountdown(remaining)} left to challenge
        </span>
        <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-white">
          <Gavel className="size-3.5" />
          Review &amp; dispute
        </span>
      </div>
    </button>
  );
}

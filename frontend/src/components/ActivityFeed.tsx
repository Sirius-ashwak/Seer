import { useEffect, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  Droplets,
  ExternalLink,
  Gavel,
  History,
  Lock,
  PlusCircle,
  ShieldCheck,
  Sparkles,
  Swords,
  Trophy,
  Unlock,
  type LucideIcon,
} from "lucide-react";
import { loadActivity, subscribeActivity, type ActivityType, type ActivityEntry } from "@/lib/activity";
import { explorerTx } from "@/lib/contracts";
import { timeAgo } from "@/lib/format";

const META: Record<ActivityType, { icon: LucideIcon; tint: string }> = {
  buy: { icon: ArrowUpRight, tint: "text-yes" },
  sell: { icon: ArrowDownLeft, tint: "text-no" },
  commit: { icon: Lock, tint: "text-accent" },
  reveal: { icon: Unlock, tint: "text-accent" },
  claim: { icon: Trophy, tint: "text-yes" },
  faucet: { icon: Droplets, tint: "text-muted" },
  create: { icon: PlusCircle, tint: "text-ink" },
  propose: { icon: Gavel, tint: "text-ink" },
  dispute: { icon: Swords, tint: "text-no" },
  finalize: { icon: ShieldCheck, tint: "text-yes" },
  settle: { icon: Banknote, tint: "text-ink" },
  timeout: { icon: History, tint: "text-muted" },
  simulate: { icon: Sparkles, tint: "text-accent" },
};

export function ActivityFeed({ account }: { account: string | null }) {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);

  useEffect(() => {
    const load = () => setEntries(loadActivity(account));
    load();
    return subscribeActivity(load);
  }, [account]);

  if (entries.length === 0) {
    return (
      <p className="rounded-[var(--radius-control)] border border-dashed border-line px-4 py-8 text-center text-sm text-faint">
        No activity yet. Trades, claims, and protocol actions you take will show up here.
      </p>
    );
  }

  return (
    <ol className="grid gap-1.5">
      {entries.map((e, i) => {
        const meta = META[e.type];
        const Icon = meta.icon;
        const href = e.hash ? explorerTx(e.hash) : null;
        return (
          <li
            key={`${e.ts}-${i}`}
            className="flex items-center gap-3 rounded-[var(--radius-control)] border border-line bg-panel-2/50 px-3 py-2.5"
          >
            <span className="grid size-7 shrink-0 place-items-center rounded-full border border-line bg-panel-2">
              <Icon className={`size-3.5 ${meta.tint}`} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] text-ink">{e.detail}</p>
              {e.question && <p className="truncate text-xs text-faint">{e.question}</p>}
            </div>
            <span className="tnum shrink-0 text-xs text-faint">{timeAgo(Math.floor(e.ts / 1000))}</span>
            {href && (
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 text-faint transition-colors hover:text-ink"
                aria-label="View on explorer"
              >
                <ExternalLink className="size-3.5" />
              </a>
            )}
          </li>
        );
      })}
    </ol>
  );
}

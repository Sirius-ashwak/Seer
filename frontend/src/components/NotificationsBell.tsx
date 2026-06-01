import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bell, Gavel } from "lucide-react";
import { RESOLVER_OUTCOME_LABELS } from "@/abi";
import { CONFIG } from "@/config";
import { loadActivity, subscribeActivity, type ActivityEntry } from "@/lib/activity";
import { useChallengeable } from "@/hooks/useChallengeable";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { MarketSummary } from "@/types";

interface NotificationsBellProps {
  account: string;
  markets: MarketSummary[];
  onSelect: (address: string) => void;
}

const MAX_ACTIVITY = 6;

function seenKey(account: string): string {
  return `seer:notifs:seen:${CONFIG.chainId}:${account.toLowerCase()}`;
}

function loadSeen(account: string): number {
  try {
    return Number(localStorage.getItem(seenKey(account))) || 0;
  } catch {
    return 0;
  }
}

function storeSeen(account: string, ts: number): void {
  try {
    localStorage.setItem(seenKey(account), String(ts));
  } catch {
    /* localStorage unavailable */
  }
}

function fmtShort(secs: number): string {
  if (secs <= 0) return "0:00";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

// A per-account alert center: recent local activity plus any market currently in
// the live challenge window (shared with ChallengeCTA via useChallengeable, so
// the RPC sweep runs once). Unread = activity newer than last-seen + the number
// of challengeable markets; opening the bell marks activity read.
export function NotificationsBell({ account, markets, onSelect }: NotificationsBellProps) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [lastSeen, setLastSeen] = useState(() => loadSeen(account));
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const rootRef = useRef<HTMLDivElement>(null);

  const challengeable = useChallengeable(markets);

  // Reload the per-account last-seen marker and activity whenever the account
  // changes, and keep the feed live via the activity subscription.
  useEffect(() => {
    setLastSeen(loadSeen(account));
    const load = () => setEntries(loadActivity(account));
    load();
    return subscribeActivity(load);
  }, [account]);

  // Tick once a second only while challenge countdowns are on screen.
  useEffect(() => {
    if (!open || challengeable.length === 0) return;
    const id = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(id);
  }, [open, challengeable.length]);

  // Outside-click + ESC to dismiss (mirrors the account menu / Select popover).
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

  const unreadActivity = useMemo(
    () => entries.filter((e) => e.ts > lastSeen).length,
    [entries, lastSeen],
  );
  const badge = unreadActivity + challengeable.length;

  const recent = entries.slice(0, MAX_ACTIVITY);
  const empty = challengeable.length === 0 && recent.length === 0;

  const toggle = () => {
    setOpen((v) => {
      const next = !v;
      // Opening marks all current activity as read.
      if (next) {
        const ts = Date.now();
        setLastSeen(ts);
        storeSeen(account, ts);
      }
      return next;
    });
  };

  const go = (address: string) => {
    onSelect(address);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label="Notifications"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
        className="relative grid size-8 shrink-0 place-items-center rounded-[var(--radius-control)] border border-line bg-panel-2 text-muted transition-colors hover:border-line-strong hover:text-ink"
      >
        <Bell className="size-4" />
        {badge > 0 && (
          <span className="tnum absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-none text-white">
            {badge > 9 ? "9+" : badge}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, scale: 0.97, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: -2 }}
            transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
            className="surface-pop absolute right-0 z-30 mt-1.5 w-80 overflow-hidden rounded-[var(--radius-control)] p-2"
          >
            <div className="px-1.5 pb-2 pt-1 text-[11px] font-medium uppercase tracking-wide text-faint">
              Notifications
            </div>

            {empty ? (
              <p className="px-1.5 py-6 text-center text-sm text-faint">You're all caught up.</p>
            ) : (
              <div className="grid gap-1">
                {challengeable.map((c) => {
                  const remaining = Math.max(0, c.deadline - now);
                  const label = RESOLVER_OUTCOME_LABELS[c.proposedOutcome] ?? "an outcome";
                  return (
                    <button
                      key={`ch-${c.address}`}
                      type="button"
                      onClick={() => go(c.address)}
                      className="flex w-full items-start gap-2.5 rounded-[calc(var(--radius-control)-3px)] border border-line-strong bg-panel-2 px-2.5 py-2 text-left transition-colors hover:border-accent"
                    >
                      <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-accent/15">
                        <Gavel className="size-3.5 text-accent" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-medium text-ink">
                          Review &amp; dispute
                        </span>
                        <span className="block truncate text-xs text-muted">{c.question}</span>
                        <span className="tnum mt-0.5 block text-xs text-faint">
                          {label} proposed · {fmtShort(remaining)} left
                        </span>
                      </span>
                    </button>
                  );
                })}

                {challengeable.length > 0 && recent.length > 0 && (
                  <div className="px-1.5 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-faint">
                    Recent
                  </div>
                )}

                {recent.map((e, i) => (
                  <div
                    key={`act-${e.ts}-${i}`}
                    className={cn(
                      "flex items-center gap-2.5 rounded-[calc(var(--radius-control)-3px)] px-2.5 py-2",
                      e.ts > lastSeen ? "bg-panel-2" : "",
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] text-ink">{e.detail}</p>
                      {e.question && <p className="truncate text-xs text-faint">{e.question}</p>}
                    </div>
                    <span className="tnum shrink-0 text-xs text-faint">
                      {timeAgo(Math.floor(e.ts / 1000))}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

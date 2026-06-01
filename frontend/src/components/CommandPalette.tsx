import { useEffect, useMemo, useRef, useState } from "react";
import {
  Briefcase,
  CornerDownLeft,
  Home,
  LineChart,
  Plus,
  Settings,
  Sparkles,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { short } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ViewKey } from "@/components/Header";
import type { MarketSummary } from "@/types";

interface Command {
  id: string;
  label: string;
  hint?: string;
  group: string;
  icon: LucideIcon;
  run: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  markets: MarketSummary[];
  onView: (v: ViewKey) => void;
  onSelect: (address: string) => void;
  onCreate: () => void;
  onAsk: () => void;
  onSettings: () => void;
}

const MAX_MARKETS = 8;

export function CommandPalette({
  open,
  onClose,
  markets,
  onView,
  onSelect,
  onCreate,
  onAsk,
  onSettings,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Reset on each open.
  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
    }
  }, [open]);

  const results = useMemo<Command[]>(() => {
    const q = query.trim().toLowerCase();
    const base: Command[] = [
      { id: "go-overview", label: "Overview", group: "Go to", icon: Home, run: () => onView("overview") },
      { id: "go-markets", label: "Markets", group: "Go to", icon: LineChart, run: () => onView("markets") },
      { id: "go-portfolio", label: "Portfolio", group: "Go to", icon: Briefcase, run: () => onView("portfolio") },
      { id: "do-create", label: "Create market", group: "Actions", icon: Plus, run: onCreate },
      { id: "do-ask", label: "Ask SEER", group: "Actions", icon: Sparkles, run: onAsk },
      { id: "do-settings", label: "Settings", group: "Actions", icon: Settings, run: onSettings },
    ];
    const marketCmds: Command[] = markets.map((m) => ({
      id: `m-${m.address}`,
      label: m.question,
      hint: short(m.address),
      group: "Markets",
      icon: TrendingUp,
      run: () => onSelect(m.address),
    }));

    const matchStatic = base.filter((c) => !q || c.label.toLowerCase().includes(q));
    const matchMarkets = marketCmds
      .filter((c) => !q || c.label.toLowerCase().includes(q) || c.id.toLowerCase().includes(q))
      .slice(0, MAX_MARKETS);
    return [...matchStatic, ...matchMarkets];
  }, [query, markets, onView, onSelect, onCreate, onAsk, onSettings]);

  // Keep the highlight in range as results change.
  useEffect(() => {
    setActive((i) => Math.min(i, Math.max(0, results.length - 1)));
  }, [results.length]);

  const runAt = (i: number) => {
    const cmd = results[i];
    if (!cmd) return;
    cmd.run();
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (results.length ? (i + 1) % results.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (results.length ? (i - 1 + results.length) % results.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      runAt(active);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Jump to…" widthClassName="max-w-xl">
      <div className="grid gap-2 pb-2">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search views, actions, markets…"
          className={cn(
            "h-10 w-full rounded-[var(--radius-control)] border border-line bg-panel-2 px-3 text-sm text-ink",
            "placeholder:text-faint focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent",
          )}
        />

        <div ref={listRef} className="max-h-[50dvh] overflow-y-auto">
          {results.length === 0 ? (
            <p className="px-1 py-6 text-center text-sm text-faint">No matches.</p>
          ) : (
            <ul className="grid gap-0.5">
              {results.map((c, i) => {
                const Icon = c.icon;
                const newGroup = i === 0 || results[i - 1].group !== c.group;
                return (
                  <li key={c.id}>
                    {newGroup && (
                      <div className="px-2.5 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wide text-faint">
                        {c.group}
                      </div>
                    )}
                    <button
                      type="button"
                      onMouseMove={() => setActive(i)}
                      onClick={() => runAt(i)}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-[var(--radius-control)] px-2.5 py-2 text-left text-[13px]",
                        i === active ? "bg-panel-2 text-ink" : "text-muted hover:text-ink",
                      )}
                    >
                      <Icon className="size-4 shrink-0 text-faint" />
                      <span className="flex-1 truncate">{c.label}</span>
                      {c.hint && <span className="font-mono text-xs text-faint">{c.hint}</span>}
                      {i === active && <CornerDownLeft className="size-3.5 shrink-0 text-faint" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}

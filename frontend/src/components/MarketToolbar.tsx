import { Search } from "lucide-react";
import { Segmented } from "@/components/ui/Segmented";
import { Select } from "@/components/ui/Select";
import { Outcome } from "@/abi";
import { cn } from "@/lib/utils";
import type { MarketSummary } from "@/types";

export type MarketFilter = "all" | "open" | "resolved" | "closing";
export type MarketSort = "closing" | "liquidity" | "newest";

const CLOSING_SOON_SEC = 24 * 3600; // "closing soon" = open and < 24h to deadline

export interface ToolbarState {
  query: string;
  filter: MarketFilter;
  sort: MarketSort;
}

// Pure client-side filter + sort over the loaded market summaries. Markets keep
// their creation order (allMarkets() order), so "newest" reverses the index.
export function applyMarketFilters(markets: MarketSummary[], s: ToolbarState): MarketSummary[] {
  const now = Math.floor(Date.now() / 1000);
  const q = s.query.trim().toLowerCase();

  const withIndex = markets.map((m, index) => ({ m, index }));

  const filtered = withIndex.filter(({ m }) => {
    if (q && !m.question.toLowerCase().includes(q)) return false;
    const open = m.outcome === Outcome.Pending;
    if (s.filter === "open") return open;
    if (s.filter === "resolved") return !open;
    if (s.filter === "closing") return open && m.deadline > now && m.deadline - now < CLOSING_SOON_SEC;
    return true;
  });

  filtered.sort((a, b) => {
    if (s.sort === "liquidity") {
      const la = a.m.qYes + a.m.qNo;
      const lb = b.m.qYes + b.m.qNo;
      return lb > la ? 1 : lb < la ? -1 : 0;
    }
    if (s.sort === "closing") {
      // Soonest future deadline first; closed/resolved fall to the end.
      const da = a.m.deadline > now ? a.m.deadline : Number.MAX_SAFE_INTEGER;
      const db = b.m.deadline > now ? b.m.deadline : Number.MAX_SAFE_INTEGER;
      return da - db;
    }
    return b.index - a.index; // newest
  });

  return filtered.map(({ m }) => m);
}

interface MarketToolbarProps {
  state: ToolbarState;
  onChange: (next: ToolbarState) => void;
  resultCount: number;
  totalCount: number;
}

export function MarketToolbar({ state, onChange, resultCount, totalCount }: MarketToolbarProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
        <input
          type="text"
          placeholder="Search markets…"
          value={state.query}
          onChange={(e) => onChange({ ...state, query: e.target.value })}
          className={cn(
            "h-9 w-full rounded-[var(--radius-control)] border border-line bg-panel-2 pl-9 pr-3 text-[13px] text-ink",
            "placeholder:text-faint transition-colors hover:border-line-strong",
            "focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent",
          )}
        />
      </div>

      <Segmented
        aria-label="Filter markets"
        value={state.filter}
        onChange={(filter) => onChange({ ...state, filter })}
        options={[
          { label: "All", value: "all" },
          { label: "Open", value: "open" },
          { label: "Resolved", value: "resolved" },
          { label: "Closing", value: "closing" },
        ]}
      />

      <Select
        aria-label="Sort markets"
        className="sm:w-44"
        value={state.sort}
        onChange={(sort) => onChange({ ...state, sort })}
        options={[
          { label: "Closing soon", value: "closing" },
          { label: "Most liquidity", value: "liquidity" },
          { label: "Newest", value: "newest" },
        ]}
      />

      <span className="tnum hidden shrink-0 text-xs text-faint lg:inline">
        {resultCount}/{totalCount}
      </span>
    </div>
  );
}

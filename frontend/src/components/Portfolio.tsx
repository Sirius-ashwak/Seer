import { useState } from "react";
import { motion } from "framer-motion";
import { Trophy, Wallet, Briefcase } from "lucide-react";
import type { ContractTransactionResponse } from "ethers";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/EmptyState";
import { ActivityFeed } from "@/components/ActivityFeed";
import { Skeleton } from "@/components/ui/Skeleton";
import { OUTCOME_LABELS } from "@/abi";
import { usePortfolio, type PortfolioPosition } from "@/hooks/usePortfolio";
import { useWallet } from "@/hooks/useWallet";
import { marketContract } from "@/lib/contracts";
import { runTx } from "@/lib/tx";
import { record } from "@/lib/activity";
import { fmt, short } from "@/lib/format";
import { cn } from "@/lib/utils";

const outcomeTone = ["open", "yes", "no", "invalid"] as const;

interface PortfolioProps {
  account: string | null;
  onSelect: (address: string) => void;
  afterAction: () => void;
}

export function Portfolio({ account, onSelect, afterAction }: PortfolioProps) {
  const { account: connected, signer, connect } = useWallet();
  const { positions, totalValue, claimableValue, claimableCount, loading, refresh } =
    usePortfolio(account);
  const [claiming, setClaiming] = useState(false);

  if (!account) {
    return (
      <EmptyState
        icon={Wallet}
        title="Connect to see your portfolio"
        description="Your open positions, claimable winnings, and activity appear here once a wallet is connected."
        action={
          <Button variant="primary" onClick={() => void connect()}>
            <Wallet className="size-4" />
            Connect wallet
          </Button>
        }
      />
    );
  }

  const claimAll = async () => {
    if (!signer || connected !== account) return;
    const targets = positions.filter((p) => p.claimable);
    setClaiming(true);
    try {
      for (const p of targets) {
        const ok = await runTx(`Claiming ${fmt(p.claimAmount)} from “${p.question.slice(0, 32)}…”`, () =>
          marketContract(p.address, signer).claim() as Promise<ContractTransactionResponse>,
        );
        if (ok) {
          record(account, {
            type: "claim",
            market: p.address,
            question: p.question,
            detail: `Claimed ${fmt(p.claimAmount)} Points`,
          });
        }
      }
      await refresh();
      afterAction();
    } finally {
      setClaiming(false);
    }
  };

  const open = positions.filter((p) => p.outcome === 0);
  const resolved = positions.filter((p) => p.outcome !== 0);

  return (
    <div className="grid gap-6">
      {/* Summary */}
      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryTile label="Portfolio value" value={`${fmt(totalValue)}`} suffix="Points" />
        <SummaryTile label="Open positions" value={String(open.length)} />
        <Card className="flex items-center justify-between gap-3 p-4">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-faint">Claimable</div>
            <div className="tnum mt-1 text-lg font-semibold text-ink">
              {fmt(claimableValue)} <span className="text-sm font-normal text-faint">Points</span>
            </div>
          </div>
          {claimableCount > 0 && (
            <Button size="sm" loading={claiming} onClick={() => void claimAll()}>
              <Trophy className="size-4" />
              Claim all
            </Button>
          )}
        </Card>
      </div>

      {loading ? (
        <Skeleton className="h-40 w-full rounded-[var(--radius-card)]" />
      ) : positions.length === 0 ? (
        <EmptyState
          icon={Briefcase}
          title="No positions yet"
          description="Buy YES or NO shares in a market and your stake will be tracked here."
        />
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-faint">
                <th className="px-4 py-3 font-medium">Market</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">YES</th>
                <th className="px-4 py-3 text-right font-medium">NO</th>
                <th className="px-4 py-3 text-right font-medium">Value</th>
              </tr>
            </thead>
            <tbody>
              {[...open, ...resolved].map((p) => (
                <PositionRow key={p.address} p={p} onSelect={onSelect} />
              ))}
            </tbody>
          </table>
          </div>
        </Card>
      )}

      {/* Activity */}
      <section className="grid gap-3">
        <h2 className="text-sm font-semibold text-ink">Activity</h2>
        <ActivityFeed account={account} />
      </section>
    </div>
  );
}

function SummaryTile({ label, value, suffix }: { label: string; value: string; suffix?: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-faint">{label}</div>
      <div className="tnum mt-1 text-lg font-semibold text-ink">
        {value} {suffix && <span className="text-sm font-normal text-faint">{suffix}</span>}
      </div>
    </Card>
  );
}

function PositionRow({ p, onSelect }: { p: PortfolioPosition; onSelect: (a: string) => void }) {
  const resolved = p.outcome !== 0;
  return (
    <motion.tr
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      onClick={() => onSelect(p.address)}
      className="cursor-pointer border-b border-line/60 transition-colors last:border-0 hover:bg-panel-2/50"
    >
      <td className="max-w-[18rem] px-4 py-3">
        <div className="truncate font-medium text-ink">{p.question}</div>
        <div className="font-mono text-xs text-faint">{short(p.address)}</div>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <Badge tone={resolved ? outcomeTone[p.outcome] : "open"} dot>
            {resolved ? OUTCOME_LABELS[p.outcome] : "Open"}
          </Badge>
          {p.claimable && <Badge tone="yes">Claimable</Badge>}
        </div>
      </td>
      <td className={cn("tnum px-4 py-3 text-right", p.yes > 0n ? "text-ink" : "text-faint")}>
        {fmt(p.yes)}
      </td>
      <td className={cn("tnum px-4 py-3 text-right", p.no > 0n ? "text-ink" : "text-faint")}>
        {fmt(p.no)}
      </td>
      <td className="tnum px-4 py-3 text-right font-medium text-ink">{fmt(p.value)}</td>
    </motion.tr>
  );
}

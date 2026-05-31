import { useMemo, useState, type ReactNode } from "react";
import {
  formatUnits,
  hexlify,
  parseUnits,
  randomBytes,
  type ContractTransactionResponse,
} from "ethers";
import { toast } from "sonner";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Input";
import { Segmented } from "@/components/ui/Segmented";
import { SIDE, type SideValue } from "@/abi";
import { useWallet } from "@/hooks/useWallet";
import { useDefaultSlippage } from "@/hooks/useSettings";
import { marketContract } from "@/lib/contracts";
import { saveCommit } from "@/lib/commits";
import { record } from "@/lib/activity";
import { runTx } from "@/lib/tx";
import { WAD, fmt, pct, prettyError } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { MarketDetail, PendingCommit } from "@/types";

type Action = "buy" | "sell";

const SLIP_PRESETS = [1, 5, 10] as const;

interface TradePanelProps {
  detail: MarketDetail;
  onTraded: () => void;
  onCommitted: (commit: PendingCommit) => void;
  hasPendingCommit: boolean;
}

export function TradePanel({ detail, onTraded, onCommitted, hasPendingCommit }: TradePanelProps) {
  const { account, signer, balance, connect, connecting } = useWallet();
  const [defaultSlip] = useDefaultSlippage();
  const [side, setSide] = useState<SideValue>(SIDE.Yes);
  const [action, setAction] = useState<Action>("buy");
  const [shares, setShares] = useState("");
  const [slip, setSlip] = useState(() => String(defaultSlip));
  const [customSlip, setCustomSlip] = useState(
    () => !SLIP_PRESETS.includes(defaultSlip as (typeof SLIP_PRESETS)[number]),
  );
  const [busy, setBusy] = useState(false);

  const isBuy = action === "buy";
  const sideLabel = side === SIDE.Yes ? "YES" : "NO";
  const price = side === SIDE.Yes ? detail.priceYes : detail.priceNo;
  const sideShares = side === SIDE.Yes ? detail.yes : detail.no;

  const parsedShares = useMemo(() => {
    if (!shares || Number(shares) <= 0) return 0n;
    try {
      return parseUnits(shares, 18);
    } catch {
      return 0n;
    }
  }, [shares]);

  const est = useMemo(() => (parsedShares * price) / WAD, [parsedShares, price]);

  // First-order LS-LMSR marginal-price move: dp ≈ p(1−p)/b · dq. Honest estimate
  // only — the realized fill walks the curve, so we label it as such.
  const impact = useMemo(() => {
    if (parsedShares <= 0n || detail.liquidity <= 0n) return null;
    const slope = (price * (WAD - price)) / WAD;
    const dp = (slope * parsedShares) / detail.liquidity;
    let next = isBuy ? price + dp : price - dp;
    if (next > WAD) next = WAD;
    if (next < 0n) next = 0n;
    return { dp, from: price, next };
  }, [parsedShares, price, detail.liquidity, isBuy]);

  // Resulting position + blended average cost from the collateral basis.
  const after = useMemo(() => {
    if (!account || parsedShares <= 0n) return null;
    const total = detail.yes + detail.no;
    let afterShares: bigint;
    let newCollateral: bigint;
    let newTotal: bigint;
    if (isBuy) {
      afterShares = sideShares + parsedShares;
      newCollateral = detail.collateral + est;
      newTotal = total + parsedShares;
    } else {
      afterShares = sideShares > parsedShares ? sideShares - parsedShares : 0n;
      newCollateral = detail.collateral > est ? detail.collateral - est : 0n;
      newTotal = total > parsedShares ? total - parsedShares : 0n;
    }
    const avg = newTotal > 0n ? (newCollateral * WAD) / newTotal : 0n;
    return { afterShares, avg };
  }, [account, parsedShares, sideShares, detail.yes, detail.no, detail.collateral, est, isBuy]);

  const insufficient = !!account && parsedShares > 0n && (isBuy ? est > balance : parsedShares > sideShares);
  const blocked = !!account && (parsedShares <= 0n || insufficient);

  const thresholdNote =
    detail.largeBetBps > 0n
      ? `Bets ≥ ${(Number(detail.largeBetBps) / 100).toFixed(0)}% of the pool route through commit-reveal (MEV guard).`
      : "MEV guard disabled on this market.";

  const onMax = () => {
    if (isBuy) {
      if (price <= 0n) return;
      // Cost walks up the LS-LMSR curve past the marginal price, so divide in
      // the slippage headroom to keep the realized fill within balance.
      const slipBps = BigInt(Math.max(0, Math.round(Number(slip) || 0)));
      setShares(formatUnits((balance * WAD * 100n) / (price * (100n + slipBps)), 18));
    } else {
      setShares(formatUnits(sideShares, 18));
    }
  };

  const submit = async () => {
    if (!account || !signer) {
      void connect();
      return;
    }
    if (parsedShares <= 0n) {
      toast.error("Enter a positive share amount.");
      return;
    }

    const slipBps = BigInt(Math.max(0, Math.round(Number(slip) || 0)));
    // Buy: cap maxCost at `shares` (cost can never exceed share count). Sell: floor minPayout at 0.
    let limit: bigint;
    if (isBuy) {
      limit = (est * (100n + slipBps)) / 100n;
      if (limit > parsedShares) limit = parsedShares;
    } else {
      const s = slipBps > 100n ? 100n : slipBps;
      limit = (est * (100n - s)) / 100n;
    }

    const m = marketContract(detail.address, signer);
    setBusy(true);
    try {
      const large = (await m.isLargeBet(parsedShares)) as boolean;
      if (large) {
        await commitLargeBet(m, isBuy, limit);
      } else {
        const ok = await runTx(
          `${isBuy ? "Buying" : "Selling"} ${fmt(parsedShares)} ${sideLabel}`,
          () =>
            (isBuy
              ? m.buy(side, parsedShares, limit)
              : m.sell(side, parsedShares, limit)) as Promise<ContractTransactionResponse>,
        );
        if (ok) {
          record(account, {
            type: isBuy ? "buy" : "sell",
            market: detail.address,
            question: detail.question,
            detail: `${isBuy ? "Buy" : "Sell"} ${fmt(parsedShares)} ${sideLabel}`,
            hash: ok,
          });
          setShares("");
          onTraded();
        }
      }
    } catch (err) {
      toast.error(prettyError(err));
    } finally {
      setBusy(false);
    }
  };

  // MEV guard step 1: commit. The reveal lands on a later block (see CommitRevealPanel).
  const commitLargeBet = async (
    m: ReturnType<typeof marketContract>,
    buy: boolean,
    limit: bigint,
  ) => {
    const salt = hexlify(randomBytes(32));
    const commitment = (await m.commitmentHash(buy, side, parsedShares, limit, salt)) as string;
    const run = (async () => {
      const tx = (await m.commitTrade(commitment)) as ContractTransactionResponse;
      const receipt = await tx.wait();
      return receipt!.blockNumber;
    })();
    toast.promise(run, {
      loading: "Committing large bet (1 of 2)…",
      success: "Committed — reveal unlocks next block",
      error: (e) => prettyError(e),
    });
    const commitBlock = await run;
    const commit: PendingCommit = {
      isBuy: buy,
      side,
      shares: parsedShares.toString(),
      limit: limit.toString(),
      salt,
      commitBlock,
    };
    saveCommit(detail.address, account!, commit);
    record(account, {
      type: "commit",
      market: detail.address,
      question: detail.question,
      detail: `Commit ${fmt(parsedShares)} ${sideLabel} ${buy ? "buy" : "sell"} (large bet)`,
    });
    setShares("");
    onCommitted(commit);
  };

  const submitLabel = !account
    ? "Connect wallet to trade"
    : insufficient
      ? isBuy
        ? "Insufficient balance"
        : `Only ${fmt(sideShares)} ${sideLabel} held`
      : isBuy
        ? "Buy shares"
        : "Sell shares";

  return (
    <Card className="grid gap-4 p-5">
      <div className="grid grid-cols-2 gap-3">
        <Segmented
          aria-label="Outcome"
          value={side}
          onChange={setSide}
          options={[
            { label: "YES", value: SIDE.Yes, tone: "yes" },
            { label: "NO", value: SIDE.No, tone: "no" },
          ]}
        />
        <Segmented
          aria-label="Action"
          value={action}
          onChange={setAction}
          options={[
            { label: "Buy", value: "buy" },
            { label: "Sell", value: "sell" },
          ]}
        />
      </div>

      <div className="grid gap-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium text-muted">Shares</span>
          <button
            type="button"
            onClick={onMax}
            className="tnum font-medium text-accent transition-colors hover:text-ink"
          >
            Max · {isBuy ? `${fmt(balance)} SEER` : `${fmt(sideShares)} ${sideLabel}`}
          </button>
        </div>
        <Field
          type="number"
          min="0"
          step="any"
          inputMode="decimal"
          placeholder="0.0"
          value={shares}
          onChange={(e) => setShares(e.target.value)}
        />
      </div>

      <div className="grid gap-1.5">
        <span className="text-xs font-medium text-muted">Max slippage</span>
        <div className="flex gap-1.5">
          {SLIP_PRESETS.map((p) => {
            const active = !customSlip && Number(slip) === p;
            return (
              <button
                key={p}
                type="button"
                onClick={() => {
                  setCustomSlip(false);
                  setSlip(String(p));
                }}
                className={slipChip(active)}
              >
                {p}%
              </button>
            );
          })}
          <button type="button" onClick={() => setCustomSlip(true)} className={slipChip(customSlip)}>
            Custom
          </button>
        </div>
        {customSlip && (
          <Field
            type="number"
            min="0"
            step="any"
            suffix="%"
            value={slip}
            onChange={(e) => setSlip(e.target.value)}
          />
        )}
      </div>

      <div className="tnum grid min-h-[18px] gap-1 text-[13px]">
        {parsedShares > 0n ? (
          <>
            <StatRow
              label={isBuy ? "Est. cost" : "Est. payout"}
              value={
                <>
                  <span className="text-ink">{fmt(est, 4)} SEER</span>{" "}
                  <span className="text-faint">est.</span>
                </>
              }
            />
            {impact && (
              <StatRow
                label="Price impact"
                value={
                  <>
                    <span className="text-ink">
                      {isBuy ? "+" : "−"}
                      {pct(impact.dp)}pp
                    </span>{" "}
                    <span className="text-faint">
                      {pct(impact.from)}% → {pct(impact.next)}%
                    </span>
                  </>
                }
              />
            )}
            {after && (
              <StatRow
                label="Position after"
                value={
                  <>
                    <span className="text-ink">
                      {fmt(after.afterShares)} {sideLabel}
                    </span>{" "}
                    <span className="text-faint">avg {fmt(after.avg, 3)}</span>
                  </>
                }
              />
            )}
          </>
        ) : (
          <span className="text-muted"> </span>
        )}
      </div>

      <Button
        size="lg"
        variant={!account ? "primary" : isBuy ? "yes" : "no"}
        loading={busy || connecting}
        disabled={blocked}
        onClick={() => void submit()}
      >
        {submitLabel}
      </Button>

      {!hasPendingCommit && <p className="text-xs leading-relaxed text-faint">{thresholdNote}</p>}
    </Card>
  );
}

function slipChip(active: boolean): string {
  return cn(
    "h-8 flex-1 rounded-[var(--radius-control)] border text-[13px] font-medium transition-colors",
    active
      ? "border-line-strong bg-elevated text-ink"
      : "border-line bg-panel-2 text-muted hover:border-line-strong hover:text-ink",
  );
}

function StatRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

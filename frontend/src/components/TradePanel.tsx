import { useMemo, useState } from "react";
import {
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
import { marketContract } from "@/lib/contracts";
import { saveCommit } from "@/lib/commits";
import { runTx } from "@/lib/tx";
import { WAD, fmt, prettyError } from "@/lib/format";
import type { MarketDetail, PendingCommit } from "@/types";

type Action = "buy" | "sell";

interface TradePanelProps {
  detail: MarketDetail;
  onTraded: () => void;
  onCommitted: (commit: PendingCommit) => void;
  hasPendingCommit: boolean;
}

export function TradePanel({ detail, onTraded, onCommitted, hasPendingCommit }: TradePanelProps) {
  const { account, signer, connect, connecting } = useWallet();
  const [side, setSide] = useState<SideValue>(SIDE.Yes);
  const [action, setAction] = useState<Action>("buy");
  const [shares, setShares] = useState("");
  const [slip, setSlip] = useState("10");
  const [busy, setBusy] = useState(false);

  const price = side === SIDE.Yes ? detail.priceYes : detail.priceNo;

  const parsedShares = useMemo(() => {
    if (!shares || Number(shares) <= 0) return 0n;
    try {
      return parseUnits(shares, 18);
    } catch {
      return 0n;
    }
  }, [shares]);

  const est = useMemo(() => (parsedShares * price) / WAD, [parsedShares, price]);

  const thresholdNote =
    detail.largeBetBps > 0n
      ? `Bets ≥ ${(Number(detail.largeBetBps) / 100).toFixed(0)}% of the pool route through commit-reveal (MEV guard).`
      : "MEV guard disabled on this market.";

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
    const isBuy = action === "buy";
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
          `${isBuy ? "Buying" : "Selling"} ${fmt(parsedShares)} ${side === SIDE.Yes ? "YES" : "NO"}`,
          () =>
            (isBuy
              ? m.buy(side, parsedShares, limit)
              : m.sell(side, parsedShares, limit)) as Promise<ContractTransactionResponse>,
        );
        if (ok) {
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
    isBuy: boolean,
    limit: bigint,
  ) => {
    const salt = hexlify(randomBytes(32));
    const commitment = (await m.commitmentHash(isBuy, side, parsedShares, limit, salt)) as string;
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
      isBuy,
      side,
      shares: parsedShares.toString(),
      limit: limit.toString(),
      salt,
      commitBlock,
    };
    saveCommit(detail.address, account!, commit);
    setShares("");
    onCommitted(commit);
  };

  const submitLabel = !account
    ? "Connect wallet to trade"
    : action === "buy"
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

      <Field
        label="Shares"
        type="number"
        min="0"
        step="any"
        inputMode="decimal"
        placeholder="0.0"
        value={shares}
        onChange={(e) => setShares(e.target.value)}
      />
      <Field
        label="Max slippage"
        type="number"
        min="0"
        step="any"
        suffix="%"
        value={slip}
        onChange={(e) => setSlip(e.target.value)}
      />

      <div className="tnum min-h-[18px] text-[13px] text-muted">
        {parsedShares > 0n ? (
          <>
            {action === "buy" ? "Est. cost" : "Est. payout"} ≈{" "}
            <span className="text-ink">{fmt(est, 4)} SEER</span>{" "}
            <span className="text-faint">(marginal price)</span>
          </>
        ) : (
          " "
        )}
      </div>

      <Button
        size="lg"
        variant={!account ? "primary" : action === "buy" ? "yes" : "no"}
        loading={busy || connecting}
        onClick={() => void submit()}
      >
        {submitLabel}
      </Button>

      {!hasPendingCommit && <p className="text-xs leading-relaxed text-faint">{thresholdNote}</p>}
    </Card>
  );
}

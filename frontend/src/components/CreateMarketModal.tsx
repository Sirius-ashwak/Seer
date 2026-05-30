import { useEffect, useMemo, useState } from "react";
import { parseUnits, type ContractTransactionResponse } from "ethers";
import { toast } from "sonner";
import { Modal } from "@/components/ui/Modal";
import { Field } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { useWallet } from "@/hooks/useWallet";
import { factoryContract, readProvider } from "@/lib/contracts";
import { CONFIG, ZERO_ADDRESS } from "@/config";
import { runTx } from "@/lib/tx";
import { record } from "@/lib/activity";
import { fmt } from "@/lib/format";

interface CreateMarketModalProps {
  open: boolean;
  onClose: () => void;
  afterCreate: () => void;
}

// datetime-local default: now + 3 days, formatted for the input's value.
function defaultDeadline(): string {
  const d = new Date(Date.now() + 3 * 86_400_000);
  d.setSeconds(0, 0);
  const tz = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 16);
}

export function CreateMarketModal({ open, onClose, afterCreate }: CreateMarketModalProps) {
  const { account, signer, connect } = useWallet();
  const [question, setQuestion] = useState("");
  const [deadline, setDeadline] = useState(defaultDeadline);
  const [alpha, setAlpha] = useState("0.05");
  const [seedYes, setSeedYes] = useState("1000");
  const [seedNo, setSeedNo] = useState("1000");
  const [busy, setBusy] = useState(false);
  const [bounds, setBounds] = useState<{ min: bigint; max: bigint } | null>(null);

  useEffect(() => {
    if (!open) return;
    const f = factoryContract(readProvider);
    void Promise.all([f.minAlphaWad() as Promise<bigint>, f.maxAlphaWad() as Promise<bigint>])
      .then(([min, max]) => setBounds({ min, max }))
      .catch(() => setBounds(null));
  }, [open]);

  const alphaWad = useMemo(() => {
    try {
      return alpha ? parseUnits(alpha, 18) : 0n;
    } catch {
      return 0n;
    }
  }, [alpha]);

  const alphaOutOfRange =
    bounds !== null && alphaWad > 0n && (alphaWad < bounds.min || alphaWad > bounds.max);

  const settlement = CONFIG.contracts.settlement;
  const settlementMissing = !settlement || settlement === ZERO_ADDRESS;

  const submit = async () => {
    if (!account || !signer) {
      void connect();
      return;
    }
    const deadlineSec = Math.floor(new Date(deadline).getTime() / 1000);
    if (!question.trim()) return toast.error("Enter a market question.");
    if (!Number.isFinite(deadlineSec) || deadlineSec <= Math.floor(Date.now() / 1000)) {
      return toast.error("Pick a deadline in the future.");
    }
    if (alphaWad <= 0n) return toast.error("Enter a valid alpha.");
    if (alphaOutOfRange) return toast.error("Alpha is outside the allowed range.");
    if (settlementMissing) return toast.error("No settlement address configured for this network.");

    let yesWad: bigint;
    let noWad: bigint;
    try {
      yesWad = parseUnits(seedYes || "0", 18);
      noWad = parseUnits(seedNo || "0", 18);
    } catch {
      return toast.error("Seed amounts must be numbers.");
    }

    setBusy(true);
    try {
      const ok = await runTx("Creating market", () =>
        factoryContract(signer).createMarket(
          question.trim(),
          BigInt(deadlineSec),
          alphaWad,
          yesWad,
          noWad,
          settlement,
        ) as Promise<ContractTransactionResponse>,
      );
      if (ok) {
        record(account, { type: "create", detail: `Created “${question.trim().slice(0, 48)}”` });
        afterCreate();
        onClose();
        setQuestion("");
      }
    } finally {
      setBusy(false);
    }
  };

  const rangeHint = bounds
    ? `Allowed: ${fmt(bounds.min, 4)} – ${fmt(bounds.max, 2)} (liquidity sensitivity)`
    : "Liquidity sensitivity";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create market"
      description="Deploy a new LS-LMSR market seeded with starting liquidity."
      widthClassName="max-w-lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" className="cta-glow" loading={busy} onClick={() => void submit()}>
            {account ? "Create market" : "Connect to create"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 py-2">
        <Field
          label="Question"
          placeholder="Will ETH close above $4,000 by Friday?"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />
        <label className="grid gap-1.5">
          <span className="text-xs font-medium text-muted">Resolution deadline</span>
          <input
            type="datetime-local"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            className="h-11 w-full rounded-[var(--radius-control)] border border-line bg-canvas/60 px-3.5 text-[15px] text-ink transition-colors hover:border-line-strong focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent [color-scheme:dark]"
          />
        </label>
        <div>
          <Field
            label="Alpha"
            type="number"
            min="0"
            step="any"
            inputMode="decimal"
            value={alpha}
            onChange={(e) => setAlpha(e.target.value)}
            className={alphaOutOfRange ? "border-no focus:border-no focus:ring-no" : undefined}
          />
          <p className={`mt-1 text-xs ${alphaOutOfRange ? "text-no" : "text-faint"}`}>{rangeHint}</p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field
            label="Seed YES"
            type="number"
            min="0"
            step="any"
            suffix="Pts"
            value={seedYes}
            onChange={(e) => setSeedYes(e.target.value)}
          />
          <Field
            label="Seed NO"
            type="number"
            min="0"
            step="any"
            suffix="Pts"
            value={seedNo}
            onChange={(e) => setSeedNo(e.target.value)}
          />
        </div>
        {settlementMissing && (
          <p className="rounded-[var(--radius-control)] border border-no/40 bg-no-soft px-3 py-2 text-xs text-no">
            This network has no settlement contract configured — set it in config.ts before creating
            markets.
          </p>
        )}
      </div>
    </Modal>
  );
}

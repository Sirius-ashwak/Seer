import { useState } from "react";
import { AbiCoder, hexlify, toUtf8Bytes, type ContractTransactionResponse } from "ethers";
import { toast } from "sonner";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Input";
import { useWallet } from "@/hooks/useWallet";
import { resolverContract } from "@/lib/contracts";
import { CONFIG } from "@/config";
import { record } from "@/lib/activity";
import { runTx } from "@/lib/tx";
import { fmt } from "@/lib/format";

interface ProposeModalProps {
  open: boolean;
  onClose: () => void;
  market: string;
  question: string;
  proposeValue: bigint; // SOURCES·sourceCallDeposit + llmCallDeposit (native)
  bond: bigint; // Points escrowed from the proposer
  onProposed: () => void;
}

interface SourceRow {
  url: string;
  path: string;
  kind: string;
}

// Pre-filled with the SeedLocal ETH-price example so the demo is one click.
const DEFAULT_SOURCES: SourceRow[] = [
  { url: "https://api.coingecko.com/api/v3/simple/price", path: "ethereum.usd", kind: "2" },
  { url: "https://api.coinbase.com/v2/prices/ETH-USD/spot", path: "data.amount", kind: "2" },
  { url: "https://api.kraken.com/0/public/Ticker", path: "result.XETHZUSD.c[0]", kind: "2" },
];
const DEFAULT_PROMPT =
  "Given the three source payloads, decide the market question. Reply abi-encoded uint8: 0=Invalid, 1=Yes, 2=No.";

export function ProposeModal({
  open,
  onClose,
  market,
  question,
  proposeValue,
  bond,
  onProposed,
}: ProposeModalProps) {
  const { account, signer, balance, connect } = useWallet();
  const [sources, setSources] = useState<SourceRow[]>(DEFAULT_SOURCES);
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [busy, setBusy] = useState(false);

  const insufficientBond = !!account && balance < bond;

  const setSource = (i: number, patch: Partial<SourceRow>) =>
    setSources((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const submit = async () => {
    if (!account || !signer) {
      void connect();
      return;
    }
    if (sources.some((s) => !s.url.trim() || !s.path.trim())) {
      toast.error("Each source needs a URL and a JSON path.");
      return;
    }

    let encoded: string[];
    try {
      const coder = AbiCoder.defaultAbiCoder();
      encoded = sources.map((s) =>
        coder.encode(["string", "string", "uint8"], [s.url.trim(), s.path.trim(), Number(s.kind) || 0]),
      );
    } catch {
      toast.error("Could not encode the sources — check the kind values.");
      return;
    }
    const promptBytes = hexlify(toUtf8Bytes(prompt));

    setBusy(true);
    try {
      const ok = await runTx(
        "Proposing resolution",
        () =>
          resolverContract(CONFIG.contracts.resolver, signer).requestResolution(
            market,
            encoded,
            promptBytes,
            { value: proposeValue },
          ) as Promise<ContractTransactionResponse>,
      );
      if (ok) {
        record(account, {
          type: "propose",
          market,
          question,
          detail: "Propose resolution",
        });
        onProposed();
        onClose();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Propose resolution"
      description="Submit three independent sources and an inference prompt. The agent network fetches each source, then an LLM proposes the outcome — opening a challenge window."
      widthClassName="max-w-lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={busy} disabled={insufficientBond}>
            {insufficientBond ? "Insufficient bond" : "Propose"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 py-1">
        {sources.map((s, i) => (
          <div key={i} className="grid gap-2 rounded-[var(--radius-control)] border border-line p-3">
            <span className="text-[11px] font-medium uppercase tracking-wide text-faint">
              Source {i + 1}
            </span>
            <Field
              placeholder="https://api.example.com/endpoint"
              value={s.url}
              onChange={(e) => setSource(i, { url: e.target.value })}
            />
            <div className="grid grid-cols-[1fr_5rem] gap-2">
              <Field
                placeholder="json.path.to.value"
                value={s.path}
                onChange={(e) => setSource(i, { path: e.target.value })}
              />
              <Field
                type="number"
                min="0"
                placeholder="kind"
                value={s.kind}
                onChange={(e) => setSource(i, { kind: e.target.value })}
              />
            </div>
          </div>
        ))}

        <label className="grid gap-1.5">
          <span className="text-xs font-medium text-muted">Inference prompt</span>
          <textarea
            rows={3}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="w-full resize-y rounded-[var(--radius-control)] border border-line bg-canvas/60 p-3 text-[13px] leading-relaxed text-ink transition-colors hover:border-line-strong focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </label>

        <div className="grid gap-1 rounded-[var(--radius-control)] bg-panel-2 p-3 text-[13px]">
          <Row label="Points bond (escrowed)" value={`${fmt(bond)} SEER`} />
          <Row label="Agent gas deposit" value={`${fmt(proposeValue)} ${CONFIG.currencySymbol}`} />
          {insufficientBond && (
            <p className="mt-1 text-xs text-no">
              You need {fmt(bond)} SEER Points to post the proposer bond.
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted">{label}</span>
      <span className="tnum text-ink">{value}</span>
    </div>
  );
}

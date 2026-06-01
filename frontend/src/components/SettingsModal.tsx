import { useState } from "react";
import { Copy, ExternalLink, Github, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Input";
import { ACTIVE, CONFIG, NETWORKS, ZERO_ADDRESS, type NetworkKey } from "@/config";
import {
  getRpcOverride,
  resetPreferences,
  setRpcOverride,
  setStoredNetwork,
} from "@/lib/settings";
import { explorerAddress } from "@/lib/contracts";
import { short } from "@/lib/format";
import { useDefaultSlippage } from "@/hooks/useSettings";
import { cn } from "@/lib/utils";

const SLIPPAGE_PRESETS = [1, 5, 10];

const NETWORK_OPTIONS = (Object.keys(NETWORKS) as NetworkKey[]).map((k) => ({
  label: NETWORKS[k].label,
  value: k,
}));

// Keep in sync with package.json.
const APP_VERSION = "0.1.0";
const REPO_URL = "https://github.com/Sirius-ashwak/Seer";

const CONTRACT_ROWS: { label: string; address: string }[] = [
  { label: "Factory", address: CONFIG.contracts.factory },
  { label: "Points", address: CONFIG.contracts.points },
  { label: "Resolver", address: CONFIG.contracts.resolver },
  { label: "Settlement", address: CONFIG.contracts.settlement },
];

export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [slippage, setSlippage] = useDefaultSlippage();
  const [customSlip, setCustomSlip] = useState(
    SLIPPAGE_PRESETS.includes(slippage) ? "" : String(slippage),
  );
  const [rpc, setRpc] = useState(() => getRpcOverride(ACTIVE));
  const rpcDirty = rpc.trim() !== getRpcOverride(ACTIVE);
  const [confirmingReset, setConfirmingReset] = useState(false);

  const switchNetwork = (n: NetworkKey) => {
    if (n === ACTIVE) return;
    setStoredNetwork(n);
    window.location.reload();
  };

  const applyRpc = () => {
    setRpcOverride(ACTIVE, rpc);
    window.location.reload();
  };

  const resetAll = () => {
    resetPreferences();
    window.location.reload();
  };

  return (
    <Modal open={open} onClose={onClose} title="Settings" description="Network and trade defaults.">
      <div className="grid gap-6 py-2">
        {/* Network */}
        <section className="grid gap-2">
          <label className="text-xs font-medium uppercase tracking-wide text-faint">Network</label>
          <Select
            aria-label="Network"
            value={ACTIVE}
            options={NETWORK_OPTIONS}
            onChange={switchNetwork}
          />
          <p className="text-xs leading-relaxed text-faint">
            Switching reloads the app against the selected deployment.
          </p>
        </section>

        {/* Default slippage */}
        <section className="grid gap-2">
          <label className="text-xs font-medium uppercase tracking-wide text-faint">
            Default slippage
          </label>
          <div className="flex gap-2">
            {SLIPPAGE_PRESETS.map((p) => (
              <button
                key={p}
                onClick={() => {
                  setSlippage(p);
                  setCustomSlip("");
                }}
                className={cn(
                  "h-9 flex-1 rounded-[var(--radius-control)] border text-[13px] font-medium transition-colors",
                  slippage === p && customSlip === ""
                    ? "border-line-strong bg-elevated text-ink"
                    : "border-line bg-panel-2 text-muted hover:text-ink",
                )}
              >
                {p}%
              </button>
            ))}
            <div className="relative flex w-24 items-center">
              <input
                type="number"
                min="0"
                step="any"
                inputMode="decimal"
                placeholder="Custom"
                value={customSlip}
                onChange={(e) => {
                  setCustomSlip(e.target.value);
                  const n = Number(e.target.value);
                  if (Number.isFinite(n) && n >= 0) setSlippage(n);
                }}
                className={cn(
                  "tnum h-9 w-full rounded-[var(--radius-control)] border bg-panel-2 px-2.5 pr-6 text-[13px] text-ink",
                  "placeholder:text-faint focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent",
                  customSlip ? "border-line-strong" : "border-line",
                )}
              />
              <span className="pointer-events-none absolute right-2.5 text-xs text-faint">%</span>
            </div>
          </div>
          <p className="text-xs leading-relaxed text-faint">
            Seeds the slippage on each new trade. You can still override it per trade.
          </p>
        </section>

        {/* RPC override */}
        <section className="grid gap-2">
          <Field
            label="RPC endpoint override"
            placeholder={NETWORKS[ACTIVE].rpcUrl}
            value={rpc}
            onChange={(e) => setRpc(e.target.value)}
          />
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs leading-relaxed text-faint">
              Leave blank to use the preset default. Applied on reload.
            </p>
            <Button size="sm" variant="secondary" disabled={!rpcDirty} onClick={applyRpc}>
              <RefreshCw className="size-3.5" />
              Apply
            </Button>
          </div>
        </section>

        {/* Contracts */}
        <section className="grid gap-2">
          <label className="text-xs font-medium uppercase tracking-wide text-faint">
            Contracts
          </label>
          <div className="grid gap-1.5">
            {CONTRACT_ROWS.map((c) => (
              <ContractRow key={c.label} label={c.label} address={c.address} />
            ))}
          </div>
          <p className="text-xs leading-relaxed text-faint">
            The {CONFIG.label} deployment this app reads from.
          </p>
        </section>

        {/* About */}
        <section className="grid gap-3">
          <label className="text-xs font-medium uppercase tracking-wide text-faint">About</label>
          <div className="flex items-center justify-between gap-3 text-[13px]">
            <span className="text-muted">
              SEER <span className="text-faint">v{APP_VERSION}</span>
            </span>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-muted transition-colors hover:text-ink"
            >
              <Github className="size-3.5" />
              GitHub
            </a>
          </div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs leading-relaxed text-faint">
              Reset clears local preferences (network, RPC, slippage). Your activity log is kept.
            </p>
            {confirmingReset ? (
              <div className="flex shrink-0 gap-2">
                <Button size="sm" variant="ghost" onClick={() => setConfirmingReset(false)}>
                  Cancel
                </Button>
                <Button size="sm" variant="primary" onClick={resetAll}>
                  Confirm
                </Button>
              </div>
            ) : (
              <Button size="sm" variant="secondary" onClick={() => setConfirmingReset(true)}>
                Reset
              </Button>
            )}
          </div>
        </section>
      </div>
    </Modal>
  );
}

function ContractRow({ label, address }: { label: string; address: string }) {
  const isZero = address === ZERO_ADDRESS;
  const explorer = explorerAddress(address);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      toast.success(`${label} address copied`);
    } catch {
      toast.error("Couldn't copy address");
    }
  };

  return (
    <div className="flex items-center gap-2 rounded-[var(--radius-control)] border border-line bg-panel-2 px-2.5 py-2">
      <span className="text-[13px] text-muted">{label}</span>
      {isZero ? (
        <span className="ml-auto text-xs text-faint">Not deployed</span>
      ) : (
        <>
          <span className="ml-auto font-mono text-xs text-ink">{short(address)}</span>
          <button
            type="button"
            onClick={() => void copy()}
            aria-label={`Copy ${label} address`}
            className="text-faint transition-colors hover:text-ink"
          >
            <Copy className="size-3.5" />
          </button>
          {explorer && (
            <a
              href={explorer}
              target="_blank"
              rel="noreferrer"
              aria-label={`View ${label} on explorer`}
              className="text-faint transition-colors hover:text-ink"
            >
              <ExternalLink className="size-3.5" />
            </a>
          )}
        </>
      )}
    </div>
  );
}

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Input";
import { ACTIVE, NETWORKS, type NetworkKey } from "@/config";
import {
  getRpcOverride,
  setRpcOverride,
  setStoredNetwork,
} from "@/lib/settings";
import { useDefaultSlippage } from "@/hooks/useSettings";
import { cn } from "@/lib/utils";

const SLIPPAGE_PRESETS = [1, 5, 10];

const NETWORK_OPTIONS = (Object.keys(NETWORKS) as NetworkKey[]).map((k) => ({
  label: NETWORKS[k].label,
  value: k,
}));

export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [slippage, setSlippage] = useDefaultSlippage();
  const [customSlip, setCustomSlip] = useState(
    SLIPPAGE_PRESETS.includes(slippage) ? "" : String(slippage),
  );
  const [rpc, setRpc] = useState(() => getRpcOverride(ACTIVE));
  const rpcDirty = rpc.trim() !== getRpcOverride(ACTIVE);

  const switchNetwork = (n: NetworkKey) => {
    if (n === ACTIVE) return;
    setStoredNetwork(n);
    window.location.reload();
  };

  const applyRpc = () => {
    setRpcOverride(ACTIVE, rpc);
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
      </div>
    </Modal>
  );
}

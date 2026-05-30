import { DEFAULT_NETWORK, type NetworkKey } from "@/config";

// Persisted user settings. Network + RPC are read by config.ts at module load
// (CONFIG resolves the active preset there), so changing them requires a page
// reload to take effect — the Settings modal does this explicitly.
//
// Key strings MUST match the ones config.ts reads.
const NETWORK_KEY = "seer:network";
const SLIPPAGE_KEY = "seer:slippage";
const rpcKey = (n: NetworkKey) => `seer:rpc:${n}`;

export const DEFAULT_SLIPPAGE = 10;

export function getStoredNetwork(): NetworkKey {
  try {
    const v = localStorage.getItem(NETWORK_KEY);
    if (v) return v as NetworkKey;
  } catch {
    /* ignore */
  }
  return DEFAULT_NETWORK;
}

export function setStoredNetwork(n: NetworkKey): void {
  try {
    localStorage.setItem(NETWORK_KEY, n);
  } catch {
    /* ignore */
  }
}

export function getRpcOverride(n: NetworkKey): string {
  try {
    return localStorage.getItem(rpcKey(n)) ?? "";
  } catch {
    return "";
  }
}

export function setRpcOverride(n: NetworkKey, url: string): void {
  try {
    if (url.trim()) localStorage.setItem(rpcKey(n), url.trim());
    else localStorage.removeItem(rpcKey(n));
  } catch {
    /* ignore */
  }
}

export function getDefaultSlippage(): number {
  try {
    const v = localStorage.getItem(SLIPPAGE_KEY);
    if (v != null) {
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0) return n;
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_SLIPPAGE;
}

export function setDefaultSlippage(pct: number): void {
  try {
    localStorage.setItem(SLIPPAGE_KEY, String(pct));
  } catch {
    /* ignore */
  }
}

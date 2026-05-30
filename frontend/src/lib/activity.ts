import { CONFIG } from "@/config";

// Local-first activity log. SEER has no indexer, so every UI-initiated tx is
// recorded to localStorage (per chain + account) and rendered in the Portfolio
// feed. Reliable for the demo; not a substitute for on-chain history.

export type ActivityType =
  | "buy"
  | "sell"
  | "commit"
  | "reveal"
  | "claim"
  | "faucet"
  | "create"
  | "propose"
  | "dispute"
  | "finalize"
  | "settle"
  | "timeout"
  | "simulate";

export interface ActivityEntry {
  type: ActivityType;
  market?: string; // market address, when applicable
  question?: string; // cached question text for display
  detail: string; // human summary, e.g. "Buy 50 YES"
  hash?: string; // tx hash (for explorer links on testnet)
  ts: number; // unix ms
}

const MAX_ENTRIES = 120;

function key(account: string): string {
  return `seer:activity:${CONFIG.chainId}:${account.toLowerCase()}`;
}

const listeners = new Set<() => void>();

export function subscribeActivity(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function loadActivity(account: string | null): ActivityEntry[] {
  if (!account) return [];
  try {
    const raw = localStorage.getItem(key(account));
    return raw ? (JSON.parse(raw) as ActivityEntry[]) : [];
  } catch {
    return [];
  }
}

export function record(account: string | null, entry: Omit<ActivityEntry, "ts">): void {
  if (!account) return;
  try {
    const log = loadActivity(account);
    log.unshift({ ...entry, ts: Date.now() });
    localStorage.setItem(key(account), JSON.stringify(log.slice(0, MAX_ENTRIES)));
    listeners.forEach((cb) => cb());
  } catch {
    /* localStorage full / unavailable — non-fatal */
  }
}

export function clearActivity(account: string | null): void {
  if (!account) return;
  try {
    localStorage.removeItem(key(account));
    listeners.forEach((cb) => cb());
  } catch {
    /* ignore */
  }
}

import { CONFIG } from "@/config";
import type { PendingCommit } from "@/types";

// Pending large-bet commits are stored per chain + market + account so a page
// reload (or a wallet switch) doesn't strand the salt needed to reveal.
function key(market: string, account: string): string {
  return `seer:commit:${CONFIG.chainId}:${market.toLowerCase()}:${account.toLowerCase()}`;
}

export function loadCommit(market: string, account: string): PendingCommit | null {
  try {
    const raw = localStorage.getItem(key(market, account));
    return raw ? (JSON.parse(raw) as PendingCommit) : null;
  } catch {
    return null;
  }
}

export function saveCommit(market: string, account: string, commit: PendingCommit): void {
  localStorage.setItem(key(market, account), JSON.stringify(commit));
}

export function clearCommit(market: string, account: string): void {
  localStorage.removeItem(key(market, account));
}

import { formatUnits, getBytes } from "ethers";

export const WAD = 10n ** 18n;

// Format an 18-decimal fixed-point value for display.
export function fmt(wad: bigint, dp = 2): string {
  const n = Number(formatUnits(wad, 18));
  return n.toLocaleString(undefined, { maximumFractionDigits: dp });
}

// Compact form for large balances (e.g. 12,400 → 12.4K).
export function fmtCompact(wad: bigint): string {
  const n = Number(formatUnits(wad, 18));
  if (n >= 1000) {
    return n.toLocaleString(undefined, { notation: "compact", maximumFractionDigits: 1 });
  }
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

// A WAD price (0..1e18) as a percentage number, one decimal.
export function pctNum(priceWad: bigint): number {
  return Number(formatUnits(priceWad, 18)) * 100;
}

export function pct(priceWad: bigint, dp = 1): string {
  return pctNum(priceWad).toFixed(dp);
}

export function short(addr: string | null | undefined): string {
  return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "";
}

export function timeUntil(deadlineSec: number): string {
  const diff = deadlineSec * 1000 - Date.now();
  if (diff <= 0) return "closed";
  const days = Math.floor(diff / 86_400_000);
  const hours = Math.floor((diff % 86_400_000) / 3_600_000);
  const mins = Math.floor((diff % 3_600_000) / 60_000);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

// A past timestamp as a short relative string (e.g. "3h ago"). Empty for 0.
export function timeAgo(sec: number): string {
  if (!sec) return "";
  const diff = Date.now() - sec * 1000;
  if (diff < 0) return "just now";
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// Decode on-chain bytes to readable text. Source payloads / prompts are utf8;
// anything that isn't cleanly printable falls back to a truncated hex string.
export function bytesToText(hex: string): string {
  if (!hex || hex === "0x") return "";
  try {
    const bytes = getBytes(hex);
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    // eslint-disable-next-line no-control-regex
    const printable = text.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, "");
    if (printable.length >= text.length * 0.8 && printable.trim().length > 0) {
      return printable.trim();
    }
  } catch {
    // fall through to hex
  }
  const trimmed = hex.length > 138 ? `${hex.slice(0, 138)}…` : hex;
  return trimmed;
}

// Best-effort human message from an ethers/provider error.
export function prettyError(err: unknown): string {
  const e = err as {
    reason?: string;
    shortMessage?: string;
    info?: { error?: { message?: string } };
    message?: string;
  };
  const reason =
    e?.reason || e?.shortMessage || e?.info?.error?.message || e?.message || "Transaction failed";
  return reason.length > 180 ? `${reason.slice(0, 177)}…` : reason;
}

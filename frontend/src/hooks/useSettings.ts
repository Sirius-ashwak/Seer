import { useCallback, useSyncExternalStore } from "react";
import {
  getDefaultSlippage,
  setDefaultSlippage as persistSlippage,
} from "@/lib/settings";

// Keep the default slippage live across components (TradePanel + SettingsModal)
// without a context — a tiny external store backed by localStorage.
const listeners = new Set<() => void>();
function emit() {
  listeners.forEach((cb) => cb());
}
function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useDefaultSlippage(): [number, (pct: number) => void] {
  const value = useSyncExternalStore(subscribe, getDefaultSlippage, () => getDefaultSlippage());
  const set = useCallback((pct: number) => {
    persistSlippage(pct);
    emit();
  }, []);
  return [value, set];
}

import { useCallback, useEffect, useState } from "react";
import { factoryContract, readProvider } from "@/lib/contracts";
import { useWallet } from "./useWallet";

interface FaucetState {
  amount: bigint; // 0 ⇒ faucet disabled / hidden
  readyAt: number; // unix seconds the connected account may next claim
  onCooldown: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
}

export function useFaucet(): FaucetState {
  const { account } = useWallet();
  const [amount, setAmount] = useState<bigint>(0n);
  const [readyAt, setReadyAt] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const factory = factoryContract(readProvider);
      const amt = (await factory.faucetAmount()) as bigint;
      setAmount(amt);
      if (account && amt > 0n) {
        const next = (await factory.nextFaucetClaim(account)) as bigint;
        setReadyAt(Number(next));
      } else {
        setReadyAt(0);
      }
    } catch {
      setAmount(0n);
    } finally {
      setLoading(false);
    }
  }, [account]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    amount,
    readyAt,
    onCooldown: readyAt > Math.floor(Date.now() / 1000),
    loading,
    refresh,
  };
}

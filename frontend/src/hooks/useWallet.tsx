import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { BrowserProvider, type Signer } from "ethers";
import { CONFIG } from "@/config";
import { pointsContract, readProvider } from "@/lib/contracts";

interface WalletState {
  account: string | null;
  signer: Signer | null;
  chainId: number | null;
  balance: bigint;
  connecting: boolean;
  wrongChain: boolean;
  hasWallet: boolean;
  connect: () => Promise<void>;
  switchChain: () => Promise<void>;
  refreshBalance: () => Promise<void>;
}

const WalletContext = createContext<WalletState | null>(null);

async function ensureChain(): Promise<void> {
  const eth = window.ethereum;
  if (!eth) return;
  const current = (await eth.request({ method: "eth_chainId" })) as string;
  if (parseInt(current, 16) === CONFIG.chainId) return;
  try {
    await eth.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: CONFIG.chainIdHex }],
    });
  } catch (err) {
    if ((err as { code?: number }).code === 4902) {
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: CONFIG.chainIdHex,
            chainName: CONFIG.label,
            rpcUrls: [CONFIG.rpcUrl],
            nativeCurrency: {
              name: CONFIG.currencySymbol,
              symbol: CONFIG.currencySymbol,
              decimals: 18,
            },
            blockExplorerUrls: CONFIG.blockExplorer ? [CONFIG.blockExplorer] : [],
          },
        ],
      });
    } else {
      throw err;
    }
  }
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<string | null>(null);
  const [signer, setSigner] = useState<Signer | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [balance, setBalance] = useState<bigint>(0n);
  const [connecting, setConnecting] = useState(false);
  const hasWallet = typeof window !== "undefined" && !!window.ethereum;
  const accountRef = useRef<string | null>(null);
  accountRef.current = account;

  const refreshBalance = useCallback(async () => {
    const addr = accountRef.current;
    if (!addr) {
      setBalance(0n);
      return;
    }
    try {
      const bal = (await pointsContract(readProvider).balanceOf(addr)) as bigint;
      setBalance(bal);
    } catch {
      /* RPC hiccup — leave prior balance */
    }
  }, []);

  const hydrate = useCallback(async () => {
    if (!window.ethereum) return;
    const provider = new BrowserProvider(window.ethereum);
    const s = await provider.getSigner();
    const addr = await s.getAddress();
    const net = await provider.getNetwork();
    setSigner(s);
    setAccount(addr);
    setChainId(Number(net.chainId));
    accountRef.current = addr;
    await refreshBalance();
  }, [refreshBalance]);

  const connect = useCallback(async () => {
    if (!window.ethereum) return;
    setConnecting(true);
    try {
      await ensureChain();
      const provider = new BrowserProvider(window.ethereum);
      await provider.send("eth_requestAccounts", []);
      await hydrate();
    } finally {
      setConnecting(false);
    }
  }, [hydrate]);

  const switchChain = useCallback(async () => {
    await ensureChain();
    await hydrate();
  }, [hydrate]);

  // React to wallet account/chain changes; reconnect silently if already authorized.
  useEffect(() => {
    const eth = window.ethereum;
    if (!eth?.on) return;

    const onAccounts = (accs: unknown) => {
      const list = accs as string[];
      if (!list || list.length === 0) {
        setAccount(null);
        setSigner(null);
        setBalance(0n);
        accountRef.current = null;
      } else {
        void hydrate();
      }
    };
    const onChain = () => void hydrate();

    eth.on("accountsChanged", onAccounts);
    eth.on("chainChanged", onChain);

    // Silent reconnect on load if the site is already permitted.
    void eth
      .request({ method: "eth_accounts" })
      .then((accs) => {
        if ((accs as string[])?.length) void hydrate();
      })
      .catch(() => undefined);

    return () => {
      eth.removeListener?.("accountsChanged", onAccounts);
      eth.removeListener?.("chainChanged", onChain);
    };
  }, [hydrate]);

  const value = useMemo<WalletState>(
    () => ({
      account,
      signer,
      chainId,
      balance,
      connecting,
      hasWallet,
      wrongChain: chainId !== null && chainId !== CONFIG.chainId,
      connect,
      switchChain,
      refreshBalance,
    }),
    [account, signer, chainId, balance, connecting, hasWallet, connect, switchChain, refreshBalance],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within WalletProvider");
  return ctx;
}

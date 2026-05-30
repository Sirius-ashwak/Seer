// SEER frontend — deployment config.
//
// Fill these in after running script/Deploy.s.sol. Two presets are provided;
// the active one is chosen by DEFAULT_NETWORK below, but the Settings modal can
// override it (persisted to localStorage and applied on the next page load).
//
//   Local anvil:    forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 \
//                     --private-key <anvil-key> --broadcast
//   Somnia testnet: see contracts/README.md "Deploying to Somnia testnet"

export interface NetworkConfig {
  label: string;
  chainId: number;
  chainIdHex: string;
  rpcUrl: string;
  currencySymbol: string;
  blockExplorer: string;
  contracts: {
    factory: string;
    points: string;
    // SeerResolver — the bonded oracle that holds each market's resolution audit
    // trail. The market's own `resolver()` is the Settlement bridge, not this.
    resolver: string;
    // SeerSettlement — the oracle→market bridge each market points its resolver()
    // at. createMarket() takes this address; settle() pushes the final outcome.
    settlement: string;
  };
  // MockAgentRequester — present only on local anvil (SeedLocal). When set, the
  // Agent Simulator can drive agent callbacks in-browser. Omitted on testnet.
  mockRequester?: string;
}

export const NETWORKS = {
  local: {
    label: "Local anvil",
    chainId: 31337,
    chainIdHex: "0x7a69",
    rpcUrl: "http://127.0.0.1:8545",
    currencySymbol: "ETH",
    blockExplorer: "",
    // Deterministic addresses from a fresh `anvil` + script/SeedLocal.s.sol run
    // (deploy nonce order is fixed). Re-deploying on a clean anvil reproduces
    // these exactly; replace them if you change deploy order.
    contracts: {
      factory: "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9",
      points: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
      resolver: "0x9fe46736679d2d9a65f0992f2272de9f3c7fa6e0",
      settlement: "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
    },
    // SeedLocal deploys the mock first (nonce 0) → deterministic address.
    mockRequester: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  },

  // NOTE: verify chainId / rpcUrl against the current Somnia docs before a live
  // demo — testnet parameters have changed during the program.
  somniaTestnet: {
    label: "Somnia Shannon testnet",
    chainId: 50312,
    chainIdHex: "0xc488",
    rpcUrl: "https://dream-rpc.somnia.network",
    currencySymbol: "STT",
    blockExplorer: "https://shannon-explorer.somnia.network",
    contracts: {
      factory: "0x0000000000000000000000000000000000000000",
      points: "0x0000000000000000000000000000000000000000",
      resolver: "0x0000000000000000000000000000000000000000",
      settlement: "0x0000000000000000000000000000000000000000",
    },
  },
} satisfies Record<string, NetworkConfig>;

export type NetworkKey = keyof typeof NETWORKS;

// Default preset when nothing is stored. Switch to "somniaTestnet" for the
// live deploy (or change it from the Settings modal at runtime).
export const DEFAULT_NETWORK: NetworkKey = "local";

const NETWORK_KEY = "seer:network";
const RPC_KEY = (n: NetworkKey) => `seer:rpc:${n}`;

// Resolve the active network from localStorage (Settings override), falling
// back to DEFAULT_NETWORK. Read once at module load — the Settings modal
// persists a new value and reloads the page so CONFIG re-resolves.
function resolveActive(): NetworkKey {
  try {
    const stored = localStorage.getItem(NETWORK_KEY);
    if (stored && stored in NETWORKS) return stored as NetworkKey;
  } catch {
    /* localStorage unavailable — use the default */
  }
  return DEFAULT_NETWORK;
}

export const ACTIVE: NetworkKey = resolveActive();

// Build CONFIG from the active preset, applying any per-network RPC override.
function buildConfig(active: NetworkKey): NetworkConfig {
  const base = NETWORKS[active];
  try {
    const rpcOverride = localStorage.getItem(RPC_KEY(active));
    if (rpcOverride && rpcOverride.trim()) {
      return { ...base, rpcUrl: rpcOverride.trim() };
    }
  } catch {
    /* ignore */
  }
  return base;
}

export const CONFIG: NetworkConfig = buildConfig(ACTIVE);

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export function isConfigured(): boolean {
  return CONFIG.contracts.factory !== ZERO_ADDRESS && CONFIG.contracts.points !== ZERO_ADDRESS;
}

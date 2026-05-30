// SEER frontend — deployment config.
//
// Fill these in after running script/Deploy.s.sol. Two presets are provided;
// set ACTIVE to the one you deployed against.
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
  };
}

export const NETWORKS = {
  local: {
    label: "Local anvil",
    chainId: 31337,
    chainIdHex: "0x7a69",
    rpcUrl: "http://127.0.0.1:8545",
    currencySymbol: "ETH",
    blockExplorer: "",
    // Deterministic addresses from a fresh `anvil` + script/Deploy.s.sol run
    // (deploy nonce order is fixed). Re-deploying on a clean anvil reproduces
    // these exactly; replace them if you change deploy order.
    contracts: {
      factory: "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9",
      points: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
      resolver: "0x9fe46736679d2d9a65f0992f2272de9f3c7fa6e0",
    },
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
    },
  },
} satisfies Record<string, NetworkConfig>;

// Which preset the UI uses. Switch to "somniaTestnet" for the live deploy.
export const ACTIVE: keyof typeof NETWORKS = "local";

export const CONFIG: NetworkConfig = NETWORKS[ACTIVE];

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export function isConfigured(): boolean {
  return CONFIG.contracts.factory !== ZERO_ADDRESS && CONFIG.contracts.points !== ZERO_ADDRESS;
}

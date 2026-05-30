import { Contract, JsonRpcProvider, type Provider, type Signer } from "ethers";
import { CONFIG } from "@/config";
import { FACTORY_ABI, MARKET_ABI, POINTS_ABI, RESOLVER_ABI } from "@/abi";

// A read-only provider so the market list renders before a wallet connects.
export const readProvider = new JsonRpcProvider(CONFIG.rpcUrl, CONFIG.chainId, {
  staticNetwork: true,
});

type Runner = Provider | Signer;

export function factoryContract(runner: Runner = readProvider): Contract {
  return new Contract(CONFIG.contracts.factory, FACTORY_ABI, runner);
}

export function pointsContract(runner: Runner = readProvider): Contract {
  return new Contract(CONFIG.contracts.points, POINTS_ABI, runner);
}

export function marketContract(address: string, runner: Runner = readProvider): Contract {
  return new Contract(address, MARKET_ABI, runner);
}

export function resolverContract(address: string, runner: Runner = readProvider): Contract {
  return new Contract(address, RESOLVER_ABI, runner);
}

export function explorerTx(hash: string): string | null {
  return CONFIG.blockExplorer ? `${CONFIG.blockExplorer}/tx/${hash}` : null;
}

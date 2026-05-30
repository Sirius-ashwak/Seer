import type { SideValue } from "@/abi";

export interface MarketSummary {
  address: string;
  question: string;
  priceYes: bigint;
  priceNo: bigint;
  outcome: number;
  // Cheap extra reads used for discovery sort/filter.
  deadline: number;
  qYes: bigint;
  qNo: bigint;
}

export interface MarketDetail extends MarketSummary {
  largeBetBps: bigint;
  liquidity: bigint; // LS-LMSR b parameter, for the price-impact estimate
  // Per-account position (zeroed when no wallet is connected).
  yes: bigint;
  no: bigint;
  collateral: bigint;
  claimed: boolean;
}

// One queried source in the resolution audit trail.
export interface ResolutionSource {
  index: number;
  requestId: bigint;
  data: string; // decoded utf8 (hex fallback); empty until the callback lands
}

// Full audit trail for a market's resolution, read from its SeerResolver.
// `exists` is false when the resolver has no record yet (Phase.None).
export interface Resolution {
  exists: boolean;
  phase: number;
  proposedOutcome: number;
  finalOutcome: number;
  finalized: boolean;
  challengeDeadline: number;
  requestDeadline: number;
  proposer: string;
  bond: bigint;
  disputer: string;
  disputerBond: bigint;
  escalationRequestId: bigint;
  sourcesReceived: number;
  sources: ResolutionSource[];
  llmRequestId: bigint;
  inferencePrompt: string;
  llmRawResponse: string;
  proposedAt: number;
  finalizedAt: number;
  // Resolver config snapshot, for context on bonds/windows/fees.
  bondAmount: bigint;
  challengeWindow: number;
  protocolFeeBps: number;
}

// A large bet held between commit and reveal (MEV guard), persisted to
// localStorage so a page reload doesn't strand the user's salt.
export interface PendingCommit {
  isBuy: boolean;
  side: SideValue;
  shares: string; // bigint serialized
  limit: string; // bigint serialized
  salt: string;
  commitBlock: number;
}

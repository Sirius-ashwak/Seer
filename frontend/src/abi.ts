// Human-readable ABI fragments — only the members the frontend touches.
// ethers v6 parses these directly; no JSON artifacts needed.

export const FACTORY_ABI = [
  "function allMarkets() view returns (address[])",
  "function marketCount() view returns (uint256)",
  "function faucet() returns (uint256)",
  "function faucetAmount() view returns (uint256)",
  "function nextFaucetClaim(address) view returns (uint256)",
] as const;

export const POINTS_ABI = ["function balanceOf(address) view returns (uint256)"] as const;

export const MARKET_ABI = [
  // Metadata + state
  "function question() view returns (string)",
  "function deadline() view returns (uint256)",
  "function outcome() view returns (uint8)", // 0 Pending, 1 Yes, 2 No, 3 Invalid
  "function qYes() view returns (uint256)",
  "function qNo() view returns (uint256)",
  "function priceYes() view returns (uint256)",
  "function priceNo() view returns (uint256)",
  "function largeBetBps() view returns (uint256)",
  "function isLargeBet(uint256 shares) view returns (bool)",
  // Per-trader balances
  "function yesOf(address) view returns (uint256)",
  "function noOf(address) view returns (uint256)",
  "function collateralOf(address) view returns (uint256)",
  "function claimed(address) view returns (bool)",
  // Atomic trading (side: 0 Yes, 1 No)
  "function buy(uint8 side, uint256 shares, uint256 maxCost) returns (uint256)",
  "function sell(uint8 side, uint256 shares, uint256 minPayout) returns (uint256)",
  // Commit-reveal for large bets (MEV guard)
  "function commitmentHash(bool isBuy, uint8 side, uint256 shares, uint256 limit, bytes32 salt) view returns (bytes32)",
  "function commitTrade(bytes32 commitment)",
  "function revealBuy(uint8 side, uint256 shares, uint256 maxCost, bytes32 salt) returns (uint256)",
  "function revealSell(uint8 side, uint256 shares, uint256 minPayout, bytes32 salt) returns (uint256)",
  // Settlement
  "function claim() returns (uint256)",
] as const;

export const OUTCOME_LABELS = ["Pending", "Yes", "No", "Invalid"] as const;

export const Outcome = { Pending: 0, Yes: 1, No: 2, Invalid: 3 } as const;

export const SIDE = { Yes: 0, No: 1 } as const;
export type SideValue = (typeof SIDE)[keyof typeof SIDE];

// ── Resolver audit-trail (Task X) ──────────────────────────────────────────
// SeerResolver keeps a per-market Resolution; these getters expose every field
// the resolution receipt renders. NOTE the resolver's Outcome enum is ordered
// differently from the market's: None=0, Invalid=1, Yes=2, No=3.
export const RESOLVER_ABI = [
  "function SOURCES() view returns (uint256)",
  "function bondAmount() view returns (uint256)",
  "function challengeWindow() view returns (uint256)",
  "function protocolFeeBps() view returns (uint256)",
  "function phaseOf(address market) view returns (uint8)",
  "function proposedOutcomeOf(address market) view returns (uint8)",
  "function finalOutcomeOf(address market) view returns (uint8)",
  "function isFinalized(address market) view returns (bool)",
  "function challengeDeadlineOf(address market) view returns (uint256)",
  "function requestDeadlineOf(address market) view returns (uint256)",
  "function proposerOf(address market) view returns (address)",
  "function bondOf(address market) view returns (uint256)",
  "function disputerOf(address market) view returns (address)",
  "function disputerBondOf(address market) view returns (uint256)",
  "function escalationRequestIdOf(address market) view returns (uint256)",
  "function sourcesReceivedOf(address market) view returns (uint8)",
  "function sourceRequestIdOf(address market, uint256 index) view returns (uint256)",
  "function sourceDataOf(address market, uint256 index) view returns (bytes)",
  "function llmRequestIdOf(address market) view returns (uint256)",
  "function llmRawResponseOf(address market) view returns (bytes)",
  "function inferencePromptOf(address market) view returns (bytes)",
  "function proposedAtOf(address market) view returns (uint256)",
  "function finalizedAtOf(address market) view returns (uint256)",
] as const;

// SeerResolver.Phase
export const ResolverPhase = {
  None: 0,
  AwaitingSources: 1,
  AwaitingInference: 2,
  Challenge: 3,
  Disputed: 4,
  Finalized: 5,
} as const;
export const RESOLVER_PHASE_LABELS = [
  "None",
  "Awaiting sources",
  "Awaiting inference",
  "Challenge window",
  "Disputed",
  "Finalized",
] as const;

// SeerResolver.Outcome (distinct ordering from the market's Outcome enum)
export const ResolverOutcome = { None: 0, Invalid: 1, Yes: 2, No: 3 } as const;
export const RESOLVER_OUTCOME_LABELS = ["Pending", "Invalid", "Yes", "No"] as const;

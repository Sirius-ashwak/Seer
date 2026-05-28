# SEER — A–Z Build Task List

Sequenced from environment setup to demo. **P0** tasks are mandatory for a working submission; **P1** strengthens it; **P2** are stretch goals. Each task is sized for a solo builder.

---

## Phase 0 — Setup & Foundations (Day 1)

| # | Task | Priority | Done when… |
|---|---|---|---|
| A | Init Hardhat/Foundry repo; add Somnia testnet RPC, chain ID, deployer wallet, faucet STT | P0 | `npx hardhat compile` succeeds against Somnia testnet |
| B | Read docs.somnia.network/agents end-to-end; confirm IAgentRequester address, deposit math, callback shape | P0 | A hello-world agent call returns a verified result on testnet |
| C | Define SEER Points (soulbound, non-transferable ERC-20-like) for v1 settlement | P0 | Token mints to test wallets; `transfer()` reverts |

## Phase 1 — Liquidity Engine (Days 2–3)

| # | Task | Priority | Done when… |
|---|---|---|---|
| D | Implement LS-LMSR math library (cost fn, price, buy/sell deltas) with fixed-point arithmetic | P0 | Unit tests match reference values within tolerance |
| E | Build `SeerMarket.sol`: mint/burn YES-NO shares against the curve, hold escrow | P0 | Trader can buy & sell both sides; invariants hold |
| F | Treasury seeding: factory funds initial b-subsidy at deploy | P0 | A zero-bettor market is tradeable immediately |
| G | Reentrancy guard + pull-payment claim scaffold | P0 | Slither/echidna finds no reentrancy path |

## Phase 2 — Resolution Security (Days 3–5)

| # | Task | Priority | Done when… |
|---|---|---|---|
| H | `SeerResolver.sol`: query 3 diverse sources via JSON API Request + LLM Inference | P0 | Resolver returns an outcome on a known past event |
| I | Bonded `proposeOutcome()` + liveness/challenge window timer | P0 | Proposal visible but no payout until window closes |
| J | `dispute()` with matching bond; escalate via `createAdvancedRequest()` | P0 | A disputed outcome re-resolves on a larger subcommittee |
| K | Slashing: losing bond → winner minus protocol fee | P0 | Bond balances move correctly after a resolved dispute |
| L | INVALID bucket + full refund path on timeout/no-consensus | P0 | Unresolvable market returns 100% of stakes |
| M | Source registry (permissioned) + HTML sanitization before LLM | P1 | Injected hidden-HTML payload does not change the outcome |
| N | Source-diversity check (reject correlated providers) | P1 | Resolution reverts when all 3 sources share a CDN |

## Phase 3 — Discovery & Orchestration (Days 5–6)

| # | Task | Priority | Done when… |
|---|---|---|---|
| O | `SeerSignalAgent.sol`: scan approved sources, score marketability via LLM Inference | P0 | Agent emits `MarketProposed` for a real live event |
| P | Creation bond on proposal (slashed if market resolves INVALID as junk) | P0 | Junk proposal loses its bond after INVALID resolution |
| Q | `SeerMarketFactory.sol`: reactive ContractEvent subscription → deploy + seed | P0 | Market auto-deploys in the same block as the bonded proposal |
| R | SeerMarket Schedule subscription → auto-trigger resolution at deadline | P0 | Resolution fires with no manual/off-chain call |

## Phase 4 — Settlement, Interface & Hardening (Days 6–7)

| # | Task | Priority | Done when… |
|---|---|---|---|
| S | `SeerSettlement.sol`: finalize YES/NO/INVALID, enable claims/refunds | P0 | Winners claim; losers cannot; refunds work on INVALID |
| T | MEV guard: commit-reveal or block-tick batch on large bets | P1 | Sandwich attempt in a test mempool fails |
| U | `IResolver` plug-in interface for external dApps | P2 | A mock external contract requests & receives a bonded resolution |
| V | Full test suite + invariant/fuzz tests; gas profiling | P1 | Coverage ≥ 80%; no failing invariants |

## Phase 5 — Frontend, Docs & Demo (Days 7–9)

| # | Task | Priority | Done when… |
|---|---|---|---|
| W | Minimal frontend: market list, LS-LMSR trade widget, live price | P1 | User can trade on a deployed market from the browser |
| X | Resolution receipt view: sources, returned data, validator votes, dispute log | P1 | Every resolved market shows a full audit trail |
| Y | README + architecture diagram + primitive-mapping table; deploy script | P0 | A judge can clone, read, and redeploy from docs |
| Z | 2–5 min demo video: live event → auto-market → trade → staged dispute → settle | P0 | Video shows the dispute being caught and reversed on-chain |

---

## 14. Critical Path & Risk Notes

- **Critical path:** D → E → H → I → J → L → Q → R → S → Z. If time runs short, cut P2 (U) and the heavier P1 items (T, M/N) before touching any P0.
- **Biggest technical risk:** the exact shape of Somnia's agent callback and Schedule subscription. De-risk this on Day 1 (Task B) before building anything on top of it.
- **Demo risk:** a live dispute is the money shot for judges. Pre-stage a market with a known-wrong source so you can trigger and reverse a dispute reliably on stage.
- **Scope risk:** do not add real-money settlement in v1. Soulbound SEER Points keep you out of regulatory territory and let you focus the limited time on the security model that differentiates you.

## 15. Definition of Done (submission-ready)

- All P0 tasks complete and deployed to Somnia testnet.
- At least 10 markets created, traded, and resolved with zero human intervention.
- At least one dispute staged, caught, escalated, and reversed on-chain.
- Every market resolvable to YES, NO, or INVALID — no funds ever locked.
- Public GitHub repo with README, architecture diagram, and primitive-mapping table.
- 2–5 minute demo video showing the full autonomous lifecycle including a dispute.

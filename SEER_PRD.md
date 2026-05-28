# SEER — Product Requirements Document

**The Resolution & Liquidity Layer for Somnia Prediction Markets**

Somnia Agentathon · Encode Club · Version 1.0 · May 2026

---

## 1. Overview & Positioning

**SEER** is a bonded, AI-driven optimistic resolution and liquidity layer for prediction markets on Somnia's Agentic L1. Rather than competing with Somnia's own flagship market app (Prophecy Social), SEER provides the trust infrastructure that real-money or high-stakes markets require: economically-secured resolution, continuous liquidity, and an explicit invalid-outcome path.

> **Positioning in one line:** SEER is the resolution-and-liquidity infrastructure that sits *underneath* prediction markets on Somnia — the layer Prophecy Social and every future market needs but does not itself provide.

**Why this wins.** Somnia already proved autonomous market creation works (Prophecy Social: 5,000+ users, 2,000+ markets in week one). What no one on the chain has shipped is a trustworthy resolution layer with skin-in-the-game and a liquidity engine that works on long-tail markets. Building infrastructure under the host platform's thesis is a stronger hire signal than cloning the host platform.

---

## 2. Problem Statement

Three structural problems sink autonomous prediction markets. SEER exists to solve all three.

| Problem | Why it kills the product | SEER's answer |
|---|---|---|
| No real resolution security | An LLM returning "confidence ≥ 80" is a number a model picked, not a guarantee. Consensus on a poisoned input is still wrong. | Bonded optimistic resolution with a dispute window and slashing. |
| Zero liquidity on long-tail markets | Parimutuel pools need a matched counterparty; obscure auto-created markets have none, so they are untradeable. | LS-LMSR automated market maker — every market is liquid from block one. |
| Unresolvable / ambiguous events | Forcing a coin-flip answer or locking funds forever is the worst possible outcome. | Explicit Invalid bucket with full refunds. |

---

## 3. Goals & Non-Goals

### 3.1 Goals

- **G1.** Resolve markets with economic security — proposers post bonds, disputes escalate, losers are slashed.
- **G2.** Guarantee liquidity on any market via an LS-LMSR market maker, regardless of popularity.
- **G3.** Never lock or mis-resolve funds — every market resolves to YES, NO, or Invalid (refund).
- **G4.** Be agent-native — discovery, proposal, and resolution all run through Somnia agent primitives, not off-chain bots.
- **G5.** Be pluggable — expose a clean interface so other Somnia dApps can use SEER as their resolver.

### 3.2 Non-Goals (for the hackathon build)

- **NG1.** Not a consumer betting brand competing with Prophecy Social on UX.
- **NG2.** No real-money settlement in v1 — uses a soulbound, non-tradable points token (SEER Points) to sidestep regulation during the program.
- **NG3.** No cross-chain bridging, no mobile app, no token sale in v1.

---

## 4. Target Users & Personas

| Persona | Need | How SEER serves them |
|---|---|---|
| Market participant | Trade an opinion on an event and trust the payout is fair | LS-LMSR gives instant liquidity; bonded resolution + disputes make payouts trustworthy |
| Market proposer (agent or human) | Spin up a market on a live event quickly | SignalAgent auto-proposes; humans can propose with a creation bond |
| dApp builder on Somnia | A resolution oracle they don't have to build | SEER exposes `IResolver` — request a resolution, get a bonded, disputable answer back |
| Disputer / watchdog | Earn by catching bad resolutions | Post a bond to challenge; win the proposer's bond if correct |

---

## 5. Core Features (v1 scope)

| ID | Feature | Description | Priority |
|---|---|---|---|
| F1 | Signal & discovery agent | Scans approved APIs/sources, scores events, proposes markets with a creation bond | P0 |
| F2 | LS-LMSR market maker | Liquidity-sensitive logarithmic market scoring rule; continuous pricing, no counterparty needed | P0 |
| F3 | Bonded optimistic resolver | Resolver agent proposes outcome + bond; challenge window before payout | P0 |
| F4 | Dispute & escalation | Anyone disputes with matching bond; escalates to larger validator subcommittee | P0 |
| F5 | Invalid bucket + refunds | Unresolvable / no-consensus markets refund all participants | P0 |
| F6 | Source registry + sanitization | Permissioned source list; strip hidden HTML before LLM to block prompt injection | P1 |
| F7 | Resolution receipt UI | Public record of sources, returned data, validator votes, dispute history | P1 |
| F8 | IResolver plug-in interface | External dApps request bonded resolutions from SEER | P2 |

---

## 6. User Stories

- As a **trader**, I can buy YES/NO shares on any market and the price moves along an LS-LMSR curve so I always have a counterparty.
- As a **proposer**, I post a creation bond so I have skin in the game; if my market is junk/unresolvable I lose it.
- As a **disputer**, I challenge a wrong resolution by matching the proposer's bond, and I win it if the escalated subcommittee agrees with me.
- As a **participant in an unresolvable market**, I get my stake refunded rather than losing it to a forced coin-flip.
- As a **dApp builder**, I call SEER's resolver and receive a bonded, disputable outcome I can trust.

---

## 7. Success Metrics

| Metric | Target (demo / hackathon) | Why it matters |
|---|---|---|
| Markets resolved end-to-end with no human | ≥ 10 live on testnet | Proves autonomous performance (judging criterion) |
| Dispute caught & reversed in demo | ≥ 1 staged on stage | Proves the security model is real, not theatre |
| Liquidity on a zero-bettor market | Tradeable from block one | Proves LS-LMSR solves the #1 killer |
| Invalid market refunded correctly | 100% of funds returned | Proves no funds ever lock |
| Primitive calls wired to real IAgentRequester | All agent calls on-chain | Judges diff code against Somnia docs |

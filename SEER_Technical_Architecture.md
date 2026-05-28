# SEER — Technical Architecture

Somnia Agentathon · Companion to the PRD · Version 1.0

---

## 8. System Overview

SEER is five on-chain contracts plus three Somnia agent roles. The agent roles are **not off-chain servers** — they are invocations of Somnia's native agent primitives, re-executed and verified by a validator subcommittee.

```
  External world (approved sources)
        |  JSON API Request / LLM Parse Website  (agent primitive)
        v
  [1] SeerSignalAgent  ---- LLM Inference: score + draft market ---->
        |  emits MarketProposed (+ creation bond)
        v
  [2] SeerMarketFactory  (reactive: ContractEvent subscription)
        |  deploys, seeds LS-LMSR
        v
  [3] SeerMarket (LS-LMSR)  <---- traders buy/sell YES/NO shares
        |  Schedule subscription fires at deadline
        v
  [4] SeerResolver  -- 3 diverse sources + LLM Inference -->
        |  proposeOutcome() + bond  ->  CHALLENGE WINDOW
        |     (dispute? -> escalate to larger subcommittee)
        v
  [5] SeerSettlement  -> YES | NO | INVALID -> pull-payment claims
```

---

## 9. Contract Responsibilities

| Contract | Responsibility | Key Somnia primitive |
|---|---|---|
| `SeerSignalAgent.sol` | Scan sources, score marketability, draft & propose markets with a creation bond | JSON API Request, LLM Parse Website, LLM Inference |
| `SeerMarketFactory.sol` | Reactively deploy & seed a SeerMarket when a proposal is bonded | Reactive ContractEvent subscription |
| `SeerMarket.sol` | LS-LMSR pricing, mint/burn YES-NO shares, hold escrow, schedule resolution | Schedule (timer) subscription |
| `SeerResolver.sol` | Query diverse sources, run inference, propose bonded outcome, run challenge window, escalate disputes | JSON API Request, LLM Inference, advanced subcommittee request |
| `SeerSettlement.sol` | Finalize YES/NO/INVALID, slash losing bonds, enable pull-payment claims/refunds | — (pure settlement logic) |

---

## 10. The Resolution Security Model

This replaces the "confidence ≥ 80" handwave. It is the heart of SEER and the part judges will scrutinize.

1. **Propose.** The resolver agent queries 3 independently-sourced data points (different providers/CDNs) and runs LLM Inference. It posts the outcome plus a proposer bond. Payout does **not** happen yet.
2. **Liveness window.** A challenge window opens (30 min for high-Caliber markets, up to 2 h for ambiguous ones). No funds move during this time.
3. **Challenge.** Any address can dispute by posting an equal bond. This freezes the proposed outcome.
4. **Escalate.** A dispute triggers re-resolution by a larger, fresh validator subcommittee via `createAdvancedRequest()` with higher `subcommitteeSize` and a stricter threshold.
5. **Slash & settle.** The losing side forfeits its bond to the winner minus a protocol fee. If no consensus is reached, the market resolves INVALID and everyone is refunded.

> **Why this is secure where "confidence ≥ 80" is not:** An attacker who poisons a source (e.g. prompt injection in scraped HTML) must now also out-bond every honest disputer through an escalated, larger subcommittee — turning a free attack into an expensive one. Lying costs money; catching liars earns money.

---

## 11. The Liquidity Engine (LS-LMSR)

Each market runs a liquidity-sensitive logarithmic market scoring rule. Share price is a softmax over outstanding share quantities, so a trader can always buy or sell against the curve — there is never a need for a matched counterparty. The cost function is:

```
C(q) = b(q) * ln( e^(q_yes / b) + e^(q_no / b) )
price_yes = e^(q_yes/b) / ( e^(q_yes/b) + e^(q_no/b) )
b(q) = alpha * (q_yes + q_no)     // liquidity-sensitive: b grows with volume
```

**Seeding:** the factory seeds each market with an initial subsidy from the protocol treasury so the curve exists at deploy time. This subsidy is the cost of guaranteeing liquidity and must be budgeted per market (a fixed small amount of SEER Points in v1).

---

## 12. Somnia Primitive Mapping (real interfaces)

All agent calls go through the platform requester contract, not invented model names. Use the real testnet address `0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776` and verify it against docs.somnia.network before submission.

| Somnia primitive | Used by | Purpose in SEER |
|---|---|---|
| JSON API Request | SignalAgent, Resolver | Pull structured event & outcome data from approved APIs |
| LLM Parse Website | SignalAgent | Extract candidate events from approved web sources (sanitized) |
| LLM Inference | SignalAgent, Resolver | Score marketability; synthesize outcome from diverse sources |
| Reactive: ContractEvent | MarketFactory | Auto-deploy a market when a proposal is bonded |
| Reactive: Schedule | SeerMarket | Fire resolution exactly at the market deadline (no off-chain bot) |
| `createAdvancedRequest()` | Resolver | Escalate disputes to a larger subcommittee with stricter threshold |

---

## 13. Security Checklist (contract-level)

- **Reentrancy:** checks-effects-interactions + reentrancy guard on every fund-moving function.
- **Pull payments:** winners call `claim()`; the contract never pushes funds.
- **MEV:** commit-reveal (or block-tick batch settlement) on bets above a size threshold to stop sandwiching.
- **Prompt injection:** strip `<script>`, `aria-*`, `meta`, alt-text and invisible nodes from scraped content before it reaches LLM Inference.
- **Source diversity:** reject resolution if the 3 sources share a provider/CDN/publisher.
- **Stuck funds:** no path locks funds — timeout or no-consensus always routes to INVALID + refund.
- **Admin keys:** any pause/upgrade behind a documented multisig + timelock; disclose in the README.

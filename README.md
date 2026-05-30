# SEER

**A bonded optimistic resolution layer and liquidity engine for on-chain prediction markets on [Somnia](https://somnia.network).**

SEER lets anyone open a binary YES/NO prediction market, trade it against a
liquidity-sensitive automated market maker, and have the outcome resolved by a
network of independent data sources and an LLM — without trusting any single
oracle. Disputed outcomes escalate to a larger committee, and dishonest stakes
are slashed. Markets are seeded so they are tradeable from the first block.

In v1 every market settles in **SEER Points**, a soulbound (non-transferable)
accounting token. No real-money value is at stake; Points exist to make
collateral, bonds, and slashing economically meaningful while keeping the
system permissionless to experiment with.

> Status: built for the Somnia Agentathon and targets the Shannon testnet.
> The contracts are covered by an extensive test suite but have **not** been
> audited. Do not deploy with real value.

## Architecture at a glance

The system reads top-to-bottom: a market is discovered, deployed with liquidity,
traded, resolved by the agent network, and settled back to the market.

```
  Discovery    creator stakes a creation bond
                    |
                    v
               SeerSignalAgent --(LLM marketability score)--> emits MarketProposed
                    |
                    |  ContractEvent subscription fires the factory reactor
                    v
  Liquidity    SeerMarketFactory --(deploy + seed with Points subsidy)--> tradeable at block 0
                    |
                    v
  Trading      SeerMarket (LS-LMSR YES/NO) <--(buy / sell / claim)--> traders
                    |
                    |  at the deadline the market becomes its own proposer:
                    |  triggerResolution()  (Schedule subscription)
                    v
  Resolution   SeerResolver --(3x JSON API agents)--> LLM inference --> verdict
                    |                                       \
                    |  undisputed + window elapsed           \  dispute() --> advanced committee
                    v                                           (reverses + slashes)
  Settlement   SeerSettlement.settle(market) --(reads finalOutcomeOf)--> market opens claims
```

`SeerPoints` sits underneath all of it as the soulbound settlement asset: trading
collateral, proposer/disputer bonds, and creation bonds — escrowed and slashed by
registered operators. The next section details the resolution lifecycle itself.

## How resolution works

Resolution follows an optimistic-oracle pattern. A proposer kicks off a
resolution by posting a Points bond; the outcome the agent network returns is a
*proposal* that anyone can dispute during a challenge window. Only undisputed
or escalated outcomes ever finalize, and a stalled flow always refunds.

```
requestResolution(market, sources[3], prompt)   [+ Points bond]
        |
        v
  AwaitingSources ----> three independent JSON API agent requests
        |  (all three returned)
        v
  AwaitingInference ---> LLM inference request -> verdict: Yes | No | Invalid
        |
        v
  Challenge            proposed outcome is visible, but no payout yet
        |                              \
        | window elapses, undisputed    \  dispute() + matching bond + escalation deposit
        v                                v
  finalize()                          Disputed --> createAdvancedRequest()
        |                                |          (larger subcommittee, stricter threshold)
        v                                v
  Finalized                       handleEscalationResponse()
  bond returned to proposer              |
                                         v
                                   Finalized
                                   winner takes both bonds minus a protocol fee;
                                   a no-consensus result resolves INVALID and
                                   refunds both bonds

  timeoutResolution(): any phase stalled past the timeout -> INVALID + full refund
```

## Components

| Contract | Responsibility |
|---|---|
| `SeerResolver.sol` | Bonded optimistic oracle. Fans out to three independent data sources via Somnia JSON API agents, synthesizes a verdict with an LLM inference agent, then runs the challenge / dispute / escalation / slashing lifecycle above. One instance resolves many markets. |
| `SeerMarket.sol` | A single LS-LMSR binary YES/NO market. Tracks share balances internally (no transferable share tokens in v1) and escrows SEER Points as collateral. Lifecycle: Open → Resolved/Invalid → claims. |
| `SeerSettlement.sol` | Authoritative bridge between oracle and market. Each market is constructed with this contract as its resolver; a permissionless `settle(market)` crank reads the resolver's finalized verdict, maps it to the market outcome, and opens the market's claim/refund path. |
| `SeerMarketFactory.sol` | Deploys markets and seeds each with the LMSR opening cost in Points, so a market with zero bettors is still tradeable immediately. Its reactor-only `onMarketProposed` is fired by a Somnia ContractEvent subscription to deploy, seed, pre-fund the oracle bond, and arm self-resolution in one call. |
| `SeerSignalAgent.sol` | Discovery + orchestration. Anyone proposes a candidate market behind a creation bond; the agent scores its marketability via an LLM inference agent and emits `MarketProposed` once it clears the threshold. The creation bond is slashed to the treasury if the spawned market resolves INVALID (junk), and refunded otherwise. |
| `SeerPoints.sol` | Soulbound, ERC-20-like settlement asset. Transfers and approvals revert; only the owner mints/burns, and registered operators move balances via `operatorTransfer` for escrow and slashing. |
| `lib/LsLmsr.sol` | Liquidity-sensitive LMSR cost and price math, WAD-scaled and numerically stabilized with the log-sum-exp trick. |
| `HelloAgent.sol` | Minimal probe that fires one agent request and stores the callback — used to validate the Somnia agent deposit math and callback shape on testnet. |
| `interfaces/` | `IAgentRequester` (Somnia agent primitive), `ISeerPoints`, and `ISeerResolver`. |

## Somnia primitives

SEER is built around three Somnia network primitives. The table maps each to the
SEER component that consumes it and the on-chain entry point.

| Somnia primitive | What it provides | SEER usage | Entry point |
|---|---|---|---|
| **JSON API agent** | Off-chain HTTP fetch, returned via callback | Three independent data sources are queried per resolution and reconciled before a verdict is formed | `SeerResolver.requestResolution` → `handleSourceResponse` |
| **LLM inference agent** | Natural-language reasoning, returned via callback | Synthesizes the three sources into a YES/NO/INVALID verdict; also scores a candidate's marketability during discovery | `SeerResolver.handleSourceResponse` → LLM request; `SeerSignalAgent.propose` → `handleScoreResponse` |
| **Advanced agent request** | Larger subcommittee with a stricter consensus threshold | A disputed verdict escalates to a bigger committee before finalizing | `SeerResolver.dispute` → `createAdvancedRequest` → `handleEscalationResponse` |
| **ContractEvent subscription** | A reactor fires an on-chain call when a watched event is emitted | `MarketProposed` from the signal agent triggers reactive deploy + seed + bond pre-fund + auto-resolution arming in one block | `SeerSignalAgent` emits `MarketProposed` → `SeerMarketFactory.onMarketProposed` |
| **Schedule subscription** | A timer fires a permissionless on-chain call | At the market deadline, the market becomes its own bonded proposer against the oracle — no off-chain trigger | `SeerMarket.triggerResolution` |

The agent IDs and the reactor/scheduler subscriptions are environment-configured;
see `.env.example`. The ContractEvent and Schedule subscriptions are registered
off-chain against the deployed addresses — until then the reactor defaults to the
deployer EOA and markets can be cranked manually.

## Repository layout

```
contracts/
  src/
    SeerResolver.sol         Bonded optimistic oracle + dispute lifecycle
    SeerMarket.sol           LS-LMSR binary prediction market + self-resolution
    SeerMarketFactory.sol    Market deployment + liquidity subsidy + reactive deploy
    SeerSettlement.sol       Oracle-to-market settlement bridge
    SeerSignalAgent.sol      Market discovery, marketability scoring, creation bond
    SeerPoints.sol           Soulbound settlement token
    HelloAgent.sol           Agent-callback probe
    lib/LsLmsr.sol           LMSR cost/price math
    interfaces/              IAgentRequester, ISeerPoints, ISeerResolver
  test/                      Foundry tests, including mocks/
  script/
    Deploy.s.sol             Full-stack testnet deploy
    SeedLocal.s.sol          Local-only deploy + demo-market seeding (mock agents)
    Ask.s.sol                Agent-probe helper
  foundry.toml
frontend/                    Vite + React + TypeScript demo UI
  src/
    components/              Market grid/detail, trade panel, resolution receipt
    hooks/                   Wallet, market data, faucet, resolution audit trail
    lib/                     ethers contract factories, formatting, tx helpers
    config.ts                Network presets + deployed addresses (set ACTIVE)
    abi.ts                   Human-readable ABI fragments
```

## Getting started

### Prerequisites

- [Foundry](https://book.getfoundry.sh/getting-started/installation) (`forge`, `cast`, `anvil`)

### Build and test

All commands run from the `contracts/` directory.

```bash
cd contracts
forge install   # fetch solady / forge-std submodules, if not already present
forge build
forge test
```

The suite contains 190 tests across eleven suites, covering the LMSR math
(including fuzz runs), market trading and claims, the soulbound token, the
factory subsidy, the full resolver dispute/slashing/refund lifecycle, the
reactive auto-deploy + auto-resolution path, the discovery + creation-bond
flow (marketability scoring, slash on INVALID, refund otherwise), the
end-to-end settlement path from a finalized oracle verdict to winning claims,
source hardening (HTML sanitization + permissioned registry + provider
diversity), the MEV guard (commit-reveal that defeats an atomic sandwich), and
LS-LMSR invariants (solvency, price consistency, share-accounting conservation)
verified across thousands of randomized trades.

```bash
forge test -vvv                          # verbose traces
forge test --match-contract SeerResolver # one suite
forge fmt                                # format
forge snapshot                           # gas snapshots
```

## Configuration

Deployment and on-chain scripts read from environment variables. Copy the
example file and fill in your own values:

```bash
cp contracts/.env.example contracts/.env
```

| Variable | Used for |
|---|---|
| `SOMNIA_TESTNET_RPC` | RPC endpoint for the `somnia_testnet` profile |
| `SOMNIA_EXPLORER_KEY` | Contract verification on the Shannon explorer |

Never commit a populated `.env` or any private key.

## Run the demo locally

The fastest way to see SEER end-to-end — no testnet funds required — is a local
anvil chain seeded with demo markets, plus the React frontend. This needs
[Node.js 18+](https://nodejs.org) in addition to Foundry.

```bash
# 1. start a local chain and leave it running
anvil

# 2. in a second shell: deploy the full stack and seed demo markets
cd contracts
PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  forge script script/SeedLocal.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
```

`SeedLocal.s.sol` deploys the stack against a mock agent requester (so the agent
callbacks can be driven on anvil) and seeds five markets. It drives two through
the resolver: market 0 (three sources agree, LLM proposes YES) is left mid
challenge window, and market 1 is proposed YES, disputed, and reversed to NO by
the escalation committee, then settled — exercising the full dispute path. To
finalize the undisputed market 0 (the addresses below are deterministic on a
fresh anvil; otherwise read them from the script's log):

```bash
RPC=http://127.0.0.1:8545
KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
RESOLVER=0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0
SETTLEMENT=0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9
MARKET0=0x856e4424f806D16E8CBC702B3c0F2ede5468eae5
cast rpc evm_increaseTime 1860 --rpc-url $RPC   # advance past the 30-min window
cast rpc evm_mine --rpc-url $RPC
cast send $RESOLVER 'finalize(address)' $MARKET0 --private-key $KEY --rpc-url $RPC
cast send $SETTLEMENT 'settle(address)' $MARKET0 --private-key $KEY --rpc-url $RPC
```

```bash
# 3. in a third shell: run the frontend
cd frontend
npm install
npm run dev          # serves http://localhost:5173
```

The frontend defaults to the `local` preset in `src/config.ts`, whose addresses
match `SeedLocal`'s deterministic deploy, so no edits are needed. Point a wallet
at `http://127.0.0.1:8545` (chain id `31337`) and import an anvil test key, then
connect, claim test Points from the faucet, trade a market, and open a resolved
market to see its full on-chain resolution receipt — sources, the LLM prompt and
verdict, both bonds, and the finalized (or reversed) outcome.

To target the live testnet instead, set `ACTIVE = "somniaTestnet"` in
`src/config.ts` and fill in the addresses logged by `Deploy.s.sol`.

## Deploying to Somnia testnet

```bash
cd contracts
forge script script/Deploy.s.sol \
  --rpc-url somnia_testnet \
  --broadcast \
  --private-key <your_key>
```

### Network details

| | |
|---|---|
| Network | Somnia Shannon testnet |
| Chain ID | `50312` |
| Explorer | https://shannon-explorer.somnia.network |
| Agent requester | `0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776` |

## License

MIT. See [LICENSE](LICENSE).

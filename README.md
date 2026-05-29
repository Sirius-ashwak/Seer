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
  script/                    Deploy.s.sol, Ask.s.sol
  foundry.toml
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

The suite contains 151 tests across eight suites, covering the LMSR math
(including fuzz runs), market trading and claims, the soulbound token, the
factory subsidy, the full resolver dispute/slashing/refund lifecycle, the
reactive auto-deploy + auto-resolution path, the discovery + creation-bond
flow (marketability scoring, slash on INVALID, refund otherwise), and the
end-to-end settlement path from a finalized oracle verdict to winning claims.

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

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {SeerMarket} from "./SeerMarket.sol";
import {SeerResolver} from "./SeerResolver.sol";

// SeerSettlement — Task S.
//
// The authoritative bridge between the oracle and the market. Each SeerMarket
// is constructed with this contract as its `resolver`, so Settlement is the
// only address that can flip a market's outcome. Resolution itself (the bonded
// 3-source + LLM + dispute lifecycle) lives in SeerResolver; Settlement just
// reads the finalized verdict and pushes it into the matching market, which
// then opens its own pull-payment claim / refund path.
//
//   SeerResolver.finalize()/escalation/timeout  ──► finalOutcomeOf(market)
//                                                        │
//                                   settle(market)  ◄────┘  (permissionless crank)
//                                        │
//                                        ▼
//                              SeerMarket.resolve(outcome)  ──► claims open
//
// settle() is permissionless: anyone can crank a finalized market into its
// settled state. There is no privileged settler — the trust is entirely in the
// oracle's finalized outcome, which is already bonded and dispute-resolved.
//
// Settlement deliberately does NOT own SeerPoints. Winning payouts (1 WAD per
// winning share) and INVALID refunds are covered by the market's own balance:
// the factory's opening subsidy plus all collateral paid in during trading.
// That coverage is asserted by SeerMarket's winning-side invariant, so no
// resolution-time minting is required.
contract SeerSettlement {
    SeerResolver public immutable resolver;

    event Settled(address indexed market, SeerMarket.Outcome outcome);

    error ZeroAddress();
    error NotFinalized();
    error UnresolvableOutcome();

    constructor(address resolver_) {
        if (resolver_ == address(0)) revert ZeroAddress();
        resolver = SeerResolver(resolver_);
    }

    // Push the oracle's finalized verdict for `market` into the market. Reverts
    // if the oracle has not finalized this market yet; reverts (via the market)
    // if it was already settled.
    function settle(address market) external returns (SeerMarket.Outcome outcome) {
        if (!resolver.isFinalized(market)) revert NotFinalized();
        outcome = _map(resolver.finalOutcomeOf(market));
        SeerMarket(market).resolve(outcome);
        emit Settled(market, outcome);
    }

    // Map the oracle's outcome enum onto the market's. The enums are parallel
    // but ordered differently, so the mapping is explicit. A finalized market
    // never carries Outcome.None (finalize/escalation/timeout always set a
    // concrete verdict), so that case reverts defensively.
    function _map(SeerResolver.Outcome o) internal pure returns (SeerMarket.Outcome) {
        if (o == SeerResolver.Outcome.Yes) return SeerMarket.Outcome.Yes;
        if (o == SeerResolver.Outcome.No) return SeerMarket.Outcome.No;
        if (o == SeerResolver.Outcome.Invalid) return SeerMarket.Outcome.Invalid;
        revert UnresolvableOutcome();
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

import {IAgentRequester} from "../src/interfaces/IAgentRequester.sol";
import {LsLmsr} from "../src/lib/LsLmsr.sol";
import {SeerMarket} from "../src/SeerMarket.sol";
import {SeerPoints} from "../src/SeerPoints.sol";
import {SeerResolver} from "../src/SeerResolver.sol";
import {SeerSettlement} from "../src/SeerSettlement.sol";
import {MockAgentRequester} from "./mocks/MockAgentRequester.sol";

// Full-stack integration test for Task S: the oracle (SeerResolver) finalizes a
// verdict, SeerSettlement cranks it into the matching SeerMarket, and the
// market's pull-payment claim / refund path pays winners and refunds on INVALID.
contract SeerSettlementTest is Test {
    MockAgentRequester internal mockRequester;
    SeerPoints internal points;
    SeerResolver internal resolver;
    SeerSettlement internal settlement;
    SeerMarket internal market;

    address internal admin = address(0xAD);
    address internal proposer = address(0xA1); // posts the resolver bond
    address internal yesBuyer = address(0xB1);
    address internal noBuyer = address(0xB2);

    // Resolver config.
    uint256 internal constant JSON_AGENT_ID = 42;
    uint256 internal constant LLM_AGENT_ID = 99;
    uint256 internal constant SOURCE_DEPOSIT = 0.05 ether;
    uint256 internal constant LLM_DEPOSIT = 0.05 ether;
    uint256 internal constant TOTAL_DEPOSIT = 3 * SOURCE_DEPOSIT + LLM_DEPOSIT;
    uint256 internal constant BOND = 10 ether;
    uint256 internal constant CHALLENGE_WINDOW = 30 minutes;

    // Market config.
    uint256 internal constant ALPHA = 0.1 ether;
    uint256 internal constant SEED = 100 ether;
    uint256 internal constant TRADE_SHARES = 10 ether;
    uint256 internal constant FUNDING = 1_000 ether;

    function setUp() public {
        mockRequester = new MockAgentRequester();
        points = new SeerPoints(address(this));
        resolver = new SeerResolver(
            address(mockRequester),
            address(points),
            admin,
            JSON_AGENT_ID,
            LLM_AGENT_ID,
            SOURCE_DEPOSIT,
            LLM_DEPOSIT,
            BOND,
            CHALLENGE_WINDOW
        );
        settlement = new SeerSettlement(address(resolver));

        // The market trusts Settlement as its resolver (production wiring).
        market = new SeerMarket(
            address(points),
            address(settlement),
            "Will it rain in NYC on 2026-06-01?",
            block.timestamp + 7 days,
            ALPHA,
            SEED,
            SEED,
            0 // MEV guard disabled for these unit tests
        );

        // Operators: resolver escrows bonds, market escrows collateral.
        points.setOperator(address(resolver), true);
        points.setOperator(address(market), true);

        // Opening subsidy that underwrites the book (the factory does this in
        // production); compute it exactly the way the factory does.
        uint256 b = LsLmsr.liquidity(SEED, SEED, ALPHA);
        points.mint(address(market), LsLmsr.cost(SEED, SEED, b));

        points.mint(proposer, FUNDING);
        points.mint(yesBuyer, FUNDING);
        points.mint(noBuyer, FUNDING);
        vm.deal(proposer, 100 ether);
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    // Drive the oracle to a finalized verdict for `market` (0=Invalid, 1=Yes,
    // 2=No). Mirrors the SeerResolver happy path: 3 sources -> inference ->
    // undisputed finalize.
    function _resolve(uint8 verdict) internal {
        bytes[] memory sources = new bytes[](3);
        sources[0] = hex"01";
        sources[1] = hex"02";
        sources[2] = hex"03";

        vm.prank(proposer);
        uint256[3] memory ids =
            resolver.requestResolution{value: TOTAL_DEPOSIT}(address(market), sources, bytes("did it happen?"));

        for (uint8 i = 0; i < 3; ++i) {
            bytes[] memory wrap = new bytes[](1);
            wrap[0] = abi.encode(uint256(i));
            mockRequester.simulateCallback(ids[i], wrap, IAgentRequester.ResponseStatus.Succeeded);
        }

        uint256 llmId = resolver.llmRequestIdOf(address(market));
        bytes[] memory v = new bytes[](1);
        v[0] = abi.encode(verdict);
        mockRequester.simulateCallback(llmId, v, IAgentRequester.ResponseStatus.Succeeded);

        vm.warp(resolver.challengeDeadlineOf(address(market)));
        resolver.finalize(address(market));
    }

    function _buy(address who, SeerMarket.Side side) internal returns (uint256 cost) {
        vm.prank(who);
        cost = market.buy(side, TRADE_SHARES, type(uint256).max);
    }

    // ─── Wiring ────────────────────────────────────────────────────────────────

    function test_constructor_rejectsZeroResolver() public {
        vm.expectRevert(SeerSettlement.ZeroAddress.selector);
        new SeerSettlement(address(0));
    }

    function test_settlementIsMarketResolver() public view {
        assertEq(market.resolver(), address(settlement));
        assertEq(address(settlement.resolver()), address(resolver));
    }

    // Only Settlement may resolve the market — a direct call from anyone else
    // (even the oracle) reverts.
    function test_market_resolveGuardedToSettlement() public {
        vm.prank(address(resolver));
        vm.expectRevert(SeerMarket.NotResolver.selector);
        market.resolve(SeerMarket.Outcome.Yes);
    }

    // ─── settle() ────────────────────────────────────────────────────────────

    function test_settle_revertsWhenNotFinalized() public {
        vm.expectRevert(SeerSettlement.NotFinalized.selector);
        settlement.settle(address(market));
    }

    function test_settle_yes_setsMarketOutcome() public {
        _resolve(1);
        SeerMarket.Outcome out = settlement.settle(address(market));
        assertEq(uint8(out), uint8(SeerMarket.Outcome.Yes));
        assertEq(uint8(market.outcome()), uint8(SeerMarket.Outcome.Yes));
    }

    function test_settle_no_setsMarketOutcome() public {
        _resolve(2);
        settlement.settle(address(market));
        assertEq(uint8(market.outcome()), uint8(SeerMarket.Outcome.No));
    }

    function test_settle_invalid_setsMarketOutcome() public {
        _resolve(0);
        settlement.settle(address(market));
        assertEq(uint8(market.outcome()), uint8(SeerMarket.Outcome.Invalid));
    }

    function test_settle_doubleSettleReverts() public {
        _resolve(1);
        settlement.settle(address(market));
        vm.expectRevert(SeerMarket.AlreadyResolved.selector);
        settlement.settle(address(market));
    }

    // ─── End-to-end claims ─────────────────────────────────────────────────────

    function test_endToEnd_yes_winnerClaims_loserCannot() public {
        _buy(yesBuyer, SeerMarket.Side.Yes);
        _buy(noBuyer, SeerMarket.Side.No);

        _resolve(1); // YES wins
        settlement.settle(address(market));

        uint256 balBefore = points.balanceOf(yesBuyer);
        vm.prank(yesBuyer);
        uint256 amount = market.claim();
        // Every winning share pays exactly 1 WAD.
        assertEq(amount, TRADE_SHARES);
        assertEq(points.balanceOf(yesBuyer), balBefore + TRADE_SHARES);

        // The losing side has nothing to claim.
        vm.prank(noBuyer);
        vm.expectRevert(SeerMarket.NothingToClaim.selector);
        market.claim();
    }

    function test_endToEnd_no_winnerClaims_loserCannot() public {
        _buy(yesBuyer, SeerMarket.Side.Yes);
        _buy(noBuyer, SeerMarket.Side.No);

        _resolve(2); // NO wins
        settlement.settle(address(market));

        vm.prank(noBuyer);
        uint256 amount = market.claim();
        assertEq(amount, TRADE_SHARES);

        vm.prank(yesBuyer);
        vm.expectRevert(SeerMarket.NothingToClaim.selector);
        market.claim();
    }

    function test_endToEnd_invalid_refundsNetCollateral() public {
        uint256 yesCost = _buy(yesBuyer, SeerMarket.Side.Yes);
        uint256 noCost = _buy(noBuyer, SeerMarket.Side.No);

        _resolve(0); // INVALID
        settlement.settle(address(market));

        // Both sides get their net collateral back — no winners, no losers.
        uint256 yesBefore = points.balanceOf(yesBuyer);
        vm.prank(yesBuyer);
        uint256 yesRefund = market.claim();
        assertEq(yesRefund, yesCost);
        assertEq(points.balanceOf(yesBuyer), yesBefore + yesCost);

        vm.prank(noBuyer);
        uint256 noRefund = market.claim();
        assertEq(noRefund, noCost);

        // Net effect on a refunded trader is zero (paid cost in, got cost out).
        assertEq(points.balanceOf(yesBuyer), FUNDING);
        assertEq(points.balanceOf(noBuyer), FUNDING);
    }

    function test_endToEnd_claimRevertsBeforeSettlement() public {
        _buy(yesBuyer, SeerMarket.Side.Yes);
        _resolve(1);
        // Oracle finalized, but Settlement has not cranked the market yet.
        vm.prank(yesBuyer);
        vm.expectRevert(SeerMarket.NotResolved.selector);
        market.claim();
    }
}

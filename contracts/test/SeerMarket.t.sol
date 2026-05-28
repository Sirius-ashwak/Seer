// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

import {LsLmsr} from "../src/lib/LsLmsr.sol";
import {SeerMarket} from "../src/SeerMarket.sol";
import {SeerPoints} from "../src/SeerPoints.sol";

contract SeerMarketTest is Test {
    uint256 internal constant WAD = 1e18;
    uint256 internal constant ALPHA = 5e16; // 0.05
    uint256 internal constant SEED = 1_000 ether;
    uint256 internal constant DEADLINE_DELAY = 7 days;
    uint256 internal constant TRADER_BALANCE = 10_000 ether;
    uint256 internal constant SUBSIDY = 200_000 ether; // generous so payouts always cover

    SeerPoints internal points;
    SeerMarket internal market;
    address internal owner = address(0xA11CE);
    address internal resolver = address(0xDEAD);
    address internal alice = address(0xA1);
    address internal bob = address(0xB0B);
    address internal carol = address(0xCAA);

    function setUp() public {
        points = new SeerPoints(owner);
        market = new SeerMarket(
            address(points),
            resolver,
            "Will BTC close above $100k on 2026-12-31?",
            block.timestamp + DEADLINE_DELAY,
            ALPHA,
            SEED,
            SEED
        );

        vm.startPrank(owner);
        points.setOperator(address(market), true);
        points.mint(alice, TRADER_BALANCE);
        points.mint(bob, TRADER_BALANCE);
        points.mint(carol, TRADER_BALANCE);
        // Subsidize the market so it can pay out worst-case claims.
        points.mint(address(market), SUBSIDY);
        vm.stopPrank();
    }

    // ─── Deterministic ───────────────────────────────────────────────────────

    function test_initialPrices_areBalanced() public view {
        uint256 pY = market.priceYes();
        uint256 pN = market.priceNo();
        assertApproxEqAbs(pY, WAD / 2, 1);
        assertApproxEqAbs(pN, WAD / 2, 1);
        assertEq(pY + pN, WAD);
    }

    function test_buyYes_movesPriceAndCollectsCollateral() public {
        uint256 marketBalBefore = points.balanceOf(address(market));
        uint256 aliceBalBefore = points.balanceOf(alice);
        uint256 priceBefore = market.priceYes();

        vm.prank(alice);
        uint256 cost = market.buy(SeerMarket.Side.Yes, 500 ether, type(uint256).max);

        assertGt(cost, 0);
        assertEq(market.yesOf(alice), 500 ether);
        assertEq(market.noOf(alice), 0);
        assertEq(points.balanceOf(alice), aliceBalBefore - cost);
        assertEq(points.balanceOf(address(market)), marketBalBefore + cost);
        assertGt(market.priceYes(), priceBefore);
    }

    function test_sell_returnsCollateral() public {
        vm.startPrank(alice);
        uint256 cost = market.buy(SeerMarket.Side.Yes, 500 ether, type(uint256).max);
        uint256 payout = market.sell(SeerMarket.Side.Yes, 500 ether, 0);
        vm.stopPrank();

        // Path-independent LMSR: round trip returns exactly the cost paid.
        assertEq(payout, cost);
        assertEq(market.yesOf(alice), 0);
        assertEq(points.balanceOf(alice), TRADER_BALANCE);
    }

    function test_buy_revertsAfterDeadline() public {
        vm.warp(block.timestamp + DEADLINE_DELAY);
        vm.prank(alice);
        vm.expectRevert(SeerMarket.TradingClosed.selector);
        market.buy(SeerMarket.Side.Yes, 1 ether, type(uint256).max);
    }

    function test_buy_revertsOnSlippage() public {
        vm.prank(alice);
        vm.expectRevert(SeerMarket.SlippageTooHigh.selector);
        market.buy(SeerMarket.Side.Yes, 500 ether, 1); // 1 wei maxCost
    }

    function test_sell_revertsOnInsufficientShares() public {
        vm.prank(alice);
        vm.expectRevert(SeerMarket.InsufficientShares.selector);
        market.sell(SeerMarket.Side.Yes, 1, 0);
    }

    function test_buy_zeroSharesReverts() public {
        vm.prank(alice);
        vm.expectRevert(SeerMarket.ZeroShares.selector);
        market.buy(SeerMarket.Side.Yes, 0, type(uint256).max);
    }

    function test_resolve_onlyResolver() public {
        vm.prank(alice);
        vm.expectRevert(SeerMarket.NotResolver.selector);
        market.resolve(SeerMarket.Outcome.Yes);
    }

    function test_resolve_rejectsPendingOutcome() public {
        vm.prank(resolver);
        vm.expectRevert(SeerMarket.InvalidOutcome.selector);
        market.resolve(SeerMarket.Outcome.Pending);
    }

    function test_resolve_locksTrading() public {
        vm.prank(resolver);
        market.resolve(SeerMarket.Outcome.Yes);

        vm.prank(alice);
        vm.expectRevert(SeerMarket.TradingClosed.selector);
        market.buy(SeerMarket.Side.Yes, 1 ether, type(uint256).max);
    }

    function test_claim_yesWins_paysOneWadPerShare() public {
        vm.prank(alice);
        market.buy(SeerMarket.Side.Yes, 500 ether, type(uint256).max);

        vm.prank(bob);
        market.buy(SeerMarket.Side.No, 500 ether, type(uint256).max);

        vm.prank(resolver);
        market.resolve(SeerMarket.Outcome.Yes);

        uint256 aliceBefore = points.balanceOf(alice);
        vm.prank(alice);
        uint256 aliceClaim = market.claim();
        assertEq(aliceClaim, 500 ether);
        assertEq(points.balanceOf(alice), aliceBefore + 500 ether);

        // Loser claim reverts with NothingToClaim (zero YES balance on a YES win).
        vm.prank(bob);
        vm.expectRevert(SeerMarket.NothingToClaim.selector);
        market.claim();
    }

    function test_claim_invalid_refundsNetCollateral() public {
        vm.prank(alice);
        uint256 cost = market.buy(SeerMarket.Side.Yes, 500 ether, type(uint256).max);

        vm.prank(resolver);
        market.resolve(SeerMarket.Outcome.Invalid);

        uint256 balBefore = points.balanceOf(alice);
        vm.prank(alice);
        uint256 refund = market.claim();
        assertEq(refund, cost);
        assertEq(points.balanceOf(alice), balBefore + cost);
    }

    function test_claim_doubleClaimReverts() public {
        vm.prank(alice);
        market.buy(SeerMarket.Side.Yes, 500 ether, type(uint256).max);

        vm.prank(resolver);
        market.resolve(SeerMarket.Outcome.Yes);

        vm.prank(alice);
        market.claim();
        vm.prank(alice);
        vm.expectRevert(SeerMarket.AlreadyClaimed.selector);
        market.claim();
    }

    function test_claim_revertsBeforeResolution() public {
        vm.prank(alice);
        market.buy(SeerMarket.Side.Yes, 500 ether, type(uint256).max);

        vm.prank(alice);
        vm.expectRevert(SeerMarket.NotResolved.selector);
        market.claim();
    }

    // ─── Fuzz ────────────────────────────────────────────────────────────────

    function testFuzz_buyAndSell_roundTripExact(uint64 shares_) public {
        uint256 shares = uint256(shares_);
        vm.assume(shares > 0 && shares < 5_000 ether);

        vm.startPrank(alice);
        uint256 cost = market.buy(SeerMarket.Side.Yes, shares, type(uint256).max);
        uint256 payout = market.sell(SeerMarket.Side.Yes, shares, 0);
        vm.stopPrank();

        // LMSR is path-independent: round trip returns exactly the cost paid.
        assertEq(payout, cost);
        assertEq(market.qYes(), SEED);
        assertEq(market.qNo(), SEED);
    }

    function testFuzz_buyYes_raisesPriceYes(uint64 shares_) public {
        uint256 shares = uint256(shares_);
        vm.assume(shares > 0 && shares < 5_000 ether);
        uint256 before_ = market.priceYes();
        vm.prank(alice);
        market.buy(SeerMarket.Side.Yes, shares, type(uint256).max);
        // Monotonic, but a single-wei trade against a 1000-ether pool
        // produces a price change below WAD precision — assertGe.
        assertGe(market.priceYes(), before_);
    }

    // After many trades, market Points balance ≥ winning side payout (no
    // under-collateralization given the seed subsidy).
    function testFuzz_winningSidePayoutCovered(uint32 a_, uint32 b_, uint32 c_) public {
        uint256 sA = uint256(a_) % 2_000 ether + 1 ether;
        uint256 sB = uint256(b_) % 2_000 ether + 1 ether;
        uint256 sC = uint256(c_) % 2_000 ether + 1 ether;

        vm.prank(alice);
        market.buy(SeerMarket.Side.Yes, sA, type(uint256).max);
        vm.prank(bob);
        market.buy(SeerMarket.Side.No, sB, type(uint256).max);
        vm.prank(carol);
        market.buy(SeerMarket.Side.Yes, sC, type(uint256).max);

        vm.prank(resolver);
        market.resolve(SeerMarket.Outcome.Yes);

        uint256 needed = market.yesOf(alice) + market.yesOf(carol);
        assertGe(points.balanceOf(address(market)), needed);
    }
}

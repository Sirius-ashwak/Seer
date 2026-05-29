// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

import {LsLmsr} from "../src/lib/LsLmsr.sol";
import {SeerMarket} from "../src/SeerMarket.sol";
import {SeerPoints} from "../src/SeerPoints.sol";

// Task T: MEV guard via cross-block commit-reveal on large bets.
//
// Done-when: a sandwich attempt in a test mempool fails. A sandwich needs the
// victim's trade to execute atomically between the attacker's front-run and
// back-run legs. With the guard armed, a trade >= largeBetBps of the pool
// cannot be placed atomically — it reverts CommitRequired — so the attacker can
// never wrap it. The legitimate path (commit in block N, reveal in N+1) still
// works, and slippage limits enforced at reveal cap any adverse fill.
//
// The threshold is pool-relative: with a 2000-ether opening pool and a 50%
// bound, the bar starts at 1000 ether and rises as buys grow the pool. Tests
// pick sizes that stay clearly on one side of that bar after expected moves.
contract SeerMevGuardTest is Test {
    uint256 internal constant ALPHA = 5e16; // 0.05
    uint256 internal constant SEED = 1_000 ether; // pool = 2000 ether
    uint256 internal constant LARGE_BET_BPS = 5_000; // 50% of pool
    uint256 internal constant THRESHOLD = 1_000 ether; // 50% of the fresh 2000-ether pool
    uint256 internal constant SMALL_BET = 10 ether; // well under the bar
    uint256 internal constant LARGE_BET = 1_500 ether; // over the bar even after a small front-run
    uint256 internal constant TRADER_BALANCE = 100_000 ether;
    uint256 internal constant SUBSIDY = 1_000_000 ether;
    uint256 internal constant DEADLINE_DELAY = 7 days;

    SeerPoints internal points;
    SeerMarket internal market;

    address internal owner = address(0xA11CE);
    address internal resolver = address(0xDEAD);
    address internal alice = address(0xA1); // victim
    address internal bob = address(0xB0B); // attacker
    bytes32 internal constant SALT = keccak256("salt");

    function setUp() public {
        points = new SeerPoints(owner);
        market = new SeerMarket(
            address(points),
            resolver,
            "Will BTC close above $100k on 2026-12-31?",
            block.timestamp + DEADLINE_DELAY,
            ALPHA,
            SEED,
            SEED,
            LARGE_BET_BPS
        );

        vm.startPrank(owner);
        points.setOperator(address(market), true);
        points.mint(alice, TRADER_BALANCE);
        points.mint(bob, TRADER_BALANCE);
        points.mint(address(market), SUBSIDY);
        vm.stopPrank();
    }

    // ─── Threshold ──────────────────────────────────────────────────────────

    function test_isLargeBet_boundary() public view {
        assertFalse(market.isLargeBet(THRESHOLD - 1));
        assertTrue(market.isLargeBet(THRESHOLD));
        assertTrue(market.isLargeBet(THRESHOLD + 1));
    }

    function test_smallBuy_executesAtomically() public {
        vm.prank(alice);
        market.buy(SeerMarket.Side.Yes, SMALL_BET, type(uint256).max);
        assertEq(market.yesOf(alice), SMALL_BET);
    }

    function test_largeBuy_directReverts() public {
        vm.prank(alice);
        vm.expectRevert(SeerMarket.CommitRequired.selector);
        market.buy(SeerMarket.Side.Yes, LARGE_BET, type(uint256).max);
    }

    function test_largeSell_directReverts() public {
        // Build a dominant position via the legitimate commit-reveal path: after
        // buying 2*SEED YES the pool is 4000 ether, so the 2000-ether holding is
        // exactly 50% — selling all of it is a "large" bet that must be staged.
        uint256 position = 2 * SEED;
        _commitRevealBuy(alice, SeerMarket.Side.Yes, position, type(uint256).max);

        vm.prank(alice);
        vm.expectRevert(SeerMarket.CommitRequired.selector);
        market.sell(SeerMarket.Side.Yes, position, 0);
    }

    // ─── Commit-reveal happy path ─────────────────────────────────────────────

    function test_commitReveal_buySucceeds() public {
        bytes32 h = market.commitmentHash(true, SeerMarket.Side.Yes, LARGE_BET, type(uint256).max, SALT);
        vm.prank(alice);
        market.commitTrade(h);

        vm.roll(block.number + 1);

        vm.prank(alice);
        market.revealBuy(SeerMarket.Side.Yes, LARGE_BET, type(uint256).max, SALT);
        assertEq(market.yesOf(alice), LARGE_BET);
    }

    function test_commitReveal_consumesCommitment() public {
        _commitRevealBuy(alice, SeerMarket.Side.Yes, LARGE_BET, type(uint256).max);

        // A second reveal with no fresh commitment must fail.
        vm.prank(alice);
        vm.expectRevert(SeerMarket.NoCommitment.selector);
        market.revealBuy(SeerMarket.Side.Yes, LARGE_BET, type(uint256).max, SALT);
    }

    // ─── Commit-reveal rejections ─────────────────────────────────────────────

    function test_reveal_withoutCommitReverts() public {
        vm.prank(alice);
        vm.expectRevert(SeerMarket.NoCommitment.selector);
        market.revealBuy(SeerMarket.Side.Yes, LARGE_BET, type(uint256).max, SALT);
    }

    function test_reveal_sameBlockReverts() public {
        bytes32 h = market.commitmentHash(true, SeerMarket.Side.Yes, LARGE_BET, type(uint256).max, SALT);
        vm.startPrank(alice);
        market.commitTrade(h);
        // No vm.roll: reveal in the same block must be barred.
        vm.expectRevert(SeerMarket.RevealTooEarly.selector);
        market.revealBuy(SeerMarket.Side.Yes, LARGE_BET, type(uint256).max, SALT);
        vm.stopPrank();
    }

    function test_reveal_paramMismatchReverts() public {
        bytes32 h = market.commitmentHash(true, SeerMarket.Side.Yes, LARGE_BET, type(uint256).max, SALT);
        vm.prank(alice);
        market.commitTrade(h);

        vm.roll(block.number + 1);

        // Different size than committed → hash mismatch.
        vm.prank(alice);
        vm.expectRevert(SeerMarket.CommitmentMismatch.selector);
        market.revealBuy(SeerMarket.Side.Yes, LARGE_BET + 1, type(uint256).max, SALT);
    }

    // ─── Done-when: the sandwich fails ─────────────────────────────────────────

    // An atomic sandwich requires three legs in ONE block: attacker front-run,
    // victim fill, attacker back-run. Modelled here with no vm.roll between the
    // calls. The victim's large buy reverts CommitRequired, so the middle leg
    // can never land — the attacker is left holding a front-run with nothing to
    // squeeze. The sandwich is structurally impossible.
    function test_sandwichAttempt_failsAtomically() public {
        // Attacker front-runs with a small (allowed) buy, nudging the price up.
        vm.prank(bob);
        market.buy(SeerMarket.Side.Yes, SMALL_BET, type(uint256).max);

        // Victim's large buy in the SAME block cannot execute.
        vm.prank(alice);
        vm.expectRevert(SeerMarket.CommitRequired.selector);
        market.buy(SeerMarket.Side.Yes, LARGE_BET, type(uint256).max);

        // The victim took no position, so there is nothing for a back-run to
        // capture: the attacker cannot profit from a trade that never happened.
        assertEq(market.yesOf(alice), 0);
    }

    // Even on the legitimate two-block path, slippage enforced at reveal means a
    // searcher who moves the price after the commit cannot force a bad fill: the
    // reveal simply reverts and the victim keeps their Points.
    function test_revealSlippage_protectsAgainstAdverseMove() public {
        // Victim pins maxCost to the price at commit time.
        uint256 maxCost = LsLmsr.costDelta(SEED, SEED, LARGE_BET, 0, ALPHA);
        bytes32 h = market.commitmentHash(true, SeerMarket.Side.Yes, LARGE_BET, maxCost, SALT);
        vm.prank(alice);
        market.commitTrade(h);

        // Attacker pushes the YES price up before the reveal lands (500 ether is
        // under the bar, so it is itself allowed atomically).
        vm.prank(bob);
        market.buy(SeerMarket.Side.Yes, 500 ether, type(uint256).max);

        vm.roll(block.number + 1);

        // Reveal now costs more than maxCost → reverts, victim not filled.
        vm.prank(alice);
        vm.expectRevert(SeerMarket.SlippageTooHigh.selector);
        market.revealBuy(SeerMarket.Side.Yes, LARGE_BET, maxCost, SALT);
        assertEq(market.yesOf(alice), 0);
        assertEq(points.balanceOf(alice), TRADER_BALANCE);
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    function _commitRevealBuy(address who, SeerMarket.Side side, uint256 shares, uint256 maxCost) internal {
        bytes32 h = market.commitmentHash(true, side, shares, maxCost, SALT);
        vm.prank(who);
        market.commitTrade(h);
        vm.roll(block.number + 1);
        vm.prank(who);
        market.revealBuy(side, shares, maxCost, SALT);
    }
}

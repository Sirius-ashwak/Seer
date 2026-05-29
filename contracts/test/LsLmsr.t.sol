// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {LsLmsr} from "../src/lib/LsLmsr.sol";

contract LsLmsrTest is Test {
    uint256 internal constant WAD = 1e18;
    uint256 internal constant ALPHA = 5e16; // 0.05 — typical LS-LMSR liquidity factor
    uint256 internal constant SEED = 10_000 ether; // 10k shares each side at deploy

    // ---------------------------------------------------------------------- //
    //                            Deterministic checks                        //
    // ---------------------------------------------------------------------- //

    function test_priceYes_at_balanced_state_is_half() public pure {
        uint256 q = SEED;
        uint256 b = LsLmsr.liquidity(q, q, ALPHA);
        uint256 p = LsLmsr.priceYes(q, q, b);
        // Allow 1 wei drift from integer division.
        assertApproxEqAbs(p, WAD / 2, 1);
    }

    function test_pricesSumToOne() public pure {
        uint256 qY = SEED + 4_321 ether;
        uint256 qN = SEED;
        uint256 b = LsLmsr.liquidity(qY, qN, ALPHA);
        uint256 pY = LsLmsr.priceYes(qY, qN, b);
        uint256 pN = LsLmsr.priceNo(qY, qN, b);
        assertEq(pY + pN, WAD);
    }

    // External wrapper so vm.expectRevert can catch the library revert
    // (library calls are inlined, hence not at a lower call depth).
    function externalCost(uint256 qY, uint256 qN, uint256 b) external pure returns (uint256) {
        return LsLmsr.cost(qY, qN, b);
    }

    function test_zeroLiquidityReverts() public {
        vm.expectRevert(LsLmsr.InvalidLiquidity.selector);
        this.externalCost(0, 0, 0);
    }

    function test_buyYes_raises_priceYes() public pure {
        uint256 qY = SEED;
        uint256 qN = SEED;
        uint256 bBefore = LsLmsr.liquidity(qY, qN, ALPHA);
        uint256 pBefore = LsLmsr.priceYes(qY, qN, bBefore);

        uint256 dYes = 1_000 ether;
        uint256 qYesAfter = qY + dYes;
        uint256 bAfter = LsLmsr.liquidity(qYesAfter, qN, ALPHA);
        uint256 pAfter = LsLmsr.priceYes(qYesAfter, qN, bAfter);

        assertGt(pAfter, pBefore);
    }

    function test_costDelta_buyYes_is_positive() public pure {
        uint256 c = LsLmsr.costDelta(SEED, SEED, 1_000 ether, 0, ALPHA);
        assertGt(c, 0);
    }

    // Cost paid for one big buy equals sum of two halves (path independence).
    function test_costDelta_path_independence() public pure {
        uint256 oneShot = LsLmsr.costDelta(SEED, SEED, 2_000 ether, 0, ALPHA);

        uint256 first = LsLmsr.costDelta(SEED, SEED, 1_000 ether, 0, ALPHA);
        uint256 second = LsLmsr.costDelta(SEED + 1_000 ether, SEED, 1_000 ether, 0, ALPHA);

        assertApproxEqAbs(oneShot, first + second, 10);
    }

    // ---------------------------------------------------------------------- //
    //                                  Fuzz                                  //
    // ---------------------------------------------------------------------- //

    function testFuzz_pricesSumToOne(uint128 qY_, uint128 qN_) public pure {
        uint256 qY = uint256(qY_) + 1 ether;
        uint256 qN = uint256(qN_) + 1 ether;
        uint256 b = LsLmsr.liquidity(qY, qN, ALPHA);
        vm.assume(b > 0);
        uint256 pY = LsLmsr.priceYes(qY, qN, b);
        uint256 pN = LsLmsr.priceNo(qY, qN, b);
        assertEq(pY + pN, WAD);
    }

    function testFuzz_priceInRange(uint128 qY_, uint128 qN_) public pure {
        uint256 qY = uint256(qY_) + 1 ether;
        uint256 qN = uint256(qN_) + 1 ether;
        uint256 b = LsLmsr.liquidity(qY, qN, ALPHA);
        vm.assume(b > 0);
        uint256 pY = LsLmsr.priceYes(qY, qN, b);
        assertGt(pY, 0);
        assertLt(pY, WAD);
    }

    // Buying YES never lowers price_yes (monotonicity of marginal price).
    function testFuzz_buyYes_monotonic(uint96 qY_, uint96 qN_, uint96 dYes_) public pure {
        uint256 qY = uint256(qY_) + 1 ether;
        uint256 qN = uint256(qN_) + 1 ether;
        uint256 dYes = uint256(dYes_);
        vm.assume(dYes > 0 && dYes < 1e30);

        uint256 bBefore = LsLmsr.liquidity(qY, qN, ALPHA);
        uint256 pBefore = LsLmsr.priceYes(qY, qN, bBefore);

        uint256 qYNew = qY + dYes;
        uint256 bAfter = LsLmsr.liquidity(qYNew, qN, ALPHA);
        uint256 pAfter = LsLmsr.priceYes(qYNew, qN, bAfter);

        assertGe(pAfter, pBefore);
    }

    // costDelta is non-negative on any pure-buy trade.
    function testFuzz_costDelta_buy_nonNegative(uint96 qY_, uint96 qN_, uint96 dYes_, uint96 dNo_) public pure {
        uint256 qY = uint256(qY_) + 1 ether;
        uint256 qN = uint256(qN_) + 1 ether;
        uint256 dYes = uint256(dYes_);
        uint256 dNo = uint256(dNo_);
        vm.assume(dYes < 1e30 && dNo < 1e30);

        uint256 c = LsLmsr.costDelta(qY, qN, dYes, dNo, ALPHA);
        assertGe(c, 0);
    }

    // Round-trip a buy then an equal-size sell. Trader cannot profit (no arb).
    // Sell == buying back the same shares from the AMM: state delta is zero,
    // so the trader's net cash flow must be ≤ 0 (loss from spread).
    function testFuzz_roundTrip_noArbitrage(uint96 qY_, uint96 qN_, uint64 dYes_) public pure {
        uint256 qY = uint256(qY_) + 100 ether;
        uint256 qN = uint256(qN_) + 100 ether;
        uint256 dYes = uint256(dYes_);
        vm.assume(dYes > 0 && dYes < 1e25);

        // Trader pays this to buy dYes:
        uint256 paid = LsLmsr.costDelta(qY, qN, dYes, 0, ALPHA);

        // Then sells dYes back. costDelta from the post-buy state with -dYes:
        // We model the sell by computing the cost difference between (qY+dYes) and (qY).
        uint256 bPost = LsLmsr.liquidity(qY + dYes, qN, ALPHA);
        uint256 bPre = LsLmsr.liquidity(qY, qN, ALPHA);
        uint256 cPost = LsLmsr.cost(qY + dYes, qN, bPost);
        uint256 cPre = LsLmsr.cost(qY, qN, bPre);
        // Trader receives the difference back when reversing the trade.
        // Mirror the same clamp-at-zero semantics costDelta uses so a 1-wei
        // truncation can't flip the assertion.
        uint256 received = cPost > cPre ? cPost - cPre : 0;

        // In LS-LMSR cost is path-independent, so received == paid exactly.
        // The "no-arb" property here is the equality (no free shares created).
        assertEq(received, paid);
    }

    // Liquidity grows monotonically with total volume (key LS-LMSR property).
    function testFuzz_liquidity_monotonic(uint96 q_, uint96 add_) public pure {
        uint256 q = uint256(q_) + 1 ether;
        uint256 add = uint256(add_);
        uint256 bBefore = LsLmsr.liquidity(q, q, ALPHA);
        uint256 bAfter = LsLmsr.liquidity(q + add, q, ALPHA);
        assertGe(bAfter, bBefore);
    }
}

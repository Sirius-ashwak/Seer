// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

import {LsLmsr} from "../src/lib/LsLmsr.sol";
import {SeerMarket} from "../src/SeerMarket.sol";
import {SeerPoints} from "../src/SeerPoints.sol";

// Drives random buy/sell sequences against one market on behalf of a fixed set
// of actors. The MEV guard is disabled (largeBetBps = 0) so trades execute
// atomically; sizes are bounded so they never trip slippage with the open
// limits used here.
contract MarketHandler is Test {
    SeerMarket public immutable market;
    SeerPoints public immutable points;
    address[3] internal actors;

    constructor(SeerMarket market_, SeerPoints points_, address[3] memory actors_) {
        market = market_;
        points = points_;
        actors = actors_;
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function buy(uint256 actorSeed, bool yes, uint256 shares) external {
        shares = bound(shares, 1, 50 ether);
        vm.prank(_actor(actorSeed));
        try market.buy(yes ? SeerMarket.Side.Yes : SeerMarket.Side.No, shares, type(uint256).max) {} catch {}
    }

    function sell(uint256 actorSeed, bool yes, uint256 shares) external {
        address a = _actor(actorSeed);
        uint256 bal = yes ? market.yesOf(a) : market.noOf(a);
        if (bal == 0) return;
        shares = bound(shares, 1, bal);
        vm.prank(a);
        try market.sell(yes ? SeerMarket.Side.Yes : SeerMarket.Side.No, shares, 0) {} catch {}
    }
}

// Task V: invariants for the LS-LMSR market. None of these may break under any
// sequence the handler explores.
contract SeerMarketInvariantTest is Test {
    uint256 internal constant WAD = 1e18;
    uint256 internal constant ALPHA = 5e16; // 0.05
    uint256 internal constant SEED = 1_000 ether;
    uint256 internal constant TRADER_BALANCE = 1_000_000 ether;
    uint256 internal constant SUBSIDY = 200_000 ether;

    SeerPoints internal points;
    SeerMarket internal market;
    MarketHandler internal handler;

    address internal owner = address(0xA11CE);
    address internal resolver = address(0xDEAD);
    address[3] internal actors = [address(0xA1), address(0xB0B), address(0xCAA)];

    function setUp() public {
        points = new SeerPoints(owner);
        market = new SeerMarket(
            address(points),
            resolver,
            "Invariant market",
            block.timestamp + 3650 days, // far deadline: trading stays open
            ALPHA,
            SEED,
            SEED,
            0 // MEV guard off for the handler
        );

        vm.startPrank(owner);
        points.setOperator(address(market), true);
        points.mint(address(market), SUBSIDY);
        for (uint256 i = 0; i < actors.length; ++i) {
            points.mint(actors[i], TRADER_BALANCE);
        }
        vm.stopPrank();

        handler = new MarketHandler(market, points, actors);
        targetContract(address(handler));
    }

    // YES and NO prices always partition a probability: each in [0, WAD] and
    // together they sum to one WAD (modulo fixed-point rounding).
    function invariant_pricesSumToWad() public view {
        uint256 pY = market.priceYes();
        uint256 pN = market.priceNo();
        assertLe(pY, WAD);
        assertLe(pN, WAD);
        assertApproxEqAbs(pY + pN, WAD, 2);
    }

    // Internal share accounting reconciles with the curve: the shares minted to
    // traders equal how far each leg has moved from its seed.
    function invariant_shareConservation() public view {
        uint256 totalYes;
        uint256 totalNo;
        for (uint256 i = 0; i < actors.length; ++i) {
            totalYes += market.yesOf(actors[i]);
            totalNo += market.noOf(actors[i]);
        }
        assertEq(totalYes, market.qYes() - SEED);
        assertEq(totalNo, market.qNo() - SEED);
    }

    // The market always holds enough Points to pay whichever side wins (each
    // winning share redeems for 1 Point) and to refund net collateral on an
    // Invalid resolution.
    function invariant_solvent() public view {
        uint256 owedYes = market.qYes() - SEED;
        uint256 owedNo = market.qNo() - SEED;
        uint256 worst = owedYes > owedNo ? owedYes : owedNo;

        uint256 totalCollateral;
        for (uint256 i = 0; i < actors.length; ++i) {
            totalCollateral += market.collateralOf(actors[i]);
        }

        uint256 bal = points.balanceOf(address(market));
        assertGe(bal, worst);
        assertGe(bal, totalCollateral);
    }
}

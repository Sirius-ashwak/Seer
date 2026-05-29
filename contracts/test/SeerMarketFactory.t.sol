// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

import {LsLmsr} from "../src/lib/LsLmsr.sol";
import {SeerMarket} from "../src/SeerMarket.sol";
import {SeerMarketFactory} from "../src/SeerMarketFactory.sol";
import {SeerPoints} from "../src/SeerPoints.sol";

contract SeerMarketFactoryTest is Test {
    uint256 internal constant WAD = 1e18;
    uint256 internal constant ALPHA = 5e16; // 0.05
    uint256 internal constant MIN_ALPHA = 1e15; // 0.001
    uint256 internal constant MAX_ALPHA = 5e17; // 0.5
    uint256 internal constant SEED = 1_000 ether;
    uint256 internal constant SUBSIDY_CAP = 100_000 ether;

    SeerPoints internal points;
    SeerMarketFactory internal factory;

    address internal deployer = address(this);
    address internal admin = address(0xAD);
    address internal resolver = address(0xDEAD);
    address internal alice = address(0xA1);

    function setUp() public {
        points = new SeerPoints(deployer);
        factory = new SeerMarketFactory(address(points), admin, SUBSIDY_CAP, MIN_ALPHA, MAX_ALPHA);
        // Two-step ownership: hand SeerPoints over to the factory.
        points.transferOwnership(address(factory));
        factory.acceptPointsOwnership();
        assertEq(points.owner(), address(factory));
    }

    function _create(uint256 deadline) internal returns (address market, uint256 subsidy) {
        return factory.createMarket("Will it rain tomorrow?", deadline, ALPHA, SEED, SEED, resolver);
    }

    // ─── Happy path ──────────────────────────────────────────────────────────

    function test_createMarket_seedsTradeable() public {
        (address marketAddr, uint256 subsidy) = _create(block.timestamp + 1 days);

        // Subsidy equals the LMSR opening book value.
        uint256 b = LsLmsr.liquidity(SEED, SEED, ALPHA);
        uint256 expected = LsLmsr.cost(SEED, SEED, b);
        assertEq(subsidy, expected);

        // Factory minted the subsidy into the market and registered it.
        assertEq(points.balanceOf(marketAddr), subsidy);
        assertTrue(points.isOperator(marketAddr));
        assertTrue(factory.isMarket(marketAddr));
        assertEq(factory.marketCount(), 1);
        assertEq(factory.marketAt(0), marketAddr);

        // A zero-bettor market is tradeable: prices return cleanly.
        SeerMarket market = SeerMarket(marketAddr);
        assertEq(market.priceYes() + market.priceNo(), WAD);
    }

    function test_createMarket_secondCreateAppends() public {
        _create(block.timestamp + 1 days);
        _create(block.timestamp + 2 days);
        assertEq(factory.marketCount(), 2);
    }

    function test_createMarket_aliceCanTrade() public {
        (address marketAddr,) = _create(block.timestamp + 1 days);
        SeerMarket market = SeerMarket(marketAddr);

        // Need to mint Alice some Points to trade. Factory holds the owner
        // role now, so a non-owner can't mint — call mint as the factory.
        vm.prank(address(factory));
        points.mint(alice, 5_000 ether);

        vm.prank(alice);
        uint256 cost = market.buy(SeerMarket.Side.Yes, 100 ether, type(uint256).max);
        assertGt(cost, 0);
        assertEq(market.yesOf(alice), 100 ether);
    }

    // ─── Validation ──────────────────────────────────────────────────────────

    function test_createMarket_revertsOnPastDeadline() public {
        vm.expectRevert(SeerMarketFactory.DeadlineInPast.selector);
        factory.createMarket("q", block.timestamp, ALPHA, SEED, SEED, resolver);
    }

    function test_createMarket_revertsOnZeroResolver() public {
        vm.expectRevert(SeerMarketFactory.ZeroAddress.selector);
        factory.createMarket("q", block.timestamp + 1 days, ALPHA, SEED, SEED, address(0));
    }

    function test_createMarket_revertsOnEmptySeed() public {
        vm.expectRevert(SeerMarketFactory.EmptySeed.selector);
        factory.createMarket("q", block.timestamp + 1 days, ALPHA, 0, SEED, resolver);
    }

    function test_createMarket_revertsOnAlphaOutOfBounds() public {
        vm.expectRevert(SeerMarketFactory.InvalidAlpha.selector);
        factory.createMarket("q", block.timestamp + 1 days, MIN_ALPHA - 1, SEED, SEED, resolver);

        vm.expectRevert(SeerMarketFactory.InvalidAlpha.selector);
        factory.createMarket("q", block.timestamp + 1 days, MAX_ALPHA + 1, SEED, SEED, resolver);
    }

    function test_createMarket_revertsOnSubsidyExceedingCap() public {
        // Use a giant seed that pushes computed subsidy above the cap.
        uint256 hugeSeed = 1_000_000_000 ether;
        vm.expectRevert(SeerMarketFactory.SubsidyExceedsCap.selector);
        factory.createMarket("q", block.timestamp + 1 days, ALPHA, hugeSeed, hugeSeed, resolver);
    }

    // ─── Admin ───────────────────────────────────────────────────────────────

    function test_setAdmin_onlyAdmin() public {
        vm.expectRevert(SeerMarketFactory.AdminOnly.selector);
        factory.setAdmin(alice);
    }

    function test_setAdmin_changesAdmin() public {
        vm.prank(admin);
        factory.setAdmin(alice);
        assertEq(factory.admin(), alice);
    }

    function test_setSubsidyCap_movesCap() public {
        vm.prank(admin);
        factory.setSubsidyCap(123 ether);
        assertEq(factory.subsidyCap(), 123 ether);
    }

    function test_setAlphaBounds_validates() public {
        vm.prank(admin);
        vm.expectRevert(SeerMarketFactory.InvalidAlpha.selector);
        factory.setAlphaBounds(0, 1);

        vm.prank(admin);
        vm.expectRevert(SeerMarketFactory.InvalidAlpha.selector);
        factory.setAlphaBounds(2, 1);

        vm.prank(admin);
        factory.setAlphaBounds(MIN_ALPHA, MAX_ALPHA);
        assertEq(factory.minAlphaWad(), MIN_ALPHA);
        assertEq(factory.maxAlphaWad(), MAX_ALPHA);
    }
}

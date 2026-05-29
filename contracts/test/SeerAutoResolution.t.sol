// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

import {IAgentRequester} from "../src/interfaces/IAgentRequester.sol";
import {LsLmsr} from "../src/lib/LsLmsr.sol";
import {SeerMarket} from "../src/SeerMarket.sol";
import {SeerMarketFactory} from "../src/SeerMarketFactory.sol";
import {SeerPoints} from "../src/SeerPoints.sol";
import {SeerResolver} from "../src/SeerResolver.sol";
import {SeerSettlement} from "../src/SeerSettlement.sol";
import {MockAgentRequester} from "./mocks/MockAgentRequester.sol";

// Tasks Q + R: reactive deployment and autonomous resolution.
//
// Q — SeerMarketFactory.onMarketProposed: a reactor (in production, a Somnia
//     ContractEvent subscription) deploys + seeds a market and wires it for
//     self-resolution in a single call.
// R — SeerMarket.triggerResolution: once the deadline passes, a permissionless
//     crank (in production, a Schedule subscription) makes the market its own
//     bonded proposer against the oracle — no off-chain call starts resolution.
//
// The end-to-end test exercises the whole autonomous loop: propose → trade →
// trigger → agent callbacks → finalize → settle → claim.
contract SeerAutoResolutionTest is Test {
    MockAgentRequester internal mockRequester;
    SeerPoints internal points;
    SeerResolver internal resolver;
    SeerSettlement internal settlement;
    SeerMarketFactory internal factory;

    address internal admin = address(0xAD);
    address internal reactor = address(0xBEEF);
    address internal cranker = address(0xC1); // fires triggerResolution
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

    // Market / factory config.
    uint256 internal constant ALPHA = 0.1 ether;
    uint256 internal constant MIN_ALPHA = 0.01 ether;
    uint256 internal constant MAX_ALPHA = 1 ether;
    uint256 internal constant SEED = 100 ether;
    uint256 internal constant SUBSIDY_CAP = 10_000 ether;
    uint256 internal constant TRADE_SHARES = 10 ether;
    uint256 internal constant FUNDING = 1_000 ether;

    uint256 internal subsidy; // LMSR opening cost the factory seeds each market
    bytes internal constant PROMPT = bytes("did it happen?");

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
        factory = new SeerMarketFactory(address(points), admin, SUBSIDY_CAP, MIN_ALPHA, MAX_ALPHA);

        // Resolver escrows bonds; wire it as an operator while we still own Points.
        points.setOperator(address(resolver), true);

        // Fund traders before handing Points ownership to the factory.
        points.mint(yesBuyer, FUNDING);
        points.mint(noBuyer, FUNDING);

        points.transferOwnership(address(factory));
        factory.acceptPointsOwnership();

        vm.prank(admin);
        factory.setReactor(reactor);

        vm.deal(cranker, 100 ether);

        subsidy = LsLmsr.cost(SEED, SEED, LsLmsr.liquidity(SEED, SEED, ALPHA));
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    function _proposal(uint256 deadline, address oracle)
        internal
        view
        returns (SeerMarketFactory.MarketProposal memory p)
    {
        bytes[3] memory sources;
        sources[0] = hex"01";
        sources[1] = hex"02";
        sources[2] = hex"03";

        p = SeerMarketFactory.MarketProposal({
            proposalId: 0,
            question: "Will it rain in NYC on 2026-06-01?",
            deadline: deadline,
            alphaWad: ALPHA,
            seedYes: SEED,
            seedNo: SEED,
            resolver: address(settlement),
            oracle: oracle,
            sources: sources,
            inferencePrompt: PROMPT
        });
    }

    function _propose(uint256 deadline, address oracle) internal returns (SeerMarket market) {
        vm.prank(reactor);
        (address m,) = factory.onMarketProposed(_proposal(deadline, oracle));
        market = SeerMarket(m);
    }

    // Deliver the 3 source callbacks then the LLM verdict for `market`.
    function _deliverVerdict(SeerMarket market, uint256[3] memory ids, uint8 verdict) internal {
        for (uint8 i = 0; i < 3; ++i) {
            bytes[] memory wrap = new bytes[](1);
            wrap[0] = abi.encode(uint256(i));
            mockRequester.simulateCallback(ids[i], wrap, IAgentRequester.ResponseStatus.Succeeded);
        }
        uint256 llmId = resolver.llmRequestIdOf(address(market));
        bytes[] memory v = new bytes[](1);
        v[0] = abi.encode(verdict);
        mockRequester.simulateCallback(llmId, v, IAgentRequester.ResponseStatus.Succeeded);
    }

    // ─── Task Q: reactive deployment ───────────────────────────────────────────

    function test_onMarketProposed_onlyReactor() public {
        vm.expectRevert(SeerMarketFactory.NotReactor.selector);
        factory.onMarketProposed(_proposal(block.timestamp + 1 days, address(resolver)));
    }

    function test_onMarketProposed_deploysAndSeedsAndPreFundsBond() public {
        SeerMarket market = _propose(block.timestamp + 1 days, address(resolver));

        assertTrue(factory.isMarket(address(market)));
        assertEq(uint8(market.outcome()), uint8(SeerMarket.Outcome.Pending));
        // Subsidy plus the pre-funded oracle bond.
        assertEq(points.balanceOf(address(market)), subsidy + BOND);
        assertTrue(points.isOperator(address(market)));
    }

    function test_onMarketProposed_configuresAutoResolution() public {
        SeerMarket market = _propose(block.timestamp + 1 days, address(resolver));

        assertTrue(market.autoConfigured());
        assertEq(market.oracle(), address(resolver));
        assertEq(market.resolver(), address(settlement));
        assertEq(market.autoPrompt(), PROMPT);
        assertEq(market.autoSourceAt(0), hex"01");
        assertEq(market.autoSourceAt(1), hex"02");
        assertEq(market.autoSourceAt(2), hex"03");
        assertFalse(market.resolutionTriggered());
    }

    function test_onMarketProposed_zeroOracle_skipsAutoConfig() public {
        SeerMarket market = _propose(block.timestamp + 1 days, address(0));

        assertFalse(market.autoConfigured());
        assertEq(market.oracle(), address(0));
        // No bond minted when auto-resolution is not wired.
        assertEq(points.balanceOf(address(market)), subsidy);
    }

    // ─── Task R: autonomous trigger ─────────────────────────────────────────────

    function test_configureAutoResolution_onlyFactory() public {
        SeerMarket market = _propose(block.timestamp + 1 days, address(resolver));

        bytes[3] memory sources;
        vm.expectRevert(SeerMarket.NotFactory.selector);
        market.configureAutoResolution(address(resolver), sources, PROMPT);
    }

    function test_configureAutoResolution_alreadyConfiguredReverts() public {
        SeerMarket market = _propose(block.timestamp + 1 days, address(resolver));

        bytes[3] memory sources;
        vm.prank(address(factory));
        vm.expectRevert(SeerMarket.AlreadyConfigured.selector);
        market.configureAutoResolution(address(resolver), sources, PROMPT);
    }

    function test_triggerResolution_revertsBeforeDeadline() public {
        SeerMarket market = _propose(block.timestamp + 1 days, address(resolver));

        vm.prank(cranker);
        vm.expectRevert(SeerMarket.NotYetDue.selector);
        market.triggerResolution{value: TOTAL_DEPOSIT}();
    }

    function test_triggerResolution_revertsIfNotConfigured() public {
        // A market deployed without an oracle is never armed.
        SeerMarket market = _propose(block.timestamp + 1 days, address(0));
        vm.warp(market.deadline());

        vm.prank(cranker);
        vm.expectRevert(SeerMarket.NotConfigured.selector);
        market.triggerResolution{value: TOTAL_DEPOSIT}();
    }

    function test_triggerResolution_firesBondedResolution() public {
        SeerMarket market = _propose(block.timestamp + 1 days, address(resolver));
        vm.warp(market.deadline());

        vm.prank(cranker);
        uint256[3] memory ids = market.triggerResolution{value: TOTAL_DEPOSIT}();

        // The market is now its own proposer in the oracle.
        assertEq(uint8(resolver.phaseOf(address(market))), uint8(SeerResolver.Phase.AwaitingSources));
        assertEq(resolver.proposerOf(address(market)), address(market));
        assertEq(resolver.bondOf(address(market)), BOND);
        assertTrue(market.resolutionTriggered());

        // Bond moved from the market to the resolver escrow.
        assertEq(points.balanceOf(address(market)), subsidy);
        assertEq(points.balanceOf(address(resolver)), BOND);

        assertTrue(ids[0] != 0 && ids[1] != 0 && ids[2] != 0);
    }

    function test_triggerResolution_doubleFireReverts() public {
        SeerMarket market = _propose(block.timestamp + 1 days, address(resolver));
        vm.warp(market.deadline());

        vm.prank(cranker);
        market.triggerResolution{value: TOTAL_DEPOSIT}();

        vm.prank(cranker);
        vm.expectRevert(SeerMarket.AlreadyTriggered.selector);
        market.triggerResolution{value: TOTAL_DEPOSIT}();
    }

    // ─── End-to-end autonomous lifecycle ────────────────────────────────────────

    function test_endToEnd_autonomousResolution_yesWins() public {
        SeerMarket market = _propose(block.timestamp + 1 days, address(resolver));

        // Trade before the deadline.
        vm.prank(yesBuyer);
        market.buy(SeerMarket.Side.Yes, TRADE_SHARES, type(uint256).max);
        vm.prank(noBuyer);
        market.buy(SeerMarket.Side.No, TRADE_SHARES, type(uint256).max);

        // Deadline reached → autonomous trigger (no manual requestResolution).
        vm.warp(market.deadline());
        vm.prank(cranker);
        uint256[3] memory ids = market.triggerResolution{value: TOTAL_DEPOSIT}();

        // Oracle resolves YES, undisputed.
        _deliverVerdict(market, ids, 1);
        vm.warp(resolver.challengeDeadlineOf(address(market)));
        resolver.finalize(address(market));

        // Bond returned to the market (its own proposer).
        assertTrue(resolver.isFinalized(address(market)));
        assertEq(points.balanceOf(address(resolver)), 0);

        // Settlement cranks the verdict into the market, then winners claim.
        settlement.settle(address(market));
        assertEq(uint8(market.outcome()), uint8(SeerMarket.Outcome.Yes));

        vm.prank(yesBuyer);
        assertEq(market.claim(), TRADE_SHARES);

        vm.prank(noBuyer);
        vm.expectRevert(SeerMarket.NothingToClaim.selector);
        market.claim();
    }
}

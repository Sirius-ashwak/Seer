// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

import {IAgentRequester} from "../src/interfaces/IAgentRequester.sol";
import {SeerMarket} from "../src/SeerMarket.sol";
import {SeerMarketFactory} from "../src/SeerMarketFactory.sol";
import {SeerPoints} from "../src/SeerPoints.sol";
import {SeerResolver} from "../src/SeerResolver.sol";
import {SeerSettlement} from "../src/SeerSettlement.sol";
import {SeerSignalAgent} from "../src/SeerSignalAgent.sol";
import {MockAgentRequester} from "./mocks/MockAgentRequester.sol";

// Tasks O + P: signal-agent discovery and the creation bond.
//
// O — SeerSignalAgent.propose scores marketability via LLM Inference and emits
//     MarketProposed once a candidate clears the threshold.
// P — the creation bond is slashed to the treasury if the spawned market
//     resolves INVALID, and refunded otherwise.
contract SeerSignalAgentTest is Test {
    MockAgentRequester internal mockRequester;
    SeerPoints internal points;
    SeerResolver internal resolver;
    SeerSettlement internal settlement;
    SeerMarketFactory internal factory;
    SeerSignalAgent internal signal;

    address internal admin = address(0xAD);
    address internal treasury = address(0x7);
    address internal reactor = address(0xBEEF);
    address internal cranker = address(0xC1);
    address internal proposer = address(0xB1);

    // Resolver config.
    uint256 internal constant JSON_AGENT_ID = 42;
    uint256 internal constant LLM_AGENT_ID = 99;
    uint256 internal constant SOURCE_DEPOSIT = 0.05 ether;
    uint256 internal constant LLM_DEPOSIT = 0.05 ether;
    uint256 internal constant TOTAL_DEPOSIT = 3 * SOURCE_DEPOSIT + LLM_DEPOSIT;
    uint256 internal constant BOND = 10 ether;
    uint256 internal constant CHALLENGE_WINDOW = 30 minutes;

    // Factory / market config.
    uint256 internal constant ALPHA = 0.1 ether;
    uint256 internal constant MIN_ALPHA = 0.01 ether;
    uint256 internal constant MAX_ALPHA = 1 ether;
    uint256 internal constant SEED = 100 ether;
    uint256 internal constant SUBSIDY_CAP = 10_000 ether;

    // Signal-agent config.
    uint256 internal constant MARKETABILITY_AGENT_ID = 7;
    uint256 internal constant SCORE_DEPOSIT = 0.02 ether;
    uint256 internal constant CREATION_BOND = 5 ether;
    uint256 internal constant SCORE_THRESHOLD = 6_000;

    uint256 internal constant FUNDING = 1_000 ether;
    bytes internal constant PROMPT = bytes("did it happen?");
    bytes internal constant SCORING_PAYLOAD = bytes("score this market");

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
        signal = new SeerSignalAgent(
            address(mockRequester),
            address(points),
            address(factory),
            admin,
            treasury,
            MARKETABILITY_AGENT_ID,
            SCORE_DEPOSIT,
            CREATION_BOND,
            SCORE_THRESHOLD
        );

        // Operators (resolver escrows resolution bonds; signal escrows creation
        // bonds) must be registered while we still own Points.
        points.setOperator(address(resolver), true);
        points.setOperator(address(signal), true);

        points.mint(proposer, FUNDING);

        points.transferOwnership(address(factory));
        factory.acceptPointsOwnership();

        vm.prank(admin);
        factory.setReactor(reactor);

        vm.deal(proposer, 100 ether);
        vm.deal(cranker, 100 ether);
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    function _params(uint256 deadline) internal view returns (SeerMarketFactory.MarketProposal memory p) {
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
            oracle: address(resolver),
            sources: sources,
            inferencePrompt: PROMPT
        });
    }

    function _propose(uint256 deadline) internal returns (uint256 proposalId) {
        vm.prank(proposer);
        proposalId = signal.propose{value: SCORE_DEPOSIT}(_params(deadline), SCORING_PAYLOAD);
    }

    function _score(uint256 proposalId, uint256 score) internal {
        uint256 reqId = signal.scoreRequestIdOf(proposalId);
        bytes[] memory wrap = new bytes[](1);
        wrap[0] = abi.encode(score);
        mockRequester.simulateCallback(reqId, wrap, IAgentRequester.ResponseStatus.Succeeded);
    }

    // Deploy the approved proposal's market and drive it to `verdict`
    // (0=Invalid, 1=Yes, 2=No) through the oracle + settlement.
    function _deployAndResolve(uint256 proposalId, uint8 verdict) internal returns (SeerMarket market) {
        // Read the proposal first: a vm.prank only spoofs the *next* call, and
        // signal.proposalOf() is itself an external call that would consume it.
        SeerMarketFactory.MarketProposal memory p = signal.proposalOf(proposalId);
        vm.prank(reactor);
        (address m,) = factory.onMarketProposed(p);
        market = SeerMarket(m);

        vm.warp(market.deadline());
        vm.prank(cranker);
        uint256[3] memory ids = market.triggerResolution{value: TOTAL_DEPOSIT}();

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
        settlement.settle(address(market));
    }

    // ─── Task O: propose + score ─────────────────────────────────────────────

    function test_propose_escrowsBondAndFiresScoreRequest() public {
        uint256 id = _propose(block.timestamp + 1 days);

        assertEq(id, 1);
        assertEq(uint8(signal.stateOf(id)), uint8(SeerSignalAgent.State.Pending));
        assertEq(signal.bondOf(id), CREATION_BOND);
        assertEq(signal.proposerOf(id), proposer);
        assertTrue(signal.scoreRequestIdOf(id) != 0);
        assertEq(points.balanceOf(address(signal)), CREATION_BOND);
        assertEq(points.balanceOf(proposer), FUNDING - CREATION_BOND);
    }

    function test_propose_wrongDepositReverts() public {
        vm.prank(proposer);
        vm.expectRevert(abi.encodeWithSelector(SeerSignalAgent.WrongDeposit.selector, 0, SCORE_DEPOSIT));
        signal.propose{value: 0}(_params(block.timestamp + 1 days), SCORING_PAYLOAD);
    }

    function test_handleScoreResponse_onlyRequester() public {
        IAgentRequester.Response[] memory empty = new IAgentRequester.Response[](0);
        IAgentRequester.Request memory details;
        vm.expectRevert(SeerSignalAgent.NotRequester.selector);
        signal.handleScoreResponse(1, empty, IAgentRequester.ResponseStatus.Succeeded, details);
    }

    function test_handleScoreResponse_unknownRequestReverts() public {
        IAgentRequester.Response[] memory empty = new IAgentRequester.Response[](0);
        IAgentRequester.Request memory details;
        vm.prank(address(mockRequester));
        vm.expectRevert(SeerSignalAgent.UnknownRequest.selector);
        signal.handleScoreResponse(999, empty, IAgentRequester.ResponseStatus.Succeeded, details);
    }

    function test_score_aboveThreshold_approves() public {
        uint256 id = _propose(block.timestamp + 1 days);
        _score(id, 8_000);

        assertEq(uint8(signal.stateOf(id)), uint8(SeerSignalAgent.State.Approved));
        assertEq(signal.scoreOf(id), 8_000);
        // Bond stays escrowed until the spawned market resolves.
        assertEq(points.balanceOf(address(signal)), CREATION_BOND);
        // The stored proposal carries its canonical id for the reactor.
        assertEq(signal.proposalOf(id).proposalId, id);
    }

    function test_score_belowThreshold_rejectsAndRefunds() public {
        uint256 id = _propose(block.timestamp + 1 days);
        _score(id, 3_000);

        assertEq(uint8(signal.stateOf(id)), uint8(SeerSignalAgent.State.Rejected));
        assertEq(points.balanceOf(address(signal)), 0);
        assertEq(points.balanceOf(proposer), FUNDING); // bond returned in full
    }

    function test_score_failedStatus_rejectsAndRefunds() public {
        uint256 id = _propose(block.timestamp + 1 days);
        uint256 reqId = signal.scoreRequestIdOf(id);
        bytes[] memory none = new bytes[](0);
        mockRequester.simulateCallback(reqId, none, IAgentRequester.ResponseStatus.Failed);

        assertEq(uint8(signal.stateOf(id)), uint8(SeerSignalAgent.State.Rejected));
        assertEq(points.balanceOf(proposer), FUNDING);
    }

    // ─── Task P: creation bond settlement ───────────────────────────────────────

    function test_settleProposal_invalid_slashesBondToTreasury() public {
        uint256 id = _propose(block.timestamp + 1 days);
        _score(id, 8_000);
        SeerMarket market = _deployAndResolve(id, 0); // INVALID
        assertEq(uint8(market.outcome()), uint8(SeerMarket.Outcome.Invalid));

        signal.settleProposal(id);

        assertEq(uint8(signal.stateOf(id)), uint8(SeerSignalAgent.State.Settled));
        assertEq(points.balanceOf(treasury), CREATION_BOND);
        assertEq(points.balanceOf(address(signal)), 0);
        // Proposer does not get the junk bond back.
        assertEq(points.balanceOf(proposer), FUNDING - CREATION_BOND);
    }

    function test_settleProposal_yes_refundsProposer() public {
        uint256 id = _propose(block.timestamp + 1 days);
        _score(id, 8_000);
        SeerMarket market = _deployAndResolve(id, 1); // YES
        assertEq(uint8(market.outcome()), uint8(SeerMarket.Outcome.Yes));

        signal.settleProposal(id);

        assertEq(uint8(signal.stateOf(id)), uint8(SeerSignalAgent.State.Settled));
        assertEq(points.balanceOf(treasury), 0);
        assertEq(points.balanceOf(proposer), FUNDING); // bond refunded
    }

    function test_settleProposal_notApprovedReverts() public {
        uint256 id = _propose(block.timestamp + 1 days); // still Pending
        vm.expectRevert(SeerSignalAgent.NotApproved.selector);
        signal.settleProposal(id);
    }

    function test_settleProposal_notDeployedReverts() public {
        uint256 id = _propose(block.timestamp + 1 days);
        _score(id, 8_000); // Approved but reactor never deployed the market
        vm.expectRevert(SeerSignalAgent.NotDeployed.selector);
        signal.settleProposal(id);
    }

    function test_settleProposal_notResolvedReverts() public {
        uint256 id = _propose(block.timestamp + 1 days);
        _score(id, 8_000);
        SeerMarketFactory.MarketProposal memory p = signal.proposalOf(id);
        vm.prank(reactor);
        factory.onMarketProposed(p); // deployed, not resolved

        vm.expectRevert(SeerSignalAgent.NotResolved.selector);
        signal.settleProposal(id);
    }
}

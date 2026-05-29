// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

import {IAgentRequester} from "../src/interfaces/IAgentRequester.sol";
import {SeerResolver} from "../src/SeerResolver.sol";
import {SeerPoints} from "../src/SeerPoints.sol";
import {MockAgentRequester} from "./mocks/MockAgentRequester.sol";

contract SeerResolverTest is Test {
    MockAgentRequester internal mockRequester;
    SeerPoints internal points;
    SeerResolver internal resolver;

    address internal admin = address(0xAD);
    address internal alice = address(0xA1);
    address internal bob = address(0xB0B);
    address internal market = address(0xBABE);

    uint256 internal constant JSON_AGENT_ID = 42;
    uint256 internal constant LLM_AGENT_ID = 99;
    uint256 internal constant SOURCE_DEPOSIT = 0.05 ether;
    uint256 internal constant LLM_DEPOSIT = 0.05 ether;
    uint256 internal constant TOTAL_DEPOSIT = 3 * SOURCE_DEPOSIT + LLM_DEPOSIT;
    uint256 internal constant BOND = 10 ether;
    uint256 internal constant CHALLENGE_WINDOW = 30 minutes;
    uint256 internal constant ALICE_POINTS = 1_000 ether;
    uint256 internal constant ESCALATION_DEPOSIT = 0.1 ether;

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
        points.setOperator(address(resolver), true);
        points.mint(alice, ALICE_POINTS);
        points.mint(bob, ALICE_POINTS);
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);

        // Dispute tests run with a non-zero escalation deposit so the
        // createAdvancedRequest native-value path gets exercised.
        vm.prank(admin);
        resolver.setEscalationDeposit(ESCALATION_DEPOSIT);
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    function _sources() internal pure returns (bytes[] memory s) {
        s = new bytes[](3);
        s[0] = abi.encode(
            "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd", "bitcoin.usd", uint8(8)
        );
        s[1] = abi.encode("https://api.coinbase.com/v2/prices/BTC-USD/spot", "data.amount", uint8(8));
        s[2] = abi.encode("https://api.kraken.com/0/public/Ticker?pair=XBTUSD", "result.XXBTZUSD.c[0]", uint8(8));
    }

    function _prompt() internal pure returns (bytes memory) {
        return bytes(
            "Did BTC close above $100,000 on 2024-12-31? "
            "Inspect the three independent price quotes provided and reply with "
            "abi-encoded uint8: 0=Invalid, 1=Yes, 2=No."
        );
    }

    function _kickoff() internal returns (uint256[3] memory ids) {
        vm.prank(alice);
        ids = resolver.requestResolution{value: TOTAL_DEPOSIT}(market, _sources(), _prompt());
    }

    function _deliverSources(uint256[3] memory ids, bytes[3] memory datas) internal {
        for (uint8 i = 0; i < 3; ++i) {
            bytes[] memory wrap = new bytes[](1);
            wrap[0] = datas[i];
            mockRequester.simulateCallback(ids[i], wrap, IAgentRequester.ResponseStatus.Succeeded);
        }
    }

    function _deliverInference(uint8 verdict, IAgentRequester.ResponseStatus status) internal {
        uint256 llmId = resolver.llmRequestIdOf(market);
        bytes[] memory wrap = new bytes[](1);
        wrap[0] = abi.encode(verdict);
        mockRequester.simulateCallback(llmId, wrap, status);
    }

    // Drive a market all the way to Phase.Challenge with the given verdict.
    function _toChallenge(uint8 verdict) internal {
        uint256[3] memory ids = _kickoff();
        bytes[3] memory datas = [bytes(hex"01"), bytes(hex"02"), bytes(hex"03")];
        _deliverSources(ids, datas);
        _deliverInference(verdict, IAgentRequester.ResponseStatus.Succeeded);
    }

    // Propose `proposedVerdict`, then `disputer` matches the bond + fronts the
    // escalation deposit, landing the market in Phase.Disputed.
    function _toDisputed(uint8 proposedVerdict, address disputer) internal {
        _toChallenge(proposedVerdict);
        vm.prank(disputer);
        resolver.dispute{value: ESCALATION_DEPOSIT}(market);
    }

    function _deliverEscalation(uint8 verdict, IAgentRequester.ResponseStatus status) internal {
        uint256 escId = resolver.escalationRequestIdOf(market);
        bytes[] memory wrap = new bytes[](1);
        wrap[0] = abi.encode(verdict);
        mockRequester.simulateCallback(escId, wrap, status);
    }

    // ─── Constructor & admin ─────────────────────────────────────────────────

    function test_constructor_setsFields() public view {
        assertEq(address(resolver.requester()), address(mockRequester));
        assertEq(address(resolver.points()), address(points));
        assertEq(resolver.admin(), admin);
        assertEq(resolver.jsonApiAgentId(), JSON_AGENT_ID);
        assertEq(resolver.llmAgentId(), LLM_AGENT_ID);
        assertEq(resolver.sourceCallDeposit(), SOURCE_DEPOSIT);
        assertEq(resolver.llmCallDeposit(), LLM_DEPOSIT);
        assertEq(resolver.bondAmount(), BOND);
        assertEq(resolver.challengeWindow(), CHALLENGE_WINDOW);
    }

    function test_constructor_rejectsZeroAddress() public {
        vm.expectRevert(SeerResolver.ZeroAddress.selector);
        new SeerResolver(address(0), address(points), admin, 1, 2, 0, 0, 0, 0);

        vm.expectRevert(SeerResolver.ZeroAddress.selector);
        new SeerResolver(address(mockRequester), address(0), admin, 1, 2, 0, 0, 0, 0);

        vm.expectRevert(SeerResolver.ZeroAddress.selector);
        new SeerResolver(address(mockRequester), address(points), address(0), 1, 2, 0, 0, 0, 0);
    }

    function test_setAdmin_onlyAdmin() public {
        vm.prank(alice);
        vm.expectRevert(SeerResolver.NotAdmin.selector);
        resolver.setAdmin(alice);
    }

    function test_setAdmin_changesAdmin() public {
        vm.prank(admin);
        resolver.setAdmin(alice);
        assertEq(resolver.admin(), alice);
    }

    function test_setJsonApiAgentId_onlyAdmin_andUpdates() public {
        vm.prank(alice);
        vm.expectRevert(SeerResolver.NotAdmin.selector);
        resolver.setJsonApiAgentId(123);

        vm.prank(admin);
        resolver.setJsonApiAgentId(123);
        assertEq(resolver.jsonApiAgentId(), 123);
    }

    function test_setLlmAgentId_onlyAdmin_andUpdates() public {
        vm.prank(alice);
        vm.expectRevert(SeerResolver.NotAdmin.selector);
        resolver.setLlmAgentId(456);

        vm.prank(admin);
        resolver.setLlmAgentId(456);
        assertEq(resolver.llmAgentId(), 456);
    }

    function test_setDeposits_onlyAdmin_andUpdates() public {
        vm.prank(alice);
        vm.expectRevert(SeerResolver.NotAdmin.selector);
        resolver.setDeposits(1, 2);

        vm.prank(admin);
        resolver.setDeposits(11, 22);
        assertEq(resolver.sourceCallDeposit(), 11);
        assertEq(resolver.llmCallDeposit(), 22);
    }

    function test_setBondAmount_onlyAdmin_andUpdates() public {
        vm.prank(alice);
        vm.expectRevert(SeerResolver.NotAdmin.selector);
        resolver.setBondAmount(5 ether);

        vm.prank(admin);
        resolver.setBondAmount(5 ether);
        assertEq(resolver.bondAmount(), 5 ether);
    }

    function test_setChallengeWindow_onlyAdmin_andUpdates() public {
        vm.prank(alice);
        vm.expectRevert(SeerResolver.NotAdmin.selector);
        resolver.setChallengeWindow(2 hours);

        vm.prank(admin);
        resolver.setChallengeWindow(2 hours);
        assertEq(resolver.challengeWindow(), 2 hours);
    }

    // ─── requestResolution ───────────────────────────────────────────────────

    function test_requestResolution_firesThreeJsonRequestsAndStoresState() public {
        uint256[3] memory ids = _kickoff();

        assertEq(uint8(resolver.phaseOf(market)), uint8(SeerResolver.Phase.AwaitingSources));
        assertEq(uint8(resolver.outcomeOf(market)), uint8(SeerResolver.Outcome.None));
        assertEq(uint8(resolver.proposedOutcomeOf(market)), uint8(SeerResolver.Outcome.None));
        assertEq(resolver.sourcesReceivedOf(market), 0);
        assertEq(resolver.proposerOf(market), alice);
        assertEq(resolver.bondOf(market), BOND);

        for (uint8 i = 0; i < 3; ++i) {
            assertEq(resolver.sourceRequestIdOf(market, i), ids[i]);
            assertGt(ids[i], 0);
        }
        // Total source deposits parked on mock; LLM deposit still in resolver.
        assertEq(address(mockRequester).balance, 3 * SOURCE_DEPOSIT);
        assertEq(address(resolver).balance, LLM_DEPOSIT);

        assertEq(resolver.inferencePromptOf(market), _prompt());
    }

    function test_requestResolution_escrowsBond() public {
        _kickoff();
        assertEq(points.balanceOf(alice), ALICE_POINTS - BOND);
        assertEq(points.balanceOf(address(resolver)), BOND);
    }

    function test_requestResolution_revertsWhenProposerLacksPoints() public {
        address poor = address(0xBAD1);
        vm.deal(poor, 100 ether);
        vm.prank(poor);
        vm.expectRevert(SeerPoints.InsufficientBalance.selector);
        resolver.requestResolution{value: TOTAL_DEPOSIT}(market, _sources(), _prompt());
    }

    function test_requestResolution_rejectsZeroMarket() public {
        vm.prank(alice);
        vm.expectRevert(SeerResolver.ZeroAddress.selector);
        resolver.requestResolution{value: TOTAL_DEPOSIT}(address(0), _sources(), _prompt());
    }

    function test_requestResolution_rejectsWrongSourceCount() public {
        bytes[] memory s = new bytes[](2);
        s[0] = hex"01";
        s[1] = hex"02";

        vm.prank(alice);
        vm.expectRevert(SeerResolver.WrongSourceCount.selector);
        resolver.requestResolution{value: TOTAL_DEPOSIT}(market, s, _prompt());
    }

    function test_requestResolution_rejectsWrongDeposit() public {
        uint256 wrong = TOTAL_DEPOSIT - 1;
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(SeerResolver.WrongDeposit.selector, wrong, TOTAL_DEPOSIT));
        resolver.requestResolution{value: wrong}(market, _sources(), _prompt());
    }

    function test_requestResolution_blockedWhileAwaitingSources() public {
        _kickoff();
        vm.prank(alice);
        vm.expectRevert(SeerResolver.AlreadyInProgress.selector);
        resolver.requestResolution{value: TOTAL_DEPOSIT}(market, _sources(), _prompt());
    }

    function test_requestResolution_blockedWhileAwaitingInference() public {
        uint256[3] memory ids = _kickoff();
        bytes[3] memory datas = [bytes(hex"01"), bytes(hex"02"), bytes(hex"03")];
        _deliverSources(ids, datas);
        assertEq(uint8(resolver.phaseOf(market)), uint8(SeerResolver.Phase.AwaitingInference));

        vm.prank(alice);
        vm.expectRevert(SeerResolver.AlreadyInProgress.selector);
        resolver.requestResolution{value: TOTAL_DEPOSIT}(market, _sources(), _prompt());
    }

    function test_requestResolution_blockedWhileChallenge() public {
        _toChallenge(1);
        assertEq(uint8(resolver.phaseOf(market)), uint8(SeerResolver.Phase.Challenge));

        vm.prank(alice);
        vm.expectRevert(SeerResolver.AlreadyInProgress.selector);
        resolver.requestResolution{value: TOTAL_DEPOSIT}(market, _sources(), _prompt());
    }

    // ─── handleSourceResponse ────────────────────────────────────────────────

    function test_handleSourceResponse_onlyRequesterCanCall() public {
        uint256[3] memory ids = _kickoff();

        IAgentRequester.Response[] memory empty = new IAgentRequester.Response[](0);
        IAgentRequester.Request memory details;

        vm.prank(alice);
        vm.expectRevert(SeerResolver.NotRequester.selector);
        resolver.handleSourceResponse(ids[0], empty, IAgentRequester.ResponseStatus.Succeeded, details);
    }

    function test_handleSourceResponse_revertsOnUnknownRequest() public {
        IAgentRequester.Response[] memory empty = new IAgentRequester.Response[](0);
        IAgentRequester.Request memory details;

        vm.prank(address(mockRequester));
        vm.expectRevert(SeerResolver.UnknownRequest.selector);
        resolver.handleSourceResponse(12345, empty, IAgentRequester.ResponseStatus.Succeeded, details);
    }

    function test_handleSourceResponse_storesDataAndIncrementsCount() public {
        uint256[3] memory ids = _kickoff();

        bytes[] memory wrap = new bytes[](1);
        wrap[0] = hex"deadbeef";
        mockRequester.simulateCallback(ids[1], wrap, IAgentRequester.ResponseStatus.Succeeded);

        assertEq(resolver.sourcesReceivedOf(market), 1);
        assertEq(resolver.sourceDataOf(market, 1), hex"deadbeef");
        assertEq(resolver.sourceDataOf(market, 0).length, 0);
        assertEq(uint8(resolver.phaseOf(market)), uint8(SeerResolver.Phase.AwaitingSources));
    }

    function test_handleSourceResponse_thirdResponseFiresInference() public {
        uint256[3] memory ids = _kickoff();
        bytes[3] memory datas = [bytes(hex"01"), bytes(hex"02"), bytes(hex"03")];
        _deliverSources(ids, datas);

        assertEq(uint8(resolver.phaseOf(market)), uint8(SeerResolver.Phase.AwaitingInference));
        assertGt(resolver.llmRequestIdOf(market), 0);
        assertEq(address(mockRequester).balance, TOTAL_DEPOSIT);
        assertEq(address(resolver).balance, 0);
    }

    // ─── handleInferenceResponse / challenge window ──────────────────────────

    function test_handleInferenceResponse_onlyRequesterCanCall() public {
        uint256[3] memory ids = _kickoff();
        bytes[3] memory datas = [bytes(hex"01"), bytes(hex"02"), bytes(hex"03")];
        _deliverSources(ids, datas);

        uint256 llmId = resolver.llmRequestIdOf(market);
        IAgentRequester.Response[] memory empty = new IAgentRequester.Response[](0);
        IAgentRequester.Request memory details;

        vm.prank(alice);
        vm.expectRevert(SeerResolver.NotRequester.selector);
        resolver.handleInferenceResponse(llmId, empty, IAgentRequester.ResponseStatus.Succeeded, details);
    }

    function test_inference_opensChallengeWindowWithoutPayout() public {
        _toChallenge(1);

        // Proposal is visible, but the settled outcome is still None and no
        // payout can happen until finalize() — the Task I "Done when".
        assertEq(uint8(resolver.phaseOf(market)), uint8(SeerResolver.Phase.Challenge));
        assertEq(uint8(resolver.proposedOutcomeOf(market)), uint8(SeerResolver.Outcome.Yes));
        assertEq(uint8(resolver.outcomeOf(market)), uint8(SeerResolver.Outcome.None));
        assertFalse(resolver.isFinalized(market));
        assertEq(resolver.proposedAtOf(market), block.timestamp);
        assertEq(resolver.challengeDeadlineOf(market), block.timestamp + CHALLENGE_WINDOW);
        assertEq(resolver.llmRawResponseOf(market), abi.encode(uint8(1)));
        // Bond still escrowed during the window.
        assertEq(points.balanceOf(address(resolver)), BOND);
    }

    // ─── finalize ─────────────────────────────────────────────────────────────

    function test_finalize_beforeDeadlineReverts() public {
        _toChallenge(1);
        vm.warp(resolver.challengeDeadlineOf(market) - 1);
        vm.expectRevert(SeerResolver.ChallengeWindowOpen.selector);
        resolver.finalize(market);
    }

    function test_finalize_wrongPhaseReverts() public {
        _kickoff(); // Phase.AwaitingSources
        vm.expectRevert(SeerResolver.NotInChallenge.selector);
        resolver.finalize(market);
    }

    function test_endToEnd_yesOutcome_finalizesAndReturnsBond() public {
        _toChallenge(1);

        vm.warp(resolver.challengeDeadlineOf(market));
        resolver.finalize(market);

        assertEq(uint8(resolver.phaseOf(market)), uint8(SeerResolver.Phase.Finalized));
        assertTrue(resolver.isFinalized(market));
        assertEq(uint8(resolver.outcomeOf(market)), uint8(SeerResolver.Outcome.Yes));
        assertEq(uint8(resolver.finalOutcomeOf(market)), uint8(SeerResolver.Outcome.Yes));
        assertEq(resolver.finalizedAtOf(market), block.timestamp);
        // Undisputed: full bond returned to the proposer.
        assertEq(points.balanceOf(alice), ALICE_POINTS);
        assertEq(points.balanceOf(address(resolver)), 0);
    }

    function test_endToEnd_noOutcome_finalizes() public {
        _toChallenge(2);
        vm.warp(resolver.challengeDeadlineOf(market));
        resolver.finalize(market);
        assertEq(uint8(resolver.outcomeOf(market)), uint8(SeerResolver.Outcome.No));
    }

    function test_endToEnd_invalidOutcome_fromVerdict() public {
        _toChallenge(0);
        vm.warp(resolver.challengeDeadlineOf(market));
        resolver.finalize(market);
        assertEq(uint8(resolver.outcomeOf(market)), uint8(SeerResolver.Outcome.Invalid));
    }

    function test_endToEnd_invalidOutcome_fromFailedInference() public {
        uint256[3] memory ids = _kickoff();
        bytes[3] memory datas = [bytes(hex"01"), bytes(hex"02"), bytes(hex"03")];
        _deliverSources(ids, datas);

        uint256 llmId = resolver.llmRequestIdOf(market);
        bytes[] memory empty = new bytes[](0);
        mockRequester.simulateCallback(llmId, empty, IAgentRequester.ResponseStatus.Failed);

        assertEq(uint8(resolver.phaseOf(market)), uint8(SeerResolver.Phase.Challenge));
        assertEq(uint8(resolver.proposedOutcomeOf(market)), uint8(SeerResolver.Outcome.Invalid));

        vm.warp(resolver.challengeDeadlineOf(market));
        resolver.finalize(market);
        assertEq(uint8(resolver.outcomeOf(market)), uint8(SeerResolver.Outcome.Invalid));
    }

    function test_inferenceVerdictOutOfRangeReverts() public {
        uint256[3] memory ids = _kickoff();
        bytes[3] memory datas = [bytes(hex"01"), bytes(hex"02"), bytes(hex"03")];
        _deliverSources(ids, datas);

        uint256 llmId = resolver.llmRequestIdOf(market);
        bytes[] memory wrap = new bytes[](1);
        wrap[0] = abi.encode(uint8(7));

        vm.expectRevert(abi.encodeWithSelector(SeerResolver.InvalidVerdict.selector, uint8(7)));
        mockRequester.simulateCallback(llmId, wrap, IAgentRequester.ResponseStatus.Succeeded);
    }

    function test_secondCycle_afterFinalizedIsAllowed() public {
        _toChallenge(1);
        vm.warp(resolver.challengeDeadlineOf(market));
        resolver.finalize(market);
        assertEq(uint8(resolver.outcomeOf(market)), uint8(SeerResolver.Outcome.Yes));
        // Bond was returned, so the proposer can fund a fresh cycle.
        assertEq(points.balanceOf(alice), ALICE_POINTS);

        uint256 firstId = resolver.sourceRequestIdOf(market, 0);
        vm.prank(alice);
        uint256[3] memory secondIds = resolver.requestResolution{value: TOTAL_DEPOSIT}(market, _sources(), _prompt());

        for (uint8 i = 0; i < 3; ++i) {
            assertGt(secondIds[i], firstId);
            assertEq(resolver.sourceRequestIdOf(market, i), secondIds[i]);
        }
        assertEq(uint8(resolver.phaseOf(market)), uint8(SeerResolver.Phase.AwaitingSources));
        assertEq(uint8(resolver.outcomeOf(market)), uint8(SeerResolver.Outcome.None));
        assertEq(uint8(resolver.proposedOutcomeOf(market)), uint8(SeerResolver.Outcome.None));
        assertEq(resolver.sourcesReceivedOf(market), 0);
        // Fresh bond escrowed again.
        assertEq(points.balanceOf(address(resolver)), BOND);
    }

    function test_sourceCallbackInWrongPhaseReverts() public {
        uint256[3] memory ids = _kickoff();
        bytes[3] memory datas = [bytes(hex"01"), bytes(hex"02"), bytes(hex"03")];
        _deliverSources(ids, datas);
        // Now AwaitingInference. A re-delivery of source 0 should revert.
        bytes[] memory wrap = new bytes[](1);
        wrap[0] = hex"99";
        vm.expectRevert(SeerResolver.UnknownRequest.selector);
        mockRequester.simulateCallback(ids[0], wrap, IAgentRequester.ResponseStatus.Succeeded);
    }

    function test_views_indexOutOfBoundsReverts() public {
        vm.expectRevert(SeerResolver.IndexOutOfBounds.selector);
        resolver.sourceRequestIdOf(market, 3);

        vm.expectRevert(SeerResolver.IndexOutOfBounds.selector);
        resolver.sourceDataOf(market, 3);
    }

    // ─── dispute (Task J) ──────────────────────────────────────────────────────

    function test_dispute_movesToDisputedAndEscrowsBond() public {
        _toChallenge(1);
        uint256 mockBalBefore = address(mockRequester).balance;

        vm.prank(bob);
        resolver.dispute{value: ESCALATION_DEPOSIT}(market);

        assertEq(uint8(resolver.phaseOf(market)), uint8(SeerResolver.Phase.Disputed));
        assertEq(resolver.disputerOf(market), bob);
        assertEq(resolver.disputerBondOf(market), BOND);
        assertGt(resolver.escalationRequestIdOf(market), 0);
        // Both bonds now escrowed in the resolver.
        assertEq(points.balanceOf(address(resolver)), 2 * BOND);
        assertEq(points.balanceOf(bob), ALICE_POINTS - BOND);
        // Escalation deposit forwarded to the requester for the advanced request.
        assertEq(address(mockRequester).balance, mockBalBefore + ESCALATION_DEPOSIT);
        // Deadline reset for the escalation leg; outcome still unsettled.
        assertEq(resolver.requestDeadlineOf(market), block.timestamp + resolver.resolutionTimeout());
        assertEq(uint8(resolver.outcomeOf(market)), uint8(SeerResolver.Outcome.None));
    }

    function test_dispute_revertsAfterWindowCloses() public {
        _toChallenge(1);
        vm.warp(resolver.challengeDeadlineOf(market));
        vm.prank(bob);
        vm.expectRevert(SeerResolver.ChallengeWindowClosed.selector);
        resolver.dispute{value: ESCALATION_DEPOSIT}(market);
    }

    function test_dispute_revertsWrongPhase() public {
        _kickoff(); // AwaitingSources
        vm.prank(bob);
        vm.expectRevert(SeerResolver.NotInChallenge.selector);
        resolver.dispute{value: ESCALATION_DEPOSIT}(market);
    }

    function test_dispute_revertsWrongDeposit() public {
        _toChallenge(1);
        uint256 wrong = ESCALATION_DEPOSIT - 1;
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(SeerResolver.WrongDeposit.selector, wrong, ESCALATION_DEPOSIT));
        resolver.dispute{value: wrong}(market);
    }

    function test_dispute_revertsWhenDisputerLacksPoints() public {
        _toChallenge(1);
        address poor = address(0xBAD2);
        vm.deal(poor, 100 ether);
        vm.prank(poor);
        vm.expectRevert(SeerPoints.InsufficientBalance.selector);
        resolver.dispute{value: ESCALATION_DEPOSIT}(market);
    }

    // ─── escalation + slashing (Tasks K + L) ────────────────────────────────────

    function test_escalation_upholdsProposer_slashesDisputer() public {
        _toDisputed(1, bob); // propose Yes, bob disputes
        _deliverEscalation(1, IAgentRequester.ResponseStatus.Succeeded); // escalation agrees

        assertEq(uint8(resolver.phaseOf(market)), uint8(SeerResolver.Phase.Finalized));
        assertTrue(resolver.isFinalized(market));
        assertEq(uint8(resolver.finalOutcomeOf(market)), uint8(SeerResolver.Outcome.Yes));
        // Proposer takes both bonds (no fee by default); disputer is slashed.
        assertEq(points.balanceOf(alice), ALICE_POINTS + BOND);
        assertEq(points.balanceOf(bob), ALICE_POINTS - BOND);
        assertEq(points.balanceOf(address(resolver)), 0);
    }

    function test_escalation_overturnsProposer_slashesProposer() public {
        _toDisputed(1, bob); // propose Yes
        _deliverEscalation(2, IAgentRequester.ResponseStatus.Succeeded); // escalation says No

        assertEq(uint8(resolver.finalOutcomeOf(market)), uint8(SeerResolver.Outcome.No));
        // Disputer overturned the outcome and takes both bonds.
        assertEq(points.balanceOf(bob), ALICE_POINTS + BOND);
        assertEq(points.balanceOf(alice), ALICE_POINTS - BOND);
        assertEq(points.balanceOf(address(resolver)), 0);
    }

    function test_escalation_withProtocolFee_takesCut() public {
        address feeWallet = address(0xFEE);
        vm.prank(admin);
        resolver.setProtocolFee(1_000, feeWallet); // 10%

        _toDisputed(1, bob);
        _deliverEscalation(1, IAgentRequester.ResponseStatus.Succeeded); // proposer upheld

        uint256 fee = BOND / 10; // 10% of the slashed disputer bond
        assertEq(points.balanceOf(feeWallet), fee);
        assertEq(points.balanceOf(alice), ALICE_POINTS - BOND + (2 * BOND - fee));
        assertEq(points.balanceOf(bob), ALICE_POINTS - BOND);
        assertEq(points.balanceOf(address(resolver)), 0);
    }

    function test_escalation_invalid_refundsBothBonds() public {
        _toDisputed(1, bob);
        _deliverEscalation(0, IAgentRequester.ResponseStatus.Succeeded); // INVALID

        assertEq(uint8(resolver.finalOutcomeOf(market)), uint8(SeerResolver.Outcome.Invalid));
        assertTrue(resolver.isFinalized(market));
        // Honest stalemate: both bonds refunded in full, no slash (Task L).
        assertEq(points.balanceOf(alice), ALICE_POINTS);
        assertEq(points.balanceOf(bob), ALICE_POINTS);
        assertEq(points.balanceOf(address(resolver)), 0);
    }

    function test_escalation_failedStatus_refundsBothBonds() public {
        _toDisputed(1, bob);
        uint256 escId = resolver.escalationRequestIdOf(market);
        bytes[] memory empty = new bytes[](0);
        mockRequester.simulateCallback(escId, empty, IAgentRequester.ResponseStatus.Failed);

        assertEq(uint8(resolver.finalOutcomeOf(market)), uint8(SeerResolver.Outcome.Invalid));
        assertEq(points.balanceOf(alice), ALICE_POINTS);
        assertEq(points.balanceOf(bob), ALICE_POINTS);
        assertEq(points.balanceOf(address(resolver)), 0);
    }

    function test_handleEscalationResponse_onlyRequesterCanCall() public {
        _toDisputed(1, bob);
        uint256 escId = resolver.escalationRequestIdOf(market);
        IAgentRequester.Response[] memory empty = new IAgentRequester.Response[](0);
        IAgentRequester.Request memory details;

        vm.prank(alice);
        vm.expectRevert(SeerResolver.NotRequester.selector);
        resolver.handleEscalationResponse(escId, empty, IAgentRequester.ResponseStatus.Succeeded, details);
    }

    function test_handleEscalationResponse_revertsOnUnknownRequest() public {
        IAgentRequester.Response[] memory empty = new IAgentRequester.Response[](0);
        IAgentRequester.Request memory details;

        vm.prank(address(mockRequester));
        vm.expectRevert(SeerResolver.UnknownRequest.selector);
        resolver.handleEscalationResponse(99999, empty, IAgentRequester.ResponseStatus.Succeeded, details);
    }

    // ─── timeout safety net (Task L) ────────────────────────────────────────────

    function test_timeoutResolution_awaitingSources_forcesInvalidAndRefunds() public {
        _kickoff(); // AwaitingSources, alice bonded
        assertEq(points.balanceOf(alice), ALICE_POINTS - BOND);

        vm.warp(resolver.requestDeadlineOf(market));
        resolver.timeoutResolution(market);

        assertEq(uint8(resolver.phaseOf(market)), uint8(SeerResolver.Phase.Finalized));
        assertEq(uint8(resolver.finalOutcomeOf(market)), uint8(SeerResolver.Outcome.Invalid));
        assertEq(points.balanceOf(alice), ALICE_POINTS);
        assertEq(points.balanceOf(address(resolver)), 0);
    }

    function test_timeoutResolution_awaitingInference_forcesInvalidAndRefunds() public {
        uint256[3] memory ids = _kickoff();
        bytes[3] memory datas = [bytes(hex"01"), bytes(hex"02"), bytes(hex"03")];
        _deliverSources(ids, datas);
        assertEq(uint8(resolver.phaseOf(market)), uint8(SeerResolver.Phase.AwaitingInference));

        vm.warp(resolver.requestDeadlineOf(market));
        resolver.timeoutResolution(market);

        assertEq(uint8(resolver.finalOutcomeOf(market)), uint8(SeerResolver.Outcome.Invalid));
        assertEq(points.balanceOf(alice), ALICE_POINTS);
        assertEq(points.balanceOf(address(resolver)), 0);
    }

    function test_timeoutResolution_disputed_refundsBothBonds() public {
        _toDisputed(1, bob);
        // Escalation never returns; force the timeout after the reset deadline.
        vm.warp(resolver.requestDeadlineOf(market));
        resolver.timeoutResolution(market);

        assertEq(uint8(resolver.finalOutcomeOf(market)), uint8(SeerResolver.Outcome.Invalid));
        assertEq(points.balanceOf(alice), ALICE_POINTS);
        assertEq(points.balanceOf(bob), ALICE_POINTS);
        assertEq(points.balanceOf(address(resolver)), 0);
    }

    function test_timeoutResolution_beforeDeadlineReverts() public {
        _kickoff();
        vm.warp(resolver.requestDeadlineOf(market) - 1);
        vm.expectRevert(SeerResolver.TimeoutNotReached.selector);
        resolver.timeoutResolution(market);
    }

    function test_timeoutResolution_challengePhaseNotTimeoutable() public {
        _toChallenge(1);
        // Challenge self-resolves via finalize(), so it is never timeoutable —
        // even once the request deadline has elapsed.
        vm.warp(block.timestamp + resolver.resolutionTimeout() + 1);
        vm.expectRevert(SeerResolver.NotTimeoutable.selector);
        resolver.timeoutResolution(market);
    }

    function test_timeoutResolution_finalizedNotTimeoutable() public {
        _toChallenge(1);
        vm.warp(resolver.challengeDeadlineOf(market));
        resolver.finalize(market);
        vm.expectRevert(SeerResolver.NotTimeoutable.selector);
        resolver.timeoutResolution(market);
    }

    // ─── dispute / escalation config (admin) ────────────────────────────────────

    function test_constructor_setsDisputeDefaults() public {
        SeerResolver fresh = new SeerResolver(
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
        assertEq(fresh.escalationSubcommitteeSize(), 7);
        assertEq(fresh.escalationThreshold(), 5);
        assertEq(uint8(fresh.escalationConsensusType()), uint8(IAgentRequester.ConsensusType.Threshold));
        assertEq(fresh.escalationCallTimeout(), 1 hours);
        assertEq(fresh.resolutionTimeout(), 1 days);
        assertEq(fresh.feeRecipient(), admin);
        assertEq(fresh.protocolFeeBps(), 0);
        assertEq(fresh.escalationDeposit(), 0);
    }

    function test_setEscalationParams_onlyAdmin_andUpdates() public {
        vm.prank(alice);
        vm.expectRevert(SeerResolver.NotAdmin.selector);
        resolver.setEscalationParams(9, 6, IAgentRequester.ConsensusType.Unanimous, 2 hours);

        vm.prank(admin);
        resolver.setEscalationParams(9, 6, IAgentRequester.ConsensusType.Unanimous, 2 hours);
        assertEq(resolver.escalationSubcommitteeSize(), 9);
        assertEq(resolver.escalationThreshold(), 6);
        assertEq(uint8(resolver.escalationConsensusType()), uint8(IAgentRequester.ConsensusType.Unanimous));
        assertEq(resolver.escalationCallTimeout(), 2 hours);
    }

    function test_setEscalationDeposit_onlyAdmin_andUpdates() public {
        vm.prank(alice);
        vm.expectRevert(SeerResolver.NotAdmin.selector);
        resolver.setEscalationDeposit(1 ether);

        vm.prank(admin);
        resolver.setEscalationDeposit(1 ether);
        assertEq(resolver.escalationDeposit(), 1 ether);
    }

    function test_setProtocolFee_onlyAdmin_andUpdates() public {
        vm.prank(alice);
        vm.expectRevert(SeerResolver.NotAdmin.selector);
        resolver.setProtocolFee(500, alice);

        vm.prank(admin);
        resolver.setProtocolFee(500, alice);
        assertEq(resolver.protocolFeeBps(), 500);
        assertEq(resolver.feeRecipient(), alice);
    }

    function test_setProtocolFee_rejectsTooHighFee() public {
        uint256 tooHigh = resolver.MAX_FEE_BPS() + 1;
        vm.prank(admin);
        vm.expectRevert(SeerResolver.FeeTooHigh.selector);
        resolver.setProtocolFee(tooHigh, admin);
    }

    function test_setProtocolFee_rejectsZeroRecipient() public {
        vm.prank(admin);
        vm.expectRevert(SeerResolver.ZeroAddress.selector);
        resolver.setProtocolFee(100, address(0));
    }

    function test_setResolutionTimeout_onlyAdmin_andUpdates() public {
        vm.prank(alice);
        vm.expectRevert(SeerResolver.NotAdmin.selector);
        resolver.setResolutionTimeout(3 days);

        vm.prank(admin);
        resolver.setResolutionTimeout(3 days);
        assertEq(resolver.resolutionTimeout(), 3 days);
    }
}

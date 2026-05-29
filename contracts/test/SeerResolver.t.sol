// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

import {IAgentRequester} from "../src/interfaces/IAgentRequester.sol";
import {SeerResolver} from "../src/SeerResolver.sol";
import {MockAgentRequester} from "./mocks/MockAgentRequester.sol";

contract SeerResolverTest is Test {
    MockAgentRequester internal mockRequester;
    SeerResolver internal resolver;

    address internal admin = address(0xAD);
    address internal alice = address(0xA1);
    address internal market = address(0xBABE);

    uint256 internal constant JSON_AGENT_ID = 42;
    uint256 internal constant LLM_AGENT_ID = 99;
    uint256 internal constant SOURCE_DEPOSIT = 0.05 ether;
    uint256 internal constant LLM_DEPOSIT = 0.05 ether;
    uint256 internal constant TOTAL_DEPOSIT = 3 * SOURCE_DEPOSIT + LLM_DEPOSIT;

    function setUp() public {
        mockRequester = new MockAgentRequester();
        resolver = new SeerResolver(
            address(mockRequester),
            admin,
            JSON_AGENT_ID,
            LLM_AGENT_ID,
            SOURCE_DEPOSIT,
            LLM_DEPOSIT
        );
        vm.deal(alice, 100 ether);
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    function _sources() internal pure returns (bytes[] memory s) {
        s = new bytes[](3);
        s[0] = abi.encode(
            "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
            "bitcoin.usd",
            uint8(8)
        );
        s[1] = abi.encode(
            "https://api.coinbase.com/v2/prices/BTC-USD/spot", "data.amount", uint8(8)
        );
        s[2] = abi.encode(
            "https://api.kraken.com/0/public/Ticker?pair=XBTUSD",
            "result.XXBTZUSD.c[0]",
            uint8(8)
        );
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
            mockRequester.simulateCallback(
                ids[i], wrap, IAgentRequester.ResponseStatus.Succeeded
            );
        }
    }

    function _deliverInference(uint8 verdict, IAgentRequester.ResponseStatus status)
        internal
    {
        uint256 llmId = resolver.llmRequestIdOf(market);
        bytes[] memory wrap = new bytes[](1);
        wrap[0] = abi.encode(verdict);
        mockRequester.simulateCallback(llmId, wrap, status);
    }

    // ─── Constructor & admin ─────────────────────────────────────────────────

    function test_constructor_setsFields() public view {
        assertEq(address(resolver.requester()), address(mockRequester));
        assertEq(resolver.admin(), admin);
        assertEq(resolver.jsonApiAgentId(), JSON_AGENT_ID);
        assertEq(resolver.llmAgentId(), LLM_AGENT_ID);
        assertEq(resolver.sourceCallDeposit(), SOURCE_DEPOSIT);
        assertEq(resolver.llmCallDeposit(), LLM_DEPOSIT);
    }

    function test_constructor_rejectsZeroAddress() public {
        vm.expectRevert(SeerResolver.ZeroAddress.selector);
        new SeerResolver(address(0), admin, 1, 2, 0, 0);

        vm.expectRevert(SeerResolver.ZeroAddress.selector);
        new SeerResolver(address(mockRequester), address(0), 1, 2, 0, 0);
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

    // ─── requestResolution ───────────────────────────────────────────────────

    function test_requestResolution_firesThreeJsonRequestsAndStoresState() public {
        uint256[3] memory ids = _kickoff();

        assertEq(uint8(resolver.phaseOf(market)), uint8(SeerResolver.Phase.AwaitingSources));
        assertEq(uint8(resolver.outcomeOf(market)), uint8(SeerResolver.Outcome.None));
        assertEq(resolver.sourcesReceivedOf(market), 0);

        for (uint8 i = 0; i < 3; ++i) {
            assertEq(resolver.sourceRequestIdOf(market, i), ids[i]);
            assertGt(ids[i], 0);
        }
        // Total source deposits parked on mock; LLM deposit still in resolver.
        assertEq(address(mockRequester).balance, 3 * SOURCE_DEPOSIT);
        assertEq(address(resolver).balance, LLM_DEPOSIT);

        assertEq(resolver.inferencePromptOf(market), _prompt());
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
        vm.expectRevert(
            abi.encodeWithSelector(SeerResolver.WrongDeposit.selector, wrong, TOTAL_DEPOSIT)
        );
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
        // Now Phase.AwaitingInference (LLM auto-fired after 3rd source).
        assertEq(uint8(resolver.phaseOf(market)), uint8(SeerResolver.Phase.AwaitingInference));

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
        resolver.handleSourceResponse(
            ids[0], empty, IAgentRequester.ResponseStatus.Succeeded, details
        );
    }

    function test_handleSourceResponse_revertsOnUnknownRequest() public {
        IAgentRequester.Response[] memory empty = new IAgentRequester.Response[](0);
        IAgentRequester.Request memory details;

        vm.prank(address(mockRequester));
        vm.expectRevert(SeerResolver.UnknownRequest.selector);
        resolver.handleSourceResponse(
            12345, empty, IAgentRequester.ResponseStatus.Succeeded, details
        );
    }

    function test_handleSourceResponse_storesDataAndIncrementsCount() public {
        uint256[3] memory ids = _kickoff();

        bytes[] memory wrap = new bytes[](1);
        wrap[0] = hex"deadbeef";
        mockRequester.simulateCallback(
            ids[1], wrap, IAgentRequester.ResponseStatus.Succeeded
        );

        assertEq(resolver.sourcesReceivedOf(market), 1);
        assertEq(resolver.sourceDataOf(market, 1), hex"deadbeef");
        assertEq(resolver.sourceDataOf(market, 0).length, 0);
        assertEq(uint8(resolver.phaseOf(market)), uint8(SeerResolver.Phase.AwaitingSources));
    }

    function test_handleSourceResponse_thirdResponseFiresInference() public {
        uint256[3] memory ids = _kickoff();
        bytes[3] memory datas = [bytes(hex"01"), bytes(hex"02"), bytes(hex"03")];
        _deliverSources(ids, datas);

        // Phase moved to AwaitingInference; an LLM request id is now recorded.
        assertEq(uint8(resolver.phaseOf(market)), uint8(SeerResolver.Phase.AwaitingInference));
        assertGt(resolver.llmRequestIdOf(market), 0);
        // Mock now holds all 4 deposits (3 source + 1 LLM).
        assertEq(address(mockRequester).balance, TOTAL_DEPOSIT);
        assertEq(address(resolver).balance, 0);
    }

    // ─── handleInferenceResponse ─────────────────────────────────────────────

    function test_handleInferenceResponse_onlyRequesterCanCall() public {
        uint256[3] memory ids = _kickoff();
        bytes[3] memory datas = [bytes(hex"01"), bytes(hex"02"), bytes(hex"03")];
        _deliverSources(ids, datas);

        uint256 llmId = resolver.llmRequestIdOf(market);
        IAgentRequester.Response[] memory empty = new IAgentRequester.Response[](0);
        IAgentRequester.Request memory details;

        vm.prank(alice);
        vm.expectRevert(SeerResolver.NotRequester.selector);
        resolver.handleInferenceResponse(
            llmId, empty, IAgentRequester.ResponseStatus.Succeeded, details
        );
    }

    function test_endToEnd_yesOutcome() public {
        uint256[3] memory ids = _kickoff();
        // BTC at $100k from three different price feeds, scaled 1e8.
        bytes[3] memory datas = [
            abi.encode(uint256(100_010 * 1e8)),
            abi.encode(uint256(100_005 * 1e8)),
            abi.encode(uint256(100_020 * 1e8))
        ];
        _deliverSources(ids, datas);

        vm.warp(block.timestamp + 30 minutes);
        _deliverInference(1, IAgentRequester.ResponseStatus.Succeeded);

        assertEq(uint8(resolver.phaseOf(market)), uint8(SeerResolver.Phase.Resolved));
        assertEq(uint8(resolver.outcomeOf(market)), uint8(SeerResolver.Outcome.Yes));
        assertEq(resolver.resolvedAtOf(market), block.timestamp);
        assertEq(resolver.llmRawResponseOf(market), abi.encode(uint8(1)));
    }

    function test_endToEnd_noOutcome() public {
        uint256[3] memory ids = _kickoff();
        bytes[3] memory datas = [
            abi.encode(uint256(99_900 * 1e8)),
            abi.encode(uint256(99_850 * 1e8)),
            abi.encode(uint256(99_990 * 1e8))
        ];
        _deliverSources(ids, datas);
        _deliverInference(2, IAgentRequester.ResponseStatus.Succeeded);

        assertEq(uint8(resolver.outcomeOf(market)), uint8(SeerResolver.Outcome.No));
    }

    function test_endToEnd_invalidOutcome_fromVerdict() public {
        uint256[3] memory ids = _kickoff();
        bytes[3] memory datas = [bytes(hex""), bytes(hex"01"), bytes(hex"02")];
        _deliverSources(ids, datas);
        _deliverInference(0, IAgentRequester.ResponseStatus.Succeeded);

        assertEq(uint8(resolver.outcomeOf(market)), uint8(SeerResolver.Outcome.Invalid));
    }

    function test_endToEnd_invalidOutcome_fromFailedInference() public {
        uint256[3] memory ids = _kickoff();
        bytes[3] memory datas = [bytes(hex"01"), bytes(hex"02"), bytes(hex"03")];
        _deliverSources(ids, datas);

        uint256 llmId = resolver.llmRequestIdOf(market);
        bytes[] memory empty = new bytes[](0);
        mockRequester.simulateCallback(llmId, empty, IAgentRequester.ResponseStatus.Failed);

        assertEq(uint8(resolver.phaseOf(market)), uint8(SeerResolver.Phase.Resolved));
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

    function test_secondCycle_afterResolvedIsAllowed() public {
        uint256[3] memory firstIds = _kickoff();
        bytes[3] memory datas = [bytes(hex"01"), bytes(hex"02"), bytes(hex"03")];
        _deliverSources(firstIds, datas);
        _deliverInference(1, IAgentRequester.ResponseStatus.Succeeded);

        assertEq(uint8(resolver.outcomeOf(market)), uint8(SeerResolver.Outcome.Yes));

        // Fresh cycle for the same market.
        vm.prank(alice);
        uint256[3] memory secondIds =
            resolver.requestResolution{value: TOTAL_DEPOSIT}(market, _sources(), _prompt());

        for (uint8 i = 0; i < 3; ++i) {
            assertGt(secondIds[i], firstIds[i]);
            assertEq(resolver.sourceRequestIdOf(market, i), secondIds[i]);
        }
        assertEq(uint8(resolver.phaseOf(market)), uint8(SeerResolver.Phase.AwaitingSources));
        assertEq(uint8(resolver.outcomeOf(market)), uint8(SeerResolver.Outcome.None));
        assertEq(resolver.sourcesReceivedOf(market), 0);
    }

    function test_sourceCallbackInWrongPhaseReverts() public {
        uint256[3] memory ids = _kickoff();
        bytes[3] memory datas = [bytes(hex"01"), bytes(hex"02"), bytes(hex"03")];
        _deliverSources(ids, datas);
        // Now AwaitingInference. A re-delivery of source 0 should revert
        // because the phase no longer accepts source responses.
        bytes[] memory wrap = new bytes[](1);
        wrap[0] = hex"99";
        vm.expectRevert(SeerResolver.UnknownRequest.selector);
        mockRequester.simulateCallback(
            ids[0], wrap, IAgentRequester.ResponseStatus.Succeeded
        );
    }

    function test_views_indexOutOfBoundsReverts() public {
        vm.expectRevert(SeerResolver.IndexOutOfBounds.selector);
        resolver.sourceRequestIdOf(market, 3);

        vm.expectRevert(SeerResolver.IndexOutOfBounds.selector);
        resolver.sourceDataOf(market, 3);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IAgentRequester} from "../../src/interfaces/IAgentRequester.sol";

// Test mock that mimics IAgentRequester behavior. createRequest hands back
// an incrementing requestId; simulateCallback delivers a fake response to
// the registered callback so we can exercise the full callback path
// without a live agent network.
contract MockAgentRequester is IAgentRequester {
    struct PendingRequest {
        uint256 agentId;
        address callbackAddress;
        bytes4 callbackSelector;
        bytes payload;
        uint256 deposit;
    }

    uint256 public nextRequestId;
    mapping(uint256 => PendingRequest) public requests;

    event RequestCreated(uint256 indexed requestId, uint256 agentId, address callback);
    event CallbackSimulated(uint256 indexed requestId, ResponseStatus status, uint256 responseCount);

    function createRequest(
        uint256 agentId,
        address callbackAddress,
        bytes4 callbackSelector,
        bytes calldata payload
    ) external payable returns (uint256 requestId) {
        requestId = ++nextRequestId;
        requests[requestId] = PendingRequest({
            agentId: agentId,
            callbackAddress: callbackAddress,
            callbackSelector: callbackSelector,
            payload: payload,
            deposit: msg.value
        });
        emit RequestCreated(requestId, agentId, callbackAddress);
    }

    function createAdvancedRequest(
        uint256 agentId,
        address callbackAddress,
        bytes4 callbackSelector,
        bytes calldata payload,
        uint256, /* subcommitteeSize */
        uint256, /* threshold */
        ConsensusType, /* consensusType */
        uint256 /* timeout */
    ) external payable returns (uint256 requestId) {
        requestId = ++nextRequestId;
        requests[requestId] = PendingRequest({
            agentId: agentId,
            callbackAddress: callbackAddress,
            callbackSelector: callbackSelector,
            payload: payload,
            deposit: msg.value
        });
        emit RequestCreated(requestId, agentId, callbackAddress);
    }

    function simulateCallback(uint256 requestId, bytes[] memory datas, ResponseStatus status) external {
        PendingRequest memory pr = requests[requestId];
        require(pr.callbackAddress != address(0), "MockAgentRequester: unknown requestId");

        Response[] memory responses = new Response[](datas.length);
        for (uint256 i = 0; i < datas.length; ++i) {
            responses[i] = Response({data: datas[i], validator: address(uint160(0x1000 + i))});
        }
        Request memory details = Request({
            agentId: pr.agentId,
            callbackAddress: pr.callbackAddress,
            callbackSelector: pr.callbackSelector,
            payload: pr.payload
        });

        (bool ok, bytes memory ret) = pr.callbackAddress.call(
            abi.encodeWithSelector(pr.callbackSelector, requestId, responses, status, details)
        );
        if (!ok) {
            // Bubble the revert reason up so tests see the underlying error.
            assembly {
                revert(add(ret, 0x20), mload(ret))
            }
        }

        emit CallbackSimulated(requestId, status, datas.length);
    }
}

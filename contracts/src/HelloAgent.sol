// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IAgentRequester} from "./interfaces/IAgentRequester.sol";

// Phase 0 / Task B de-risk: minimal contract that fires a single agent
// request and stores the returned data via the platform callback. Lets us
// verify deposit math + callback shape on Somnia testnet before any SEER
// contract leans on it.
contract HelloAgent {
    IAgentRequester public immutable requester;

    uint256 public lastRequestId;
    IAgentRequester.ResponseStatus public lastStatus;
    bytes public lastResponse;

    event RequestSent(uint256 indexed requestId, uint256 agentId, bytes payload);
    event ResponseReceived(uint256 indexed requestId, IAgentRequester.ResponseStatus status, uint256 responseCount);

    error UnauthorizedCallback(address caller);

    constructor(address requester_) {
        requester = IAgentRequester(requester_);
    }

    function ask(uint256 agentId, bytes calldata payload) external payable returns (uint256 requestId) {
        requestId = requester.createRequest{value: msg.value}(
            agentId,
            address(this),
            this.handleResponse.selector,
            payload
        );
        lastRequestId = requestId;
        emit RequestSent(requestId, agentId, payload);
    }

    function handleResponse(
        uint256 requestId,
        IAgentRequester.Response[] calldata responses,
        IAgentRequester.ResponseStatus status,
        IAgentRequester.Request calldata /* details */
    ) external {
        if (msg.sender != address(requester)) revert UnauthorizedCallback(msg.sender);
        lastStatus = status;
        if (responses.length > 0) {
            lastResponse = responses[0].data;
        }
        emit ResponseReceived(requestId, status, responses.length);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// Mirrors the Somnia IAgentRequester interface.
// Source: https://docs.somnia.network/agents/invoking-agents/from-solidity
// Testnet address: 0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776 (chain id 50312)
interface IAgentRequester {
    enum ConsensusType {
        Simple,
        Threshold,
        Unanimous
    }
    enum ResponseStatus {
        Pending,
        Succeeded,
        Failed,
        TimedOut
    }

    struct Request {
        uint256 agentId;
        address callbackAddress;
        bytes4 callbackSelector;
        bytes payload;
    }

    struct Response {
        bytes data;
        address validator;
    }

    function createRequest(uint256 agentId, address callbackAddress, bytes4 callbackSelector, bytes calldata payload)
        external
        payable
        returns (uint256 requestId);

    function createAdvancedRequest(
        uint256 agentId,
        address callbackAddress,
        bytes4 callbackSelector,
        bytes calldata payload,
        uint256 subcommitteeSize,
        uint256 threshold,
        ConsensusType consensusType,
        uint256 timeout
    ) external payable returns (uint256 requestId);
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {HelloAgent} from "../src/HelloAgent.sol";

// Phase 0 / Task B verification: fire one JSON API Request through a deployed
// HelloAgent and let the runner callback land on-chain.
//
// Required env vars:
//   PRIVATE_KEY                    deployer key (must have STT for msg.value + gas)
//   HELLO_AGENT_ADDRESS            address printed by Deploy.s.sol
//   JSON_API_AGENT_ID              uint256 from https://agents.testnet.somnia.network
//   AGENT_DEPOSIT                  msg.value in wei (0.12 STT default for JSON API)
//
// Usage:
//   forge script script/Ask.s.sol --rpc-url somnia_testnet --broadcast
//
// The agent's `fetchUint` method takes (url, jsonPath, decimals). Default payload
// asks CoinGecko for BTC/USD with 8-decimal scaling — change as needed.
interface IJsonApiAgent {
    function fetchUint(string calldata url, string calldata jsonPath, uint8 decimals) external;
}

contract Ask is Script {
    function run() external returns (uint256 requestId) {
        HelloAgent hello = HelloAgent(vm.envAddress("HELLO_AGENT_ADDRESS"));
        uint256 agentId = vm.envUint("JSON_API_AGENT_ID");
        uint256 deposit = vm.envOr("AGENT_DEPOSIT", uint256(0.12 ether));

        bytes memory payload = abi.encodeWithSelector(
            IJsonApiAgent.fetchUint.selector,
            "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
            "bitcoin.usd",
            uint8(8)
        );

        vm.startBroadcast();
        requestId = hello.ask{value: deposit}(agentId, payload);
        vm.stopBroadcast();

        console2.log("requestId:", requestId);
        console2.log("Waiting for ResponseReceived event on", address(hello));
    }
}

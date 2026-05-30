// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {HelloAgent} from "../src/HelloAgent.sol";
import {SeerMarketFactory} from "../src/SeerMarketFactory.sol";
import {SeerPoints} from "../src/SeerPoints.sol";
import {SeerResolver} from "../src/SeerResolver.sol";
import {SeerSettlement} from "../src/SeerSettlement.sol";
import {SeerSignalAgent} from "../src/SeerSignalAgent.sol";

// Full-stack deploy (Task Y). Deploys, in dependency order:
//   - HelloAgent          (Task B agent-callback de-risk probe)
//   - SeerPoints          (Task C soulbound settlement token)
//   - SeerResolver        (Task E/G bonded optimistic oracle)
//   - SeerSettlement      (Task S oracle -> market bridge)
//   - SeerMarketFactory   (Task F/Q market deployer + subsidy + reactor sink)
//   - SeerSignalAgent     (Task O/P discovery: scores + creation bond)
//
// Wiring done here (must happen while the deployer still owns Points):
//   - SeerResolver and SeerSignalAgent are registered as Points operators so
//     they can escrow/slash bonds via operatorTransfer.
//   - Points ownership is handed to the factory (it mints subsidy + the market
//     bonds), which accepts in the same broadcast.
//   - The factory's reactor is set so a Somnia ContractEvent subscription can
//     fire onMarketProposed. Until that subscription is registered on testnet,
//     SEER_REACTOR defaults to the deployer EOA so markets can be cranked by hand.
//
// Agent IDs and the reactor are env-overridable because the canonical Somnia
// testnet agent IDs are not yet confirmed (faucet-gated, see build log). The
// economic params are sensible v1 defaults; retune via each contract's admin.
//
// Usage:
//   forge script script/Deploy.s.sol \
//     --rpc-url somnia_testnet \
//     --private-key $PRIVATE_KEY \
//     --broadcast
//
// Requires .env with SOMNIA_TESTNET_RPC, SOMNIA_AGENT_REQUESTER, PRIVATE_KEY.
// Optional .env: SEER_JSON_AGENT_ID, SEER_LLM_AGENT_ID,
//   SEER_MARKETABILITY_AGENT_ID, SEER_REACTOR.
contract Deploy is Script {
    // Factory bounds — tweak per market via factory admin functions.
    uint256 constant SUBSIDY_CAP = 100_000 ether;
    uint256 constant MIN_ALPHA = 1e15; // 0.001
    uint256 constant MAX_ALPHA = 5e17; // 0.5

    // Resolver economics (Points-denominated bonds; native-denominated deposits).
    uint256 constant SOURCE_DEPOSIT = 0.05 ether;
    uint256 constant LLM_DEPOSIT = 0.05 ether;
    uint256 constant RESOLUTION_BOND = 10 ether;
    uint256 constant CHALLENGE_WINDOW = 30 minutes;

    // Signal-agent economics.
    uint256 constant SCORE_DEPOSIT = 0.02 ether;
    uint256 constant CREATION_BOND = 5 ether;
    uint256 constant SCORE_THRESHOLD = 6_000; // bps, of SCORE_DENOMINATOR

    // Test-Points faucet (v1 play-money): hand each address a batch on a cooldown
    // so traders can use markets from the browser. Retune/disable via setFaucet.
    uint256 constant FAUCET_AMOUNT = 1_000 ether;
    uint256 constant FAUCET_COOLDOWN = 1 days;

    struct Deployed {
        HelloAgent hello;
        SeerPoints points;
        SeerResolver resolver;
        SeerSettlement settlement;
        SeerMarketFactory factory;
        SeerSignalAgent signal;
    }

    function run() external returns (Deployed memory d) {
        address requester = vm.envAddress("SOMNIA_AGENT_REQUESTER");
        address deployer = vm.addr(vm.envUint("PRIVATE_KEY"));

        // Unconfirmed on testnet → env-overridable placeholders.
        uint256 jsonAgentId = vm.envOr("SEER_JSON_AGENT_ID", uint256(1));
        uint256 llmAgentId = vm.envOr("SEER_LLM_AGENT_ID", uint256(2));
        uint256 marketabilityAgentId = vm.envOr("SEER_MARKETABILITY_AGENT_ID", uint256(3));
        // Falls back to the deployer so markets can be cranked manually until the
        // network ContractEvent subscription is registered.
        address reactor = vm.envOr("SEER_REACTOR", deployer);

        vm.startBroadcast();

        d.hello = new HelloAgent(requester);
        d.points = new SeerPoints(deployer);

        d.resolver = new SeerResolver(
            requester,
            address(d.points),
            deployer, // admin
            jsonAgentId,
            llmAgentId,
            SOURCE_DEPOSIT,
            LLM_DEPOSIT,
            RESOLUTION_BOND,
            CHALLENGE_WINDOW
        );
        d.settlement = new SeerSettlement(address(d.resolver));
        d.factory = new SeerMarketFactory(address(d.points), deployer, SUBSIDY_CAP, MIN_ALPHA, MAX_ALPHA);
        d.signal = new SeerSignalAgent(
            requester,
            address(d.points),
            address(d.factory),
            deployer, // admin
            deployer, // treasury (receives slashed junk bonds)
            marketabilityAgentId,
            SCORE_DEPOSIT,
            CREATION_BOND,
            SCORE_THRESHOLD
        );

        // Register bond-escrowing operators before relinquishing Points ownership.
        d.points.setOperator(address(d.resolver), true);
        d.points.setOperator(address(d.signal), true);

        // Hand the Points owner role to the factory so it can mint subsidy + bonds.
        d.points.transferOwnership(address(d.factory));
        d.factory.acceptPointsOwnership();

        // Arm reactive deployment.
        d.factory.setReactor(reactor);

        // Open the test-Points faucet so browser traders can self-fund.
        d.factory.setFaucet(FAUCET_AMOUNT, FAUCET_COOLDOWN);

        vm.stopBroadcast();

        console2.log("HelloAgent       :", address(d.hello));
        console2.log("SeerPoints       :", address(d.points));
        console2.log("SeerResolver     :", address(d.resolver));
        console2.log("SeerSettlement   :", address(d.settlement));
        console2.log("SeerMarketFactory:", address(d.factory));
        console2.log("SeerSignalAgent  :", address(d.signal));
        console2.log("Points owner     :", d.points.owner());
        console2.log("Factory admin    :", d.factory.admin());
        console2.log("Factory reactor  :", d.factory.reactor());
    }
}

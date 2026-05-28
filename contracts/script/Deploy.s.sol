// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {HelloAgent} from "../src/HelloAgent.sol";
import {SeerMarketFactory} from "../src/SeerMarketFactory.sol";
import {SeerPoints} from "../src/SeerPoints.sol";

// Phase 0 + Phase 1 deploy. Deploys:
//   - HelloAgent          (Task B agent-callback de-risk)
//   - SeerPoints          (Task C soulbound settlement token)
//   - SeerMarketFactory   (Task F market deployer + treasury seeder)
//
// After deploy:
//   - SeerPoints owner is the factory (factory accepts ownership in this script)
//   - Factory admin is the deployer EOA
//   - Factory is ready to createMarket(...)
//
// Usage:
//   forge script script/Deploy.s.sol \
//     --rpc-url somnia_testnet \
//     --private-key $PRIVATE_KEY \
//     --broadcast
//
// Requires .env with SOMNIA_TESTNET_RPC, SOMNIA_AGENT_REQUESTER, PRIVATE_KEY.
contract Deploy is Script {
    // Reasonable v1 defaults — tweak per market via factory admin functions.
    uint256 constant SUBSIDY_CAP = 100_000 ether;
    uint256 constant MIN_ALPHA = 1e15;  // 0.001
    uint256 constant MAX_ALPHA = 5e17;  // 0.5

    function run()
        external
        returns (HelloAgent hello, SeerPoints points, SeerMarketFactory factory)
    {
        address requester = vm.envAddress("SOMNIA_AGENT_REQUESTER");
        address deployer = vm.addr(vm.envUint("PRIVATE_KEY"));

        vm.startBroadcast();
        hello = new HelloAgent(requester);
        points = new SeerPoints(deployer);
        factory = new SeerMarketFactory(
            address(points), deployer, SUBSIDY_CAP, MIN_ALPHA, MAX_ALPHA
        );
        // Hand the Points owner role to the factory so it can mint subsidy.
        points.transferOwnership(address(factory));
        factory.acceptPointsOwnership();
        vm.stopBroadcast();

        console2.log("HelloAgent       :", address(hello));
        console2.log("SeerPoints       :", address(points));
        console2.log("SeerMarketFactory:", address(factory));
        console2.log("Points owner     :", points.owner());
        console2.log("Factory admin    :", factory.admin());
    }
}

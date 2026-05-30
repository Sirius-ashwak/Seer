// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {SeerMarketFactory} from "../src/SeerMarketFactory.sol";
import {SeerPoints} from "../src/SeerPoints.sol";
import {SeerResolver} from "../src/SeerResolver.sol";
import {SeerSettlement} from "../src/SeerSettlement.sol";
import {IAgentRequester} from "../src/interfaces/IAgentRequester.sol";
import {MockAgentRequester} from "../test/mocks/MockAgentRequester.sol";

// Local-only demo seeding (Task X verification). NOT for testnet.
//
// Deploys the full trading + resolution stack against a MockAgentRequester so
// the bonded 3-source + LLM + dispute lifecycle can be driven entirely on anvil,
// then:
//   - seeds 5 markets with varied prices (resolver = the Settlement bridge),
//   - drives market 0 to a proposed YES verdict left mid-challenge (finalize it
//     from the shell after advancing time — see the run recipe below),
//   - drives market 1 to a proposed YES that a disputer challenges, with the
//     larger escalation committee reversing it to NO, then settles it.
//
// The result gives the frontend resolution-receipt view real on-chain audit
// data: sources, returned payloads, inference prompt, proposer/disputer bonds,
// escalation request, and a finalized (reversed) outcome.
//
// Run:
//   PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
//     forge script script/SeedLocal.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
//   # then finalize the undisputed market 0:
//   cast rpc evm_increaseTime 1860 --rpc-url http://127.0.0.1:8545
//   cast rpc evm_mine --rpc-url http://127.0.0.1:8545
//   cast send <resolver> 'finalize(address)' <market0> --private-key $PRIVATE_KEY --rpc-url ...
//   cast send <settlement> 'settle(address)'  <market0> --private-key $PRIVATE_KEY --rpc-url ...
contract SeedLocal is Script {
    uint256 constant SUBSIDY_CAP = 100_000 ether;
    uint256 constant MIN_ALPHA = 1e15;
    uint256 constant MAX_ALPHA = 5e17;
    uint256 constant SOURCE_DEPOSIT = 0.05 ether;
    uint256 constant LLM_DEPOSIT = 0.05 ether;
    uint256 constant RESOLUTION_BOND = 10 ether;
    uint256 constant CHALLENGE_WINDOW = 30 minutes;
    uint256 constant FAUCET_AMOUNT = 1_000 ether;
    uint256 constant FAUCET_COOLDOWN = 1 days;
    uint256 constant ALPHA = 5e16; // 0.05
    uint256 constant DEPOSIT = 3 * SOURCE_DEPOSIT + LLM_DEPOSIT; // 0.2 ether

    // Deployed stack held in storage so run()'s frame stays shallow (the script
    // otherwise blows past the EVM's 16-slot stack limit — "stack too deep").
    MockAgentRequester mock;
    SeerPoints points;
    SeerResolver resolver;
    SeerSettlement settlement;
    SeerMarketFactory factory;

    function run() external {
        uint256 deployerPk = vm.envUint("PRIVATE_KEY");
        // anvil key 1 — the dispute counterparty, so the audit trail shows a
        // distinct proposer and disputer.
        uint256 disputerPk =
            vm.envOr("DISPUTER_KEY", uint256(0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d));
        address deployer = vm.addr(deployerPk);
        address disputer = vm.addr(disputerPk);

        vm.startBroadcast(deployerPk);
        _deploy(deployer);

        address settle = address(settlement);
        address m0 = _create("Will ETH close above $4,000 by Friday?", 7 days, 1000 ether, 1000 ether, settle);
        address m1 =
            _create("Will the Fed cut interest rates at its June 2026 meeting?", 3 days, 750 ether, 1250 ether, settle);
        address m2 =
            _create("Will Somnia surpass 1M daily active wallets in Q3 2026?", 14 days, 1300 ether, 800 ether, settle);
        address m3 = _create("Will OpenAI release GPT-6 before 2027?", 5 days, 1030 ether, 970 ether, settle);
        address m4 =
            _create("Will a major L2 suffer a >$50M exploit this quarter?", 10 days, 965 ether, 1035 ether, settle);

        _proposeClean(m0); // 3 sources agree YES, LLM proposes YES; left in Challenge
        _proposeContested(m1); // stale source skews optimistic pass to YES
        vm.stopBroadcast();

        // Disputer posts a matching bond + fronts the (zero) escalation deposit.
        vm.startBroadcast(disputerPk);
        factory.faucet();
        resolver.dispute{value: 0}(m1);
        vm.stopBroadcast();

        // Escalation committee reverses the verdict to NO, then settle the market.
        vm.startBroadcast(deployerPk);
        _escalateTo(m1, 2); // 2 = No
        settlement.settle(m1);
        vm.stopBroadcast();

        console2.log("MockAgentRequester:", address(mock));
        console2.log("SeerPoints        :", address(points));
        console2.log("SeerResolver      :", address(resolver));
        console2.log("SeerSettlement    :", address(settlement));
        console2.log("SeerMarketFactory :", address(factory));
        console2.log("deployer/proposer :", deployer);
        console2.log("disputer          :", disputer);
        console2.log("market0 YES (challenge - finalize via cast):", m0);
        console2.log("market1 NO  (disputed + reversed + settled):", m1);
        console2.log("market2 open:", m2);
        console2.log("market3 open:", m3);
        console2.log("market4 open:", m4);
    }

    function _deploy(address deployer) internal {
        mock = new MockAgentRequester();
        points = new SeerPoints(deployer);
        resolver = new SeerResolver(
            address(mock), address(points), deployer, 1, 2, SOURCE_DEPOSIT, LLM_DEPOSIT, RESOLUTION_BOND, CHALLENGE_WINDOW
        );
        settlement = new SeerSettlement(address(resolver));
        factory = new SeerMarketFactory(address(points), deployer, SUBSIDY_CAP, MIN_ALPHA, MAX_ALPHA);

        points.setOperator(address(resolver), true);
        points.transferOwnership(address(factory));
        factory.acceptPointsOwnership();
        factory.setReactor(deployer);
        factory.setFaucet(FAUCET_AMOUNT, FAUCET_COOLDOWN);

        // Fund the proposer with Points for the two resolution bonds.
        factory.faucet();
    }

    function _proposeClean(address mkt) internal {
        string[3] memory sources = [
            '{"provider":"coingecko","metric":"ETH/USD spot","value":4182.55,"resolves":"YES"}',
            '{"provider":"coinbase","metric":"ETH-USD spot","value":4180.10,"resolves":"YES"}',
            '{"provider":"kraken","metric":"XETHZUSD last","value":4179.80,"resolves":"YES"}'
        ];
        _propose(mkt, sources, 1);
    }

    function _proposeContested(address mkt) internal {
        string[3] memory sources = [
            '{"provider":"fed-rss","headline":"FOMC holds rates steady","resolves":"NO"}',
            '{"provider":"newswire-cache","headline":"Markets price a June cut","resolves":"YES (stale)"}',
            '{"provider":"cme-fedwatch","metric":"June cut probability","value":0.18,"resolves":"NO"}'
        ];
        _propose(mkt, sources, 1);
    }

    function _escalateTo(address mkt, uint8 verdict) internal {
        uint256 escId = resolver.escalationRequestIdOf(mkt);
        bytes[] memory escWrap = new bytes[](1);
        escWrap[0] = abi.encode(verdict);
        mock.simulateCallback(escId, escWrap, IAgentRequester.ResponseStatus.Succeeded);
    }

    function _create(string memory q, uint256 offset, uint256 seedYes, uint256 seedNo, address res)
        internal
        returns (address mkt)
    {
        (mkt,) = factory.createMarket(q, block.timestamp + offset, ALPHA, seedYes, seedNo, res);
    }

    function _propose(address mkt, string[3] memory sourceResponses, uint8 verdict) internal {
        bytes[] memory srcs = new bytes[](3);
        srcs[0] = abi.encode("https://api.coingecko.com/api/v3/simple/price", "ethereum.usd", uint8(2));
        srcs[1] = abi.encode("https://api.coinbase.com/v2/prices/ETH-USD/spot", "data.amount", uint8(2));
        srcs[2] = abi.encode("https://api.kraken.com/0/public/Ticker", "result.XETHZUSD.c[0]", uint8(2));
        bytes memory prompt = bytes(
            "Given the three source payloads, decide the market question. Reply abi-encoded uint8: 0=Invalid, 1=Yes, 2=No."
        );
        uint256[3] memory ids = resolver.requestResolution{value: DEPOSIT}(mkt, srcs, prompt);

        for (uint256 i = 0; i < 3; ++i) {
            bytes[] memory data = new bytes[](1);
            data[0] = bytes(sourceResponses[i]);
            mock.simulateCallback(ids[i], data, IAgentRequester.ResponseStatus.Succeeded);
        }

        uint256 llmId = resolver.llmRequestIdOf(mkt);
        bytes[] memory v = new bytes[](1);
        v[0] = abi.encode(verdict);
        mock.simulateCallback(llmId, v, IAgentRequester.ResponseStatus.Succeeded);
    }
}

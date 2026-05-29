// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// Minimal view of SeerResolver used by SeerMarket / SeerMarketFactory for the
// reactive auto-resolution path (Tasks Q + R). A market kicks off its own
// bonded resolution by calling requestResolution and posting the bond it was
// pre-funded with; the factory reads bondAmount to size that pre-funding.
interface ISeerResolver {
    function requestResolution(address market, bytes[] calldata sources, bytes calldata inferencePrompt)
        external
        payable
        returns (uint256[3] memory requestIds);

    function bondAmount() external view returns (uint256);
}

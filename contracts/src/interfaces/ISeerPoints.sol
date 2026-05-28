// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface ISeerPoints {
    function balanceOf(address) external view returns (uint256);
    function totalSupply() external view returns (uint256);
    function isOperator(address) external view returns (bool);
    function mint(address to, uint256 amount) external;
    function burn(address from, uint256 amount) external;
    function setOperator(address op, bool allowed) external;
    function operatorTransfer(address from, address to, uint256 amount) external;
}

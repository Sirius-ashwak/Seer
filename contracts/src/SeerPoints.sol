// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// Soulbound, non-transferable ERC-20-like settlement asset for SEER v1.
// All transfer/approve paths revert. Only the owner (set to the SEER
// settlement contract in production) can mint and burn.
contract SeerPoints {
    string public constant name = "SEER Points";
    string public constant symbol = "SEER";
    uint8 public constant decimals = 18;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => bool) public isOperator;

    address public owner;
    address public pendingOwner;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event OperatorSet(address indexed operator, bool allowed);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error Soulbound();
    error NotOwner();
    error NotOperator();
    error NotPendingOwner();
    error ZeroAddress();
    error InsufficientBalance();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address owner_) {
        if (owner_ == address(0)) revert ZeroAddress();
        owner = owner_;
        emit OwnershipTransferred(address(0), owner_);
    }

    function mint(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        totalSupply += amount;
        unchecked { balanceOf[to] += amount; }
        emit Transfer(address(0), to, amount);
    }

    function burn(address from, uint256 amount) external onlyOwner {
        uint256 bal = balanceOf[from];
        if (bal < amount) revert InsufficientBalance();
        unchecked {
            balanceOf[from] = bal - amount;
            totalSupply -= amount;
        }
        emit Transfer(from, address(0), amount);
    }

    // Set or revoke an operator (SEER market or settlement contract). Operators
    // can move Points between any two addresses via operatorTransfer — the
    // soulbound check is bypassed only for this single function, so plain
    // trader-to-trader transfers still revert.
    function setOperator(address op, bool allowed) external onlyOwner {
        if (op == address(0)) revert ZeroAddress();
        isOperator[op] = allowed;
        emit OperatorSet(op, allowed);
    }

    function operatorTransfer(address from, address to, uint256 amount) external {
        if (!isOperator[msg.sender]) revert NotOperator();
        if (from == address(0) || to == address(0)) revert ZeroAddress();
        uint256 bal = balanceOf[from];
        if (bal < amount) revert InsufficientBalance();
        unchecked {
            balanceOf[from] = bal - amount;
            balanceOf[to] += amount;
        }
        emit Transfer(from, to, amount);
    }

    function transfer(address, uint256) external pure returns (bool) {
        revert Soulbound();
    }

    function transferFrom(address, address, uint256) external pure returns (bool) {
        revert Soulbound();
    }

    function approve(address, uint256) external pure returns (bool) {
        revert Soulbound();
    }

    function allowance(address, address) external pure returns (uint256) {
        return 0;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();
        address previous = owner;
        owner = pendingOwner;
        pendingOwner = address(0);
        emit OwnershipTransferred(previous, msg.sender);
    }
}

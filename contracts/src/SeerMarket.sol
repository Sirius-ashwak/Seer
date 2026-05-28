// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ReentrancyGuard} from "solady/utils/ReentrancyGuard.sol";

import {LsLmsr} from "./lib/LsLmsr.sol";
import {ISeerPoints} from "./interfaces/ISeerPoints.sol";

// One LS-LMSR binary prediction market. Holds qYes/qNo on the curve, tracks
// per-trader share balances internally (no transferable share tokens in v1),
// escrows SEER Points as collateral via the points contract's operator path.
//
// Lifecycle: Open (trading) → Resolved/Invalid (claims). The configured
// resolver address — Settlement contract in production, EOA in tests —
// is the only address allowed to call resolve().
contract SeerMarket is ReentrancyGuard {
    enum Side { Yes, No }
    enum Outcome { Pending, Yes, No, Invalid }

    ISeerPoints public immutable points;
    address public immutable resolver;
    address public immutable factory;
    string public question;
    uint256 public immutable deadline;
    uint256 public immutable alphaWad;

    uint256 public qYes;
    uint256 public qNo;
    Outcome public outcome;

    mapping(address => uint256) public yesOf;
    mapping(address => uint256) public noOf;
    mapping(address => uint256) public collateralOf; // for Invalid refunds
    mapping(address => bool) public claimed;

    event Bought(address indexed trader, Side side, uint256 shares, uint256 cost);
    event Sold(address indexed trader, Side side, uint256 shares, uint256 payout);
    event Resolved(Outcome outcome);
    event Claimed(address indexed trader, uint256 amount);

    error TradingClosed();
    error SlippageTooHigh();
    error SlippageTooLow();
    error InsufficientShares();
    error ZeroShares();
    error NotResolver();
    error AlreadyResolved();
    error NotResolved();
    error InvalidOutcome();
    error AlreadyClaimed();
    error NothingToClaim();

    constructor(
        address points_,
        address resolver_,
        string memory question_,
        uint256 deadline_,
        uint256 alphaWad_,
        uint256 seedYes_,
        uint256 seedNo_
    ) {
        points = ISeerPoints(points_);
        resolver = resolver_;
        question = question_;
        deadline = deadline_;
        alphaWad = alphaWad_;
        qYes = seedYes_;
        qNo = seedNo_;
        factory = msg.sender;
    }

    // ─── Trading ─────────────────────────────────────────────────────────────

    function buy(Side side, uint256 shares, uint256 maxCost)
        external
        nonReentrant
        returns (uint256 cost)
    {
        if (shares == 0) revert ZeroShares();
        if (block.timestamp >= deadline || outcome != Outcome.Pending) revert TradingClosed();

        (uint256 dY, uint256 dN) = side == Side.Yes ? (shares, uint256(0)) : (uint256(0), shares);
        cost = LsLmsr.costDelta(qYes, qNo, dY, dN, alphaWad);
        if (cost > maxCost) revert SlippageTooHigh();

        qYes += dY;
        qNo += dN;
        if (side == Side.Yes) yesOf[msg.sender] += shares;
        else noOf[msg.sender] += shares;
        collateralOf[msg.sender] += cost;

        points.operatorTransfer(msg.sender, address(this), cost);
        emit Bought(msg.sender, side, shares, cost);
    }

    function sell(Side side, uint256 shares, uint256 minPayout)
        external
        nonReentrant
        returns (uint256 payout)
    {
        if (shares == 0) revert ZeroShares();
        if (block.timestamp >= deadline || outcome != Outcome.Pending) revert TradingClosed();

        if (side == Side.Yes) {
            if (yesOf[msg.sender] < shares) revert InsufficientShares();
        } else {
            if (noOf[msg.sender] < shares) revert InsufficientShares();
        }

        (uint256 dY, uint256 dN) = side == Side.Yes ? (shares, uint256(0)) : (uint256(0), shares);
        uint256 qYesNew = qYes - dY;
        uint256 qNoNew = qNo - dN;
        // payout = cost(qYes, qNo) - cost(qYesNew, qNoNew)
        //        = costDelta(qYesNew, qNoNew, dY, dN, alpha)   (selling reverses the move)
        payout = LsLmsr.costDelta(qYesNew, qNoNew, dY, dN, alphaWad);
        if (payout < minPayout) revert SlippageTooLow();

        qYes = qYesNew;
        qNo = qNoNew;
        if (side == Side.Yes) yesOf[msg.sender] -= shares;
        else noOf[msg.sender] -= shares;

        // For Invalid-bucket refunds we track net collateral paid in. Sells
        // reduce the trader's outstanding "paid" basis so a later refund only
        // returns the net.
        uint256 owed = collateralOf[msg.sender];
        collateralOf[msg.sender] = payout >= owed ? 0 : owed - payout;

        points.operatorTransfer(address(this), msg.sender, payout);
        emit Sold(msg.sender, side, shares, payout);
    }

    // ─── Resolution ──────────────────────────────────────────────────────────

    function resolve(Outcome outcome_) external {
        if (msg.sender != resolver) revert NotResolver();
        if (outcome != Outcome.Pending) revert AlreadyResolved();
        if (outcome_ == Outcome.Pending) revert InvalidOutcome();
        outcome = outcome_;
        emit Resolved(outcome_);
    }

    // Pull-payment claim: winners (and Invalid refundees) call this.
    // On YES/NO: every winning share pays out 1 SEER Point (1 WAD).
    // On Invalid: net collateral paid in is refunded.
    function claim() external nonReentrant returns (uint256 amount) {
        if (outcome == Outcome.Pending) revert NotResolved();
        if (claimed[msg.sender]) revert AlreadyClaimed();

        if (outcome == Outcome.Yes) {
            amount = yesOf[msg.sender];
        } else if (outcome == Outcome.No) {
            amount = noOf[msg.sender];
        } else {
            amount = collateralOf[msg.sender];
        }
        if (amount == 0) revert NothingToClaim();

        claimed[msg.sender] = true;
        // Zero out positions so a re-entry attempt finds nothing to claim,
        // even if the operatorTransfer hook were ever to call back (it can't
        // today — SeerPoints has no callbacks — but we keep the invariant).
        yesOf[msg.sender] = 0;
        noOf[msg.sender] = 0;
        collateralOf[msg.sender] = 0;

        points.operatorTransfer(address(this), msg.sender, amount);
        emit Claimed(msg.sender, amount);
    }

    // ─── Views ───────────────────────────────────────────────────────────────

    function priceYes() external view returns (uint256) {
        return LsLmsr.priceYes(qYes, qNo, LsLmsr.liquidity(qYes, qNo, alphaWad));
    }

    function priceNo() external view returns (uint256) {
        return LsLmsr.priceNo(qYes, qNo, LsLmsr.liquidity(qYes, qNo, alphaWad));
    }

    function liquidity() external view returns (uint256) {
        return LsLmsr.liquidity(qYes, qNo, alphaWad);
    }
}

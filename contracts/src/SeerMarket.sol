// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ReentrancyGuard} from "solady/utils/ReentrancyGuard.sol";

import {LsLmsr} from "./lib/LsLmsr.sol";
import {ISeerPoints} from "./interfaces/ISeerPoints.sol";
import {ISeerResolver} from "./interfaces/ISeerResolver.sol";

// One LS-LMSR binary prediction market. Holds qYes/qNo on the curve, tracks
// per-trader share balances internally (no transferable share tokens in v1),
// escrows SEER Points as collateral via the points contract's operator path.
//
// Lifecycle: Open (trading) → Resolved/Invalid (claims). The configured
// resolver address — Settlement contract in production, EOA in tests —
// is the only address allowed to call resolve().
//
// Auto-resolution (Tasks Q + R): when the factory deploys a market in response
// to a reactive ContractEvent, it configures the market with the oracle, the
// three source payloads, and the inference prompt, and pre-funds it with the
// oracle's bond. A Schedule subscription (or any cranker) then calls
// triggerResolution() at the deadline; the market becomes its own proposer,
// forwarding the bond and agent deposits to the oracle. No off-chain call is
// needed to start resolution.
contract SeerMarket is ReentrancyGuard {
    enum Side {
        Yes,
        No
    }
    enum Outcome {
        Pending,
        Yes,
        No,
        Invalid
    }

    ISeerPoints public immutable points;
    address public immutable resolver;
    address public immutable factory;
    string public question;
    uint256 public immutable deadline;
    uint256 public immutable alphaWad;

    // MEV guard (Task T). A trade whose size is >= largeBetBps of the current
    // pool (qYes + qNo) cannot be executed atomically: it must be committed in
    // one block and revealed in a later one. This defeats sandwich attacks,
    // which depend on wrapping the victim's trade inside a single block. A value
    // of 0 disables the guard entirely (used by direct/test deployments).
    uint256 public immutable largeBetBps;
    uint256 internal constant BPS_DENOMINATOR = 10_000;

    struct Commitment {
        bytes32 hash;
        uint256 blockNumber;
    }

    mapping(address => Commitment) public commitmentOf;

    uint256 public qYes;
    uint256 public qNo;
    Outcome public outcome;

    // Auto-resolution wiring (set once by the factory at deploy).
    address public oracle;
    bytes public autoPrompt;
    bytes[3] private _autoSources;
    bool public autoConfigured;
    bool public resolutionTriggered;

    mapping(address => uint256) public yesOf;
    mapping(address => uint256) public noOf;
    mapping(address => uint256) public collateralOf; // for Invalid refunds
    mapping(address => bool) public claimed;

    event Bought(address indexed trader, Side side, uint256 shares, uint256 cost);
    event Sold(address indexed trader, Side side, uint256 shares, uint256 payout);
    event TradeCommitted(address indexed trader, bytes32 commitment);
    event Resolved(Outcome outcome);
    event Claimed(address indexed trader, uint256 amount);
    event AutoResolutionConfigured(address indexed oracle);
    event ResolutionTriggered(uint256[3] requestIds);

    error TradingClosed();
    error SlippageTooHigh();
    error SlippageTooLow();
    error InsufficientShares();
    error ZeroShares();
    error CommitRequired();
    error NoCommitment();
    error RevealTooEarly();
    error CommitmentMismatch();
    error NotResolver();
    error AlreadyResolved();
    error NotResolved();
    error InvalidOutcome();
    error AlreadyClaimed();
    error NothingToClaim();
    error NotFactory();
    error AlreadyConfigured();
    error NotConfigured();
    error AlreadyTriggered();
    error NotYetDue();

    constructor(
        address points_,
        address resolver_,
        string memory question_,
        uint256 deadline_,
        uint256 alphaWad_,
        uint256 seedYes_,
        uint256 seedNo_,
        uint256 largeBetBps_
    ) {
        points = ISeerPoints(points_);
        resolver = resolver_;
        question = question_;
        deadline = deadline_;
        alphaWad = alphaWad_;
        qYes = seedYes_;
        qNo = seedNo_;
        largeBetBps = largeBetBps_;
        factory = msg.sender;
    }

    // ─── Trading ─────────────────────────────────────────────────────────────

    // Small trades execute atomically. A trade at or above the large-bet
    // threshold must come through the commit/reveal path so it cannot be
    // sandwiched within a single block.
    function buy(Side side, uint256 shares, uint256 maxCost) external nonReentrant returns (uint256 cost) {
        if (_isLargeBet(shares)) revert CommitRequired();
        return _buy(side, shares, maxCost);
    }

    function sell(Side side, uint256 shares, uint256 minPayout) external nonReentrant returns (uint256 payout) {
        if (_isLargeBet(shares)) revert CommitRequired();
        return _sell(side, shares, minPayout);
    }

    function _buy(Side side, uint256 shares, uint256 maxCost) internal returns (uint256 cost) {
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

    function _sell(Side side, uint256 shares, uint256 minPayout) internal returns (uint256 payout) {
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

    // ─── MEV guard: commit-reveal (Task T) ─────────────────────────────────────

    // Step 1: in block N, post the hash of an intended trade. The parameters
    // (side, size, slippage limit) stay hidden until reveal, so a searcher
    // watching the mempool learns nothing to front-run, and cannot place the
    // back-running leg in the same block because reveal is barred until N+1.
    function commitTrade(bytes32 commitment) external {
        commitmentOf[msg.sender] = Commitment({hash: commitment, blockNumber: block.number});
        emit TradeCommitted(msg.sender, commitment);
    }

    // Step 2 (block > N): reveal the parameters and execute. Slippage limits are
    // still enforced here, so an adverse price move between commit and reveal
    // simply makes the trade revert rather than fill at a bad price.
    function revealBuy(Side side, uint256 shares, uint256 maxCost, bytes32 salt)
        external
        nonReentrant
        returns (uint256 cost)
    {
        _consume(commitmentHash(true, side, shares, maxCost, salt));
        return _buy(side, shares, maxCost);
    }

    function revealSell(Side side, uint256 shares, uint256 minPayout, bytes32 salt)
        external
        nonReentrant
        returns (uint256 payout)
    {
        _consume(commitmentHash(false, side, shares, minPayout, salt));
        return _sell(side, shares, minPayout);
    }

    function _consume(bytes32 expected) internal {
        Commitment memory c = commitmentOf[msg.sender];
        if (c.hash == bytes32(0)) revert NoCommitment();
        if (block.number <= c.blockNumber) revert RevealTooEarly();
        if (c.hash != expected) revert CommitmentMismatch();
        delete commitmentOf[msg.sender];
    }

    function _isLargeBet(uint256 shares) internal view returns (bool) {
        if (largeBetBps == 0) return false;
        return shares * BPS_DENOMINATOR >= (qYes + qNo) * largeBetBps;
    }

    // ─── Resolution ──────────────────────────────────────────────────────────

    function resolve(Outcome outcome_) external {
        if (msg.sender != resolver) revert NotResolver();
        if (outcome != Outcome.Pending) revert AlreadyResolved();
        if (outcome_ == Outcome.Pending) revert InvalidOutcome();
        outcome = outcome_;
        emit Resolved(outcome_);
    }

    // ─── Auto-resolution (Tasks Q + R) ─────────────────────────────────────────

    // Called once by the factory right after deployment to arm autonomous
    // resolution: stores the oracle, the three source payloads, and the
    // inference prompt that triggerResolution() will hand to the oracle.
    function configureAutoResolution(address oracle_, bytes[3] calldata sources_, bytes calldata prompt_) external {
        if (msg.sender != factory) revert NotFactory();
        if (autoConfigured) revert AlreadyConfigured();
        oracle = oracle_;
        _autoSources[0] = sources_[0];
        _autoSources[1] = sources_[1];
        _autoSources[2] = sources_[2];
        autoPrompt = prompt_;
        autoConfigured = true;
        emit AutoResolutionConfigured(oracle_);
    }

    // Permissionless crank: once the deadline passes, anyone (in production, a
    // Schedule subscription) starts the bonded resolution. The market is its own
    // proposer — the oracle pulls the pre-funded bond from this contract and the
    // forwarded msg.value covers the agent deposits. Fires exactly once.
    function triggerResolution() external payable nonReentrant returns (uint256[3] memory requestIds) {
        if (!autoConfigured) revert NotConfigured();
        if (resolutionTriggered) revert AlreadyTriggered();
        if (block.timestamp < deadline) revert NotYetDue();

        resolutionTriggered = true;

        bytes[] memory s = new bytes[](3);
        s[0] = _autoSources[0];
        s[1] = _autoSources[1];
        s[2] = _autoSources[2];

        requestIds = ISeerResolver(oracle).requestResolution{value: msg.value}(address(this), s, autoPrompt);
        emit ResolutionTriggered(requestIds);
    }

    function autoSourceAt(uint256 i) external view returns (bytes memory) {
        return _autoSources[i];
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

    // Canonical commitment preimage. Off-chain, a trader picks a random salt and
    // hashes their intended trade with this before calling commitTrade.
    function commitmentHash(bool isBuy, Side side, uint256 shares, uint256 limit, bytes32 salt)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(isBuy, side, shares, limit, salt));
    }

    function isLargeBet(uint256 shares) external view returns (bool) {
        return _isLargeBet(shares);
    }

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

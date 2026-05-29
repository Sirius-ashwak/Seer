// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ReentrancyGuard} from "solady/utils/ReentrancyGuard.sol";

import {IAgentRequester} from "./interfaces/IAgentRequester.sol";
import {ISeerPoints} from "./interfaces/ISeerPoints.sol";
import {SeerMarket} from "./SeerMarket.sol";
import {SeerMarketFactory} from "./SeerMarketFactory.sol";

// SeerSignalAgent — Tasks O + P (Discovery & Orchestration).
//
// Discovery side of the autonomous pipeline. Anyone proposes a candidate market
// by posting a creation bond and the market params; the agent fans the
// candidate out to an LLM Inference agent that scores its marketability
// 0..SCORE_DENOMINATOR. A score at/above the threshold APPROVES the proposal
// and emits MarketProposed — the on-chain event a Somnia ContractEvent
// subscription turns into a SeerMarketFactory.onMarketProposed call (Task Q).
// A below-threshold score rejects the candidate and refunds the bond.
//
// The creation bond (Task P) is the anti-spam stake: it is slashed to the
// treasury if the spawned market ultimately resolves INVALID (junk), and
// refunded to the proposer if it resolves YES/NO. settleProposal() reads the
// resolved outcome through the factory's proposalId -> market binding.
//
//   propose(params) [+ bond + score deposit]
//        │  createRequest -> LLM marketability score
//        ▼
//   Pending
//        │  handleScoreResponse: score >= threshold ?
//        │       yes -> Approved + emit MarketProposed
//        │       no  -> Rejected + refund bond
//        ▼
//   Approved ──(reactor deploys + resolves the market)──►
//        │
//        │  settleProposal(id): market INVALID -> slash bond to treasury
//        ▼                       market YES/NO  -> refund bond to proposer
//   Settled
contract SeerSignalAgent is ReentrancyGuard {
    enum State {
        None,
        Pending,
        Approved,
        Rejected,
        Settled
    }

    struct Candidate {
        State state;
        address proposer;
        uint256 bond;
        uint256 scoreRequestId;
        uint256 score;
        SeerMarketFactory.MarketProposal proposal;
    }

    uint256 public constant SCORE_DENOMINATOR = 10_000;

    IAgentRequester public immutable requester;
    ISeerPoints public immutable points;
    SeerMarketFactory public immutable factory;

    address public admin;
    address public treasury; // receives slashed junk bonds
    uint256 public marketabilityAgentId;
    uint256 public scoreDeposit; // native deposit per scoring call
    uint256 public creationBond; // Points staked per proposal
    uint256 public scoreThreshold; // min score (bps) to approve

    uint256 public proposalCount;
    mapping(uint256 => Candidate) private _candidates;
    mapping(uint256 => uint256) private _proposalOfRequest; // scoreRequestId -> proposalId

    event AdminChanged(address indexed previousAdmin, address indexed newAdmin);
    event TreasuryChanged(address indexed previousTreasury, address indexed newTreasury);
    event MarketabilityAgentIdChanged(uint256 previousId, uint256 newId);
    event ScoreConfigChanged(uint256 scoreDeposit, uint256 creationBond, uint256 scoreThreshold);

    event ProposalCreated(uint256 indexed proposalId, address indexed proposer, uint256 bond, uint256 scoreRequestId);
    event ProposalScored(uint256 indexed proposalId, uint256 score, bool approved);
    event MarketProposed(
        uint256 indexed proposalId, address indexed proposer, SeerMarketFactory.MarketProposal proposal
    );
    event BondSlashed(uint256 indexed proposalId, address indexed proposer, uint256 amount);
    event BondRefunded(uint256 indexed proposalId, address indexed proposer, uint256 amount);

    error NotAdmin();
    error NotRequester();
    error UnknownRequest();
    error ZeroAddress();
    error WrongDeposit(uint256 sent, uint256 expected);
    error NotPending();
    error NotApproved();
    error NotDeployed();
    error NotResolved();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    constructor(
        address requester_,
        address points_,
        address factory_,
        address admin_,
        address treasury_,
        uint256 marketabilityAgentId_,
        uint256 scoreDeposit_,
        uint256 creationBond_,
        uint256 scoreThreshold_
    ) {
        if (
            requester_ == address(0) || points_ == address(0) || factory_ == address(0) || admin_ == address(0)
                || treasury_ == address(0)
        ) revert ZeroAddress();
        requester = IAgentRequester(requester_);
        points = ISeerPoints(points_);
        factory = SeerMarketFactory(factory_);
        admin = admin_;
        treasury = treasury_;
        marketabilityAgentId = marketabilityAgentId_;
        scoreDeposit = scoreDeposit_;
        creationBond = creationBond_;
        scoreThreshold = scoreThreshold_;

        emit AdminChanged(address(0), admin_);
        emit TreasuryChanged(address(0), treasury_);
        emit MarketabilityAgentIdChanged(0, marketabilityAgentId_);
        emit ScoreConfigChanged(scoreDeposit_, creationBond_, scoreThreshold_);
    }

    // ─── Propose ──────────────────────────────────────────────────────────────

    // Stake the creation bond and request a marketability score for `params`.
    // msg.value funds the LLM scoring call; the bond is escrowed in Points (this
    // contract must be a registered Points operator). params.proposalId is
    // ignored — the agent assigns the canonical id.
    function propose(SeerMarketFactory.MarketProposal calldata params, bytes calldata scoringPayload)
        external
        payable
        nonReentrant
        returns (uint256 proposalId)
    {
        if (msg.value != scoreDeposit) revert WrongDeposit(msg.value, scoreDeposit);

        proposalId = ++proposalCount;
        Candidate storage c = _candidates[proposalId];
        c.state = State.Pending;
        c.proposer = msg.sender;
        c.bond = creationBond;
        c.proposal = params;
        c.proposal.proposalId = proposalId;

        if (creationBond > 0) points.operatorTransfer(msg.sender, address(this), creationBond);

        uint256 reqId = requester.createRequest{value: scoreDeposit}(
            marketabilityAgentId, address(this), this.handleScoreResponse.selector, scoringPayload
        );
        c.scoreRequestId = reqId;
        _proposalOfRequest[reqId] = proposalId;

        emit ProposalCreated(proposalId, msg.sender, creationBond, reqId);
    }

    // ─── Callback ─────────────────────────────────────────────────────────────

    // LLM agent returns abi.encode(uint256 score) in [0, SCORE_DENOMINATOR]. A
    // score >= scoreThreshold approves the proposal and emits MarketProposed; a
    // lower score (or a failed/empty response) rejects it and refunds the bond.
    function handleScoreResponse(
        uint256 requestId,
        IAgentRequester.Response[] calldata responses,
        IAgentRequester.ResponseStatus status,
        IAgentRequester.Request calldata /* details */
    ) external nonReentrant {
        if (msg.sender != address(requester)) revert NotRequester();
        uint256 proposalId = _proposalOfRequest[requestId];
        if (proposalId == 0) revert UnknownRequest();

        Candidate storage c = _candidates[proposalId];
        if (c.state != State.Pending) revert UnknownRequest();

        uint256 score;
        if (status == IAgentRequester.ResponseStatus.Succeeded && responses.length > 0) {
            score = abi.decode(responses[0].data, (uint256));
        }
        c.score = score;

        if (score >= scoreThreshold) {
            c.state = State.Approved;
            emit ProposalScored(proposalId, score, true);
            emit MarketProposed(proposalId, c.proposer, c.proposal);
        } else {
            c.state = State.Rejected;
            emit ProposalScored(proposalId, score, false);
            uint256 bond = c.bond;
            if (bond > 0) points.operatorTransfer(address(this), c.proposer, bond);
            emit BondRefunded(proposalId, c.proposer, bond);
        }
    }

    // ─── Settle (Task P) ────────────────────────────────────────────────────────

    // Once the market spawned by an approved proposal has resolved, settle the
    // creation bond: slash it to the treasury if the market resolved INVALID
    // (the proposal was junk), otherwise refund the proposer. Permissionless.
    function settleProposal(uint256 proposalId) external nonReentrant {
        Candidate storage c = _candidates[proposalId];
        if (c.state != State.Approved) revert NotApproved();

        address market = factory.marketForProposal(proposalId);
        if (market == address(0)) revert NotDeployed();

        SeerMarket.Outcome outcome = SeerMarket(market).outcome();
        if (outcome == SeerMarket.Outcome.Pending) revert NotResolved();

        c.state = State.Settled;
        uint256 bond = c.bond;

        if (outcome == SeerMarket.Outcome.Invalid) {
            if (bond > 0) points.operatorTransfer(address(this), treasury, bond);
            emit BondSlashed(proposalId, c.proposer, bond);
        } else {
            if (bond > 0) points.operatorTransfer(address(this), c.proposer, bond);
            emit BondRefunded(proposalId, c.proposer, bond);
        }
    }

    // ─── Views ──────────────────────────────────────────────────────────────

    function stateOf(uint256 proposalId) external view returns (State) {
        return _candidates[proposalId].state;
    }

    function proposerOf(uint256 proposalId) external view returns (address) {
        return _candidates[proposalId].proposer;
    }

    function bondOf(uint256 proposalId) external view returns (uint256) {
        return _candidates[proposalId].bond;
    }

    function scoreOf(uint256 proposalId) external view returns (uint256) {
        return _candidates[proposalId].score;
    }

    function scoreRequestIdOf(uint256 proposalId) external view returns (uint256) {
        return _candidates[proposalId].scoreRequestId;
    }

    function proposalOf(uint256 proposalId) external view returns (SeerMarketFactory.MarketProposal memory) {
        return _candidates[proposalId].proposal;
    }

    // ─── Admin ──────────────────────────────────────────────────────────────

    function setAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert ZeroAddress();
        emit AdminChanged(admin, newAdmin);
        admin = newAdmin;
    }

    function setTreasury(address newTreasury) external onlyAdmin {
        if (newTreasury == address(0)) revert ZeroAddress();
        emit TreasuryChanged(treasury, newTreasury);
        treasury = newTreasury;
    }

    function setMarketabilityAgentId(uint256 id) external onlyAdmin {
        emit MarketabilityAgentIdChanged(marketabilityAgentId, id);
        marketabilityAgentId = id;
    }

    function setScoreConfig(uint256 scoreDeposit_, uint256 creationBond_, uint256 scoreThreshold_) external onlyAdmin {
        scoreDeposit = scoreDeposit_;
        creationBond = creationBond_;
        scoreThreshold = scoreThreshold_;
        emit ScoreConfigChanged(scoreDeposit_, creationBond_, scoreThreshold_);
    }
}

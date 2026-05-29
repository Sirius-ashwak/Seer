// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ReentrancyGuard} from "solady/utils/ReentrancyGuard.sol";

import {IAgentRequester} from "./interfaces/IAgentRequester.sol";
import {ISeerPoints} from "./interfaces/ISeerPoints.sol";

// SeerResolver — Tasks H + I + J + K + L (Phase 2: Resolution Security).
//
// Three-source resolution with LLM Inference synthesis, wrapped in a bonded
// optimistic-resolution lifecycle with disputes, escalation, slashing, and an
// INVALID/refund safety net. One resolver instance manages many markets.
//
// Proposer model is agent-as-proposer (Tech Arch §10 step 1): whoever calls
// requestResolution posts a SEER Points bond up front and the LLM verdict that
// lands becomes the *proposed* outcome — there is no separate proposeOutcome()
// call. A challenge window then opens; the outcome is not final (and no
// downstream payout can happen) until finalize() locks it.
//
// Lifecycle for a single market resolution cycle:
//
//   requestResolution(market, sources[3], prompt)   [+ Points bond]
//     │  fires 3 JSON API Requests, one per caller-supplied source payload
//     ▼
//   Phase.AwaitingSources
//     │  handleSourceResponse() collects each Response into sourceData[i]
//     │  once 3 responses are in, _fireInference() runs automatically
//     ▼
//   Phase.AwaitingInference
//     │  handleInferenceResponse() decodes abi.encode(uint8 v):
//     │    0 → Invalid, 1 → Yes, 2 → No  (empty / failed → Invalid)
//     │  the decoded value becomes proposedOutcome and a challenge window opens
//     ▼
//   Phase.Challenge   (challengeDeadline = now + challengeWindow)
//     │  dispute(): disputer posts a matching bond + fronts the escalation
//     │    deposit; re-resolution fires via createAdvancedRequest (larger
//     │    subcommittee, stricter threshold) ──► Phase.Disputed
//     │  finalize() after the deadline (undisputed) returns the bond and locks
//     ▼
//   Phase.Disputed
//     │  handleEscalationResponse(): escalation verdict settles the dispute.
//     │    winner gets ownBond + loserBond − fee (Task K); a no-consensus
//     │    INVALID refunds both bonds (Task L).
//     ▼
//   Phase.Finalized + finalOutcomeOf(market) populated
//
// Safety net (Task L): timeoutResolution() forces INVALID + refunds every bond
// if the agent flow or an escalation stalls past resolutionTimeout — no path
// locks funds. Source-diversity / sanitization remain Tasks M / N on top.
contract SeerResolver is ReentrancyGuard {
    uint256 public constant SOURCES = 3;
    uint256 public constant MAX_FEE_BPS = 2_000; // 20% cap on the protocol fee
    uint256 internal constant BPS_DENOMINATOR = 10_000;

    enum Phase {
        None,
        AwaitingSources,
        AwaitingInference,
        Challenge,
        Disputed,
        Finalized
    }
    enum Outcome {
        None,
        Invalid,
        Yes,
        No
    }

    struct Resolution {
        Phase phase;
        Outcome proposedOutcome;
        Outcome finalOutcome;
        uint8 sourcesReceived;
        address proposer;
        address disputer;
        uint256 bond;
        uint256 disputerBond;
        uint256 llmRequestId;
        uint256 escalationRequestId;
        uint256 proposedAt;
        uint256 challengeDeadline;
        uint256 requestDeadline;
        uint256 finalizedAt;
        uint256[SOURCES] sourceRequestIds;
        bytes[SOURCES] sourceData;
        bytes llmRawResponse;
        bytes inferencePrompt;
    }

    struct SourceRef {
        address market;
        uint8 index;
        bool exists;
    }

    IAgentRequester public immutable requester;
    ISeerPoints public immutable points;
    address public admin;
    uint256 public jsonApiAgentId;
    uint256 public llmAgentId;
    uint256 public sourceCallDeposit;
    uint256 public llmCallDeposit;
    uint256 public bondAmount;
    uint256 public challengeWindow;

    // Dispute / escalation config (Tasks J–L). Set with sensible defaults in the
    // constructor; tunable by admin.
    uint256 public escalationDeposit;
    uint256 public escalationSubcommitteeSize;
    uint256 public escalationThreshold;
    IAgentRequester.ConsensusType public escalationConsensusType;
    uint256 public escalationCallTimeout;
    uint256 public protocolFeeBps;
    address public feeRecipient;
    uint256 public resolutionTimeout;

    mapping(address => Resolution) private _resolutions;
    mapping(uint256 => SourceRef) private _sourceRefOf;
    mapping(uint256 => address) private _inferenceMarketOf;
    mapping(uint256 => address) private _escalationMarketOf;

    event AdminChanged(address indexed previousAdmin, address indexed newAdmin);
    event JsonApiAgentIdChanged(uint256 previousId, uint256 newId);
    event LlmAgentIdChanged(uint256 previousId, uint256 newId);
    event DepositsChanged(uint256 sourceCallDeposit, uint256 llmCallDeposit);
    event BondAmountChanged(uint256 previousAmount, uint256 newAmount);
    event ChallengeWindowChanged(uint256 previousWindow, uint256 newWindow);
    event EscalationParamsChanged(
        uint256 subcommitteeSize, uint256 threshold, IAgentRequester.ConsensusType consensusType, uint256 callTimeout
    );
    event EscalationDepositChanged(uint256 previousDeposit, uint256 newDeposit);
    event ProtocolFeeChanged(uint256 feeBps, address feeRecipient);
    event ResolutionTimeoutChanged(uint256 previousTimeout, uint256 newTimeout);

    event ResolutionRequested(address indexed market, uint256[SOURCES] sourceRequestIds, bytes inferencePrompt);
    event BondPosted(address indexed market, address indexed proposer, uint256 amount);
    event SourceReceived(
        address indexed market, uint8 indexed index, uint256 indexed requestId, IAgentRequester.ResponseStatus status
    );
    event InferenceRequested(address indexed market, uint256 indexed llmRequestId);
    event OutcomeProposed(
        address indexed market,
        Outcome outcome,
        uint256 indexed llmRequestId,
        IAgentRequester.ResponseStatus status,
        uint256 challengeDeadline
    );
    event Disputed(address indexed market, address indexed disputer, uint256 bond, uint256 indexed escalationRequestId);
    event BondSlashed(address indexed loser, address indexed winner, uint256 slashed, uint256 fee);
    event OutcomeFinalized(address indexed market, Outcome outcome, bool disputed);

    error NotAdmin();
    error NotRequester();
    error UnknownRequest();
    error AlreadyInProgress();
    error ZeroAddress();
    error WrongSourceCount();
    error WrongDeposit(uint256 sent, uint256 expected);
    error InvalidVerdict(uint8 raw);
    error IndexOutOfBounds();
    error NotInChallenge();
    error ChallengeWindowOpen();
    error ChallengeWindowClosed();
    error NotTimeoutable();
    error TimeoutNotReached();
    error FeeTooHigh();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    constructor(
        address requester_,
        address points_,
        address admin_,
        uint256 jsonApiAgentId_,
        uint256 llmAgentId_,
        uint256 sourceCallDeposit_,
        uint256 llmCallDeposit_,
        uint256 bondAmount_,
        uint256 challengeWindow_
    ) {
        if (requester_ == address(0) || points_ == address(0) || admin_ == address(0)) {
            revert ZeroAddress();
        }
        requester = IAgentRequester(requester_);
        points = ISeerPoints(points_);
        admin = admin_;
        jsonApiAgentId = jsonApiAgentId_;
        llmAgentId = llmAgentId_;
        sourceCallDeposit = sourceCallDeposit_;
        llmCallDeposit = llmCallDeposit_;
        bondAmount = bondAmount_;
        challengeWindow = challengeWindow_;

        // Dispute / escalation defaults: a larger, stricter subcommittee than
        // the optimistic first pass, and a generous safety-net timeout.
        escalationSubcommitteeSize = 7;
        escalationThreshold = 5;
        escalationConsensusType = IAgentRequester.ConsensusType.Threshold;
        escalationCallTimeout = 1 hours;
        resolutionTimeout = 1 days;
        feeRecipient = admin_;

        emit AdminChanged(address(0), admin_);
        emit JsonApiAgentIdChanged(0, jsonApiAgentId_);
        emit LlmAgentIdChanged(0, llmAgentId_);
        emit DepositsChanged(sourceCallDeposit_, llmCallDeposit_);
        emit BondAmountChanged(0, bondAmount_);
        emit ChallengeWindowChanged(0, challengeWindow_);
        emit EscalationParamsChanged(7, 5, IAgentRequester.ConsensusType.Threshold, 1 hours);
        emit ResolutionTimeoutChanged(0, 1 days);
        emit ProtocolFeeChanged(0, admin_);
    }

    // ─── Request ────────────────────────────────────────────────────────────

    // Anyone can kick off a fresh resolution cycle for `market`. The caller is
    // the proposer: they pay the agent deposits (msg.value) and post a SEER
    // Points bond that backs whatever outcome the agent network returns. The
    // bond is returned in full on an undisputed finalize, slashed to a
    // successful disputer (Task K), or refunded on INVALID (Task L). The caller
    // supplies the 3 source payloads (each is the JSON API Request payload for
    // one provider) plus a free-form prompt the LLM Inference agent receives
    // together with the source data.
    function requestResolution(address market, bytes[] calldata sources, bytes calldata inferencePrompt)
        external
        payable
        nonReentrant
        returns (uint256[SOURCES] memory requestIds)
    {
        if (market == address(0)) revert ZeroAddress();
        if (sources.length != SOURCES) revert WrongSourceCount();

        uint256 expected = SOURCES * sourceCallDeposit + llmCallDeposit;
        if (msg.value != expected) revert WrongDeposit(msg.value, expected);

        Resolution storage r = _resolutions[market];
        if (r.phase != Phase.None && r.phase != Phase.Finalized) revert AlreadyInProgress();

        // Drop secondary indexes from any prior cycle before wiping state.
        for (uint8 i = 0; i < SOURCES; ++i) {
            uint256 prior = r.sourceRequestIds[i];
            if (prior != 0) delete _sourceRefOf[prior];
        }
        if (r.llmRequestId != 0) delete _inferenceMarketOf[r.llmRequestId];
        if (r.escalationRequestId != 0) delete _escalationMarketOf[r.escalationRequestId];
        delete _resolutions[market];

        uint256 bond = bondAmount;
        r.phase = Phase.AwaitingSources;
        r.inferencePrompt = inferencePrompt;
        r.proposer = msg.sender;
        r.bond = bond;
        r.requestDeadline = block.timestamp + resolutionTimeout;

        // Escrow the proposer's bond. Points are soulbound, so this routes
        // through the operator path — the resolver must be a registered Points
        // operator (wired at deploy, like SeerMarket).
        if (bond > 0) points.operatorTransfer(msg.sender, address(this), bond);

        for (uint8 i = 0; i < SOURCES; ++i) {
            uint256 reqId = requester.createRequest{value: sourceCallDeposit}(
                jsonApiAgentId, address(this), this.handleSourceResponse.selector, sources[i]
            );
            r.sourceRequestIds[i] = reqId;
            _sourceRefOf[reqId] = SourceRef({market: market, index: i, exists: true});
            requestIds[i] = reqId;
        }

        emit BondPosted(market, msg.sender, bond);
        emit ResolutionRequested(market, requestIds, inferencePrompt);
    }

    // ─── Callbacks ──────────────────────────────────────────────────────────

    function handleSourceResponse(
        uint256 requestId,
        IAgentRequester.Response[] calldata responses,
        IAgentRequester.ResponseStatus status,
        IAgentRequester.Request calldata /* details */
    ) external {
        if (msg.sender != address(requester)) revert NotRequester();
        SourceRef memory ref = _sourceRefOf[requestId];
        if (!ref.exists) revert UnknownRequest();

        Resolution storage r = _resolutions[ref.market];
        if (r.phase != Phase.AwaitingSources) revert UnknownRequest();

        bytes memory data;
        if (responses.length > 0) data = responses[0].data;
        r.sourceData[ref.index] = data;
        r.sourcesReceived += 1;

        emit SourceReceived(ref.market, ref.index, requestId, status);

        if (r.sourcesReceived == SOURCES) {
            _fireInference(ref.market);
        }
    }

    function handleInferenceResponse(
        uint256 requestId,
        IAgentRequester.Response[] calldata responses,
        IAgentRequester.ResponseStatus status,
        IAgentRequester.Request calldata /* details */
    ) external {
        if (msg.sender != address(requester)) revert NotRequester();
        address market = _inferenceMarketOf[requestId];
        if (market == address(0)) revert UnknownRequest();

        Resolution storage r = _resolutions[market];
        if (r.phase != Phase.AwaitingInference) revert UnknownRequest();

        Outcome outcome;
        if (status == IAgentRequester.ResponseStatus.Succeeded && responses.length > 0) {
            r.llmRawResponse = responses[0].data;
            outcome = _decodeOutcome(responses[0].data);
        } else {
            outcome = Outcome.Invalid;
        }

        // The verdict is a *proposal*: it opens a challenge window rather than
        // settling immediately. finalize() or dispute() takes it from here. No
        // downstream payout is possible until finalOutcome is set.
        uint256 deadline = block.timestamp + challengeWindow;
        r.proposedOutcome = outcome;
        r.phase = Phase.Challenge;
        r.proposedAt = block.timestamp;
        r.challengeDeadline = deadline;

        emit OutcomeProposed(market, outcome, requestId, status, deadline);
    }

    function handleEscalationResponse(
        uint256 requestId,
        IAgentRequester.Response[] calldata responses,
        IAgentRequester.ResponseStatus status,
        IAgentRequester.Request calldata /* details */
    ) external nonReentrant {
        if (msg.sender != address(requester)) revert NotRequester();
        address market = _escalationMarketOf[requestId];
        if (market == address(0)) revert UnknownRequest();

        Resolution storage r = _resolutions[market];
        if (r.phase != Phase.Disputed) revert UnknownRequest();

        // No-consensus / failed escalation resolves INVALID and refunds both
        // bonds (Task L) — lying is punished, but an honest stalemate is not.
        Outcome esc;
        if (status == IAgentRequester.ResponseStatus.Succeeded && responses.length > 0) {
            r.llmRawResponse = responses[0].data;
            esc = _decodeOutcome(responses[0].data);
        } else {
            esc = Outcome.Invalid;
        }

        r.finalOutcome = esc;
        r.phase = Phase.Finalized;
        r.finalizedAt = block.timestamp;

        _settleDispute(r, esc);

        emit OutcomeFinalized(market, esc, true);
    }

    // ─── Dispute (Task J) ─────────────────────────────────────────────────────

    // During the challenge window, any address can dispute the proposed outcome
    // by posting a matching Points bond and fronting the native escalation
    // deposit. This freezes the outcome and re-resolves it via a larger, fresh
    // subcommittee with a stricter threshold (Tech Arch §10 steps 3–4).
    function dispute(address market) external payable nonReentrant {
        Resolution storage r = _resolutions[market];
        if (r.phase != Phase.Challenge) revert NotInChallenge();
        if (block.timestamp >= r.challengeDeadline) revert ChallengeWindowClosed();
        if (msg.value != escalationDeposit) revert WrongDeposit(msg.value, escalationDeposit);

        uint256 dbond = r.bond; // disputer matches the proposer's bond
        r.disputer = msg.sender;
        r.disputerBond = dbond;
        r.phase = Phase.Disputed;
        r.requestDeadline = block.timestamp + resolutionTimeout;

        if (dbond > 0) points.operatorTransfer(msg.sender, address(this), dbond);

        bytes memory payload = abi.encode(r.inferencePrompt, r.sourceData[0], r.sourceData[1], r.sourceData[2]);
        uint256 reqId = requester.createAdvancedRequest{value: escalationDeposit}(
            llmAgentId,
            address(this),
            this.handleEscalationResponse.selector,
            payload,
            escalationSubcommitteeSize,
            escalationThreshold,
            escalationConsensusType,
            escalationCallTimeout
        );
        r.escalationRequestId = reqId;
        _escalationMarketOf[reqId] = market;

        emit Disputed(market, msg.sender, dbond, reqId);
    }

    // ─── Finalize / timeout ────────────────────────────────────────────────────

    // Permissionless crank: once the challenge window has elapsed with no
    // dispute, lock the proposed outcome as final and return the proposer's
    // bond. Settlement (Task S) reads finalOutcomeOf only after isFinalized.
    function finalize(address market) external nonReentrant {
        Resolution storage r = _resolutions[market];
        if (r.phase != Phase.Challenge) revert NotInChallenge();
        if (block.timestamp < r.challengeDeadline) revert ChallengeWindowOpen();

        r.finalOutcome = r.proposedOutcome;
        r.phase = Phase.Finalized;
        r.finalizedAt = block.timestamp;

        uint256 bond = r.bond;
        if (bond > 0) points.operatorTransfer(address(this), r.proposer, bond);

        emit OutcomeFinalized(market, r.finalOutcome, false);
    }

    // Safety net (Task L): if the agent flow stalls before producing a verdict,
    // or an escalation never returns, anyone can force the market INVALID after
    // resolutionTimeout. Every posted bond is refunded — a stuck market never
    // locks funds. The Challenge phase is excluded: it self-resolves via
    // finalize() once challengeDeadline passes.
    function timeoutResolution(address market) external nonReentrant {
        Resolution storage r = _resolutions[market];
        Phase p = r.phase;
        if (p != Phase.AwaitingSources && p != Phase.AwaitingInference && p != Phase.Disputed) revert NotTimeoutable();
        if (block.timestamp < r.requestDeadline) revert TimeoutNotReached();

        r.finalOutcome = Outcome.Invalid;
        r.phase = Phase.Finalized;
        r.finalizedAt = block.timestamp;

        uint256 pBond = r.bond;
        if (pBond > 0) points.operatorTransfer(address(this), r.proposer, pBond);
        if (p == Phase.Disputed) {
            uint256 dBond = r.disputerBond;
            if (dBond > 0) points.operatorTransfer(address(this), r.disputer, dBond);
        }

        emit OutcomeFinalized(market, Outcome.Invalid, p == Phase.Disputed);
    }

    // ─── Internal ───────────────────────────────────────────────────────────

    function _fireInference(address market) internal {
        Resolution storage r = _resolutions[market];
        bytes memory payload = abi.encode(r.inferencePrompt, r.sourceData[0], r.sourceData[1], r.sourceData[2]);
        uint256 reqId = requester.createRequest{value: llmCallDeposit}(
            llmAgentId, address(this), this.handleInferenceResponse.selector, payload
        );
        r.llmRequestId = reqId;
        r.phase = Phase.AwaitingInference;
        _inferenceMarketOf[reqId] = market;
        emit InferenceRequested(market, reqId);
    }

    // Settle the bonds after an escalation verdict (Tasks K + L). Total Points
    // are conserved: pBond + dBond == payout + fee.
    function _settleDispute(Resolution storage r, Outcome esc) internal {
        address proposer = r.proposer;
        address disputer = r.disputer;
        uint256 pBond = r.bond;
        uint256 dBond = r.disputerBond;

        if (esc == Outcome.Invalid) {
            // No-consensus / unresolvable: refund both bonds, no slash (Task L).
            if (pBond > 0) points.operatorTransfer(address(this), proposer, pBond);
            if (dBond > 0) points.operatorTransfer(address(this), disputer, dBond);
            return;
        }

        // Slash the loser's bond to the winner minus a protocol fee (Task K).
        if (esc == r.proposedOutcome) {
            // Proposer was right; the disputer's bond is slashed.
            uint256 fee = (dBond * protocolFeeBps) / BPS_DENOMINATOR;
            uint256 payout = pBond + dBond - fee;
            if (payout > 0) points.operatorTransfer(address(this), proposer, payout);
            if (fee > 0) points.operatorTransfer(address(this), feeRecipient, fee);
            emit BondSlashed(disputer, proposer, dBond, fee);
        } else {
            // Disputer overturned the outcome; the proposer's bond is slashed.
            uint256 fee = (pBond * protocolFeeBps) / BPS_DENOMINATOR;
            uint256 payout = pBond + dBond - fee;
            if (payout > 0) points.operatorTransfer(address(this), disputer, payout);
            if (fee > 0) points.operatorTransfer(address(this), feeRecipient, fee);
            emit BondSlashed(proposer, disputer, pBond, fee);
        }
    }

    // LLM agent emits abi.encode(uint8 verdict):
    //   0 → Invalid, 1 → Yes, 2 → No.
    // Empty / failed inference is mapped to Invalid by the caller above.
    function _decodeOutcome(bytes memory raw) internal pure returns (Outcome) {
        if (raw.length == 0) return Outcome.Invalid;
        uint8 v = abi.decode(raw, (uint8));
        if (v == 0) return Outcome.Invalid;
        if (v == 1) return Outcome.Yes;
        if (v == 2) return Outcome.No;
        revert InvalidVerdict(v);
    }

    // ─── Views ──────────────────────────────────────────────────────────────

    function phaseOf(address market) external view returns (Phase) {
        return _resolutions[market].phase;
    }

    // Settled outcome — None until the market reaches Phase.Finalized.
    function outcomeOf(address market) external view returns (Outcome) {
        return _resolutions[market].finalOutcome;
    }

    function proposedOutcomeOf(address market) external view returns (Outcome) {
        return _resolutions[market].proposedOutcome;
    }

    function finalOutcomeOf(address market) external view returns (Outcome) {
        return _resolutions[market].finalOutcome;
    }

    function isFinalized(address market) external view returns (bool) {
        return _resolutions[market].phase == Phase.Finalized;
    }

    function challengeDeadlineOf(address market) external view returns (uint256) {
        return _resolutions[market].challengeDeadline;
    }

    function requestDeadlineOf(address market) external view returns (uint256) {
        return _resolutions[market].requestDeadline;
    }

    function proposerOf(address market) external view returns (address) {
        return _resolutions[market].proposer;
    }

    function bondOf(address market) external view returns (uint256) {
        return _resolutions[market].bond;
    }

    function disputerOf(address market) external view returns (address) {
        return _resolutions[market].disputer;
    }

    function disputerBondOf(address market) external view returns (uint256) {
        return _resolutions[market].disputerBond;
    }

    function escalationRequestIdOf(address market) external view returns (uint256) {
        return _resolutions[market].escalationRequestId;
    }

    function sourcesReceivedOf(address market) external view returns (uint8) {
        return _resolutions[market].sourcesReceived;
    }

    function sourceRequestIdOf(address market, uint256 index) external view returns (uint256) {
        if (index >= SOURCES) revert IndexOutOfBounds();
        return _resolutions[market].sourceRequestIds[index];
    }

    function sourceDataOf(address market, uint256 index) external view returns (bytes memory) {
        if (index >= SOURCES) revert IndexOutOfBounds();
        return _resolutions[market].sourceData[index];
    }

    function llmRequestIdOf(address market) external view returns (uint256) {
        return _resolutions[market].llmRequestId;
    }

    function llmRawResponseOf(address market) external view returns (bytes memory) {
        return _resolutions[market].llmRawResponse;
    }

    function inferencePromptOf(address market) external view returns (bytes memory) {
        return _resolutions[market].inferencePrompt;
    }

    function proposedAtOf(address market) external view returns (uint256) {
        return _resolutions[market].proposedAt;
    }

    function finalizedAtOf(address market) external view returns (uint256) {
        return _resolutions[market].finalizedAt;
    }

    // ─── Admin ──────────────────────────────────────────────────────────────

    function setAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert ZeroAddress();
        emit AdminChanged(admin, newAdmin);
        admin = newAdmin;
    }

    function setJsonApiAgentId(uint256 id) external onlyAdmin {
        emit JsonApiAgentIdChanged(jsonApiAgentId, id);
        jsonApiAgentId = id;
    }

    function setLlmAgentId(uint256 id) external onlyAdmin {
        emit LlmAgentIdChanged(llmAgentId, id);
        llmAgentId = id;
    }

    function setDeposits(uint256 sourceCallDeposit_, uint256 llmCallDeposit_) external onlyAdmin {
        sourceCallDeposit = sourceCallDeposit_;
        llmCallDeposit = llmCallDeposit_;
        emit DepositsChanged(sourceCallDeposit_, llmCallDeposit_);
    }

    function setBondAmount(uint256 newAmount) external onlyAdmin {
        emit BondAmountChanged(bondAmount, newAmount);
        bondAmount = newAmount;
    }

    function setChallengeWindow(uint256 newWindow) external onlyAdmin {
        emit ChallengeWindowChanged(challengeWindow, newWindow);
        challengeWindow = newWindow;
    }

    function setEscalationParams(
        uint256 subcommitteeSize,
        uint256 threshold,
        IAgentRequester.ConsensusType consensusType,
        uint256 callTimeout
    ) external onlyAdmin {
        escalationSubcommitteeSize = subcommitteeSize;
        escalationThreshold = threshold;
        escalationConsensusType = consensusType;
        escalationCallTimeout = callTimeout;
        emit EscalationParamsChanged(subcommitteeSize, threshold, consensusType, callTimeout);
    }

    function setEscalationDeposit(uint256 newDeposit) external onlyAdmin {
        emit EscalationDepositChanged(escalationDeposit, newDeposit);
        escalationDeposit = newDeposit;
    }

    function setProtocolFee(uint256 feeBps, address recipient) external onlyAdmin {
        if (feeBps > MAX_FEE_BPS) revert FeeTooHigh();
        if (recipient == address(0)) revert ZeroAddress();
        protocolFeeBps = feeBps;
        feeRecipient = recipient;
        emit ProtocolFeeChanged(feeBps, recipient);
    }

    function setResolutionTimeout(uint256 newTimeout) external onlyAdmin {
        emit ResolutionTimeoutChanged(resolutionTimeout, newTimeout);
        resolutionTimeout = newTimeout;
    }
}

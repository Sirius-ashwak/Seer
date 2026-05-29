// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IAgentRequester} from "./interfaces/IAgentRequester.sol";

// SeerResolver — Task H.
//
// Three-source bonded resolution with LLM Inference synthesis. One resolver
// instance manages resolution for many markets.
//
// Lifecycle for a single market resolution cycle:
//
//   requestResolution(market, sources[3], prompt)
//     │  fires 3 JSON API Requests, one per caller-supplied source payload
//     ▼
//   Phase.AwaitingSources
//     │  handleSourceResponse() collects each Response into sourceData[i]
//     │  once 3 responses are in, _fireInference() runs automatically
//     ▼
//   Phase.AwaitingInference
//     │  handleInferenceResponse() decodes abi.encode(uint8 v):
//     │    v == 0 → Outcome.Invalid
//     │    v == 1 → Outcome.Yes
//     │    v == 2 → Outcome.No
//     ▼
//   Phase.Resolved + outcomeOf(market) populated
//
// Bonds, challenge windows, disputes, escalation, slashing, INVALID-refund
// path, and source-diversity / sanitization are Tasks I / J / K / L / M / N
// layered on top of this contract — not yet implemented here.
contract SeerResolver {
    uint256 public constant SOURCES = 3;

    enum Phase { None, AwaitingSources, AwaitingInference, Resolved }
    enum Outcome { None, Invalid, Yes, No }

    struct Resolution {
        Phase phase;
        Outcome outcome;
        uint8 sourcesReceived;
        uint256 llmRequestId;
        uint256 resolvedAt;
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
    address public admin;
    uint256 public jsonApiAgentId;
    uint256 public llmAgentId;
    uint256 public sourceCallDeposit;
    uint256 public llmCallDeposit;

    mapping(address => Resolution) private _resolutions;
    mapping(uint256 => SourceRef) private _sourceRefOf;
    mapping(uint256 => address) private _inferenceMarketOf;

    event AdminChanged(address indexed previousAdmin, address indexed newAdmin);
    event JsonApiAgentIdChanged(uint256 previousId, uint256 newId);
    event LlmAgentIdChanged(uint256 previousId, uint256 newId);
    event DepositsChanged(uint256 sourceCallDeposit, uint256 llmCallDeposit);

    event ResolutionRequested(
        address indexed market, uint256[SOURCES] sourceRequestIds, bytes inferencePrompt
    );
    event SourceReceived(
        address indexed market,
        uint8 indexed index,
        uint256 indexed requestId,
        IAgentRequester.ResponseStatus status
    );
    event InferenceRequested(address indexed market, uint256 indexed llmRequestId);
    event OutcomeProposed(
        address indexed market,
        Outcome outcome,
        uint256 indexed llmRequestId,
        IAgentRequester.ResponseStatus status
    );

    error NotAdmin();
    error NotRequester();
    error UnknownRequest();
    error AlreadyInProgress();
    error ZeroAddress();
    error WrongSourceCount();
    error WrongDeposit(uint256 sent, uint256 expected);
    error InvalidVerdict(uint8 raw);
    error IndexOutOfBounds();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    constructor(
        address requester_,
        address admin_,
        uint256 jsonApiAgentId_,
        uint256 llmAgentId_,
        uint256 sourceCallDeposit_,
        uint256 llmCallDeposit_
    ) {
        if (requester_ == address(0) || admin_ == address(0)) revert ZeroAddress();
        requester = IAgentRequester(requester_);
        admin = admin_;
        jsonApiAgentId = jsonApiAgentId_;
        llmAgentId = llmAgentId_;
        sourceCallDeposit = sourceCallDeposit_;
        llmCallDeposit = llmCallDeposit_;
        emit AdminChanged(address(0), admin_);
        emit JsonApiAgentIdChanged(0, jsonApiAgentId_);
        emit LlmAgentIdChanged(0, llmAgentId_);
        emit DepositsChanged(sourceCallDeposit_, llmCallDeposit_);
    }

    // ─── Request ────────────────────────────────────────────────────────────

    // Anyone can pay the agent deposits to kick off a fresh resolution cycle
    // for `market`. The caller supplies the 3 source payloads (each is the
    // JSON API Request payload for one provider) plus a free-form prompt the
    // LLM Inference agent will receive together with the source data.
    //
    // In Task I a proposer will additionally post a bond to claim the outcome
    // once the LLM verdict lands.
    function requestResolution(
        address market,
        bytes[] calldata sources,
        bytes calldata inferencePrompt
    ) external payable returns (uint256[SOURCES] memory requestIds) {
        if (market == address(0)) revert ZeroAddress();
        if (sources.length != SOURCES) revert WrongSourceCount();

        uint256 expected = SOURCES * sourceCallDeposit + llmCallDeposit;
        if (msg.value != expected) revert WrongDeposit(msg.value, expected);

        Resolution storage r = _resolutions[market];
        if (r.phase != Phase.None && r.phase != Phase.Resolved) revert AlreadyInProgress();

        // Drop secondary indexes from any prior cycle before wiping state.
        for (uint8 i = 0; i < SOURCES; ++i) {
            uint256 prior = r.sourceRequestIds[i];
            if (prior != 0) delete _sourceRefOf[prior];
        }
        if (r.llmRequestId != 0) delete _inferenceMarketOf[r.llmRequestId];
        delete _resolutions[market];

        r.phase = Phase.AwaitingSources;
        r.inferencePrompt = inferencePrompt;

        for (uint8 i = 0; i < SOURCES; ++i) {
            uint256 reqId = requester.createRequest{value: sourceCallDeposit}(
                jsonApiAgentId,
                address(this),
                this.handleSourceResponse.selector,
                sources[i]
            );
            r.sourceRequestIds[i] = reqId;
            _sourceRefOf[reqId] = SourceRef({market: market, index: i, exists: true});
            requestIds[i] = reqId;
        }

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

        r.outcome = outcome;
        r.phase = Phase.Resolved;
        r.resolvedAt = block.timestamp;

        emit OutcomeProposed(market, outcome, requestId, status);
    }

    // ─── Internal ───────────────────────────────────────────────────────────

    function _fireInference(address market) internal {
        Resolution storage r = _resolutions[market];
        bytes memory payload = abi.encode(
            r.inferencePrompt, r.sourceData[0], r.sourceData[1], r.sourceData[2]
        );
        uint256 reqId = requester.createRequest{value: llmCallDeposit}(
            llmAgentId, address(this), this.handleInferenceResponse.selector, payload
        );
        r.llmRequestId = reqId;
        r.phase = Phase.AwaitingInference;
        _inferenceMarketOf[reqId] = market;
        emit InferenceRequested(market, reqId);
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

    function outcomeOf(address market) external view returns (Outcome) {
        return _resolutions[market].outcome;
    }

    function sourcesReceivedOf(address market) external view returns (uint8) {
        return _resolutions[market].sourcesReceived;
    }

    function sourceRequestIdOf(address market, uint256 index)
        external
        view
        returns (uint256)
    {
        if (index >= SOURCES) revert IndexOutOfBounds();
        return _resolutions[market].sourceRequestIds[index];
    }

    function sourceDataOf(address market, uint256 index)
        external
        view
        returns (bytes memory)
    {
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

    function resolvedAtOf(address market) external view returns (uint256) {
        return _resolutions[market].resolvedAt;
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

    function setDeposits(uint256 sourceCallDeposit_, uint256 llmCallDeposit_)
        external
        onlyAdmin
    {
        sourceCallDeposit = sourceCallDeposit_;
        llmCallDeposit = llmCallDeposit_;
        emit DepositsChanged(sourceCallDeposit_, llmCallDeposit_);
    }
}

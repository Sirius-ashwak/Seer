// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ISeerPoints} from "./interfaces/ISeerPoints.sol";
import {LsLmsr} from "./lib/LsLmsr.sol";
import {SeerMarket} from "./SeerMarket.sol";
import {SeerPoints} from "./SeerPoints.sol";

// Deploys SeerMarket instances and seeds each one with the Points subsidy
// required to underwrite trading from block one.
//
// Subsidy math: the factory mints LsLmsr.cost(seedYes, seedNo, b) Points
// straight to the new market. This is the LMSR "cost" of the opening pool;
// it covers the curve's initial book value so a zero-bettor market is
// tradeable immediately (Task F's "done when" criterion).
//
// In v1 the factory holds SeerPoints ownership. Settlement will inherit
// that role once it's built (Task S) so resolution-time slashes/refunds
// can be authoritative.
contract SeerMarketFactory {
    ISeerPoints public immutable points;
    address public admin;
    uint256 public subsidyCap;
    uint256 public minAlphaWad;
    uint256 public maxAlphaWad;

    address[] private _markets;
    mapping(address => bool) public isMarket;

    event MarketCreated(
        address indexed market,
        address indexed creator,
        address indexed resolver,
        string question,
        uint256 deadline,
        uint256 alphaWad,
        uint256 seedYes,
        uint256 seedNo,
        uint256 subsidy
    );
    event AdminChanged(address indexed previousAdmin, address indexed newAdmin);
    event SubsidyCapChanged(uint256 previousCap, uint256 newCap);
    event AlphaBoundsChanged(uint256 minAlpha, uint256 maxAlpha);

    error AdminOnly();
    error ZeroAddress();
    error SubsidyExceedsCap();
    error DeadlineInPast();
    error InvalidAlpha();
    error EmptySeed();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert AdminOnly();
        _;
    }

    constructor(
        address points_,
        address admin_,
        uint256 subsidyCap_,
        uint256 minAlphaWad_,
        uint256 maxAlphaWad_
    ) {
        if (points_ == address(0) || admin_ == address(0)) revert ZeroAddress();
        if (minAlphaWad_ == 0 || maxAlphaWad_ < minAlphaWad_) revert InvalidAlpha();
        points = ISeerPoints(points_);
        admin = admin_;
        subsidyCap = subsidyCap_;
        minAlphaWad = minAlphaWad_;
        maxAlphaWad = maxAlphaWad_;
        emit AdminChanged(address(0), admin_);
        emit SubsidyCapChanged(0, subsidyCap_);
        emit AlphaBoundsChanged(minAlphaWad_, maxAlphaWad_);
    }

    function createMarket(
        string calldata question,
        uint256 deadline,
        uint256 alphaWad,
        uint256 seedYes,
        uint256 seedNo,
        address resolver
    ) external returns (address market, uint256 subsidy) {
        if (resolver == address(0)) revert ZeroAddress();
        if (deadline <= block.timestamp) revert DeadlineInPast();
        if (alphaWad < minAlphaWad || alphaWad > maxAlphaWad) revert InvalidAlpha();
        if (seedYes == 0 || seedNo == 0) revert EmptySeed();

        uint256 b = LsLmsr.liquidity(seedYes, seedNo, alphaWad);
        subsidy = LsLmsr.cost(seedYes, seedNo, b);
        if (subsidy > subsidyCap) revert SubsidyExceedsCap();

        market = address(
            new SeerMarket(address(points), resolver, question, deadline, alphaWad, seedYes, seedNo)
        );

        points.setOperator(market, true);
        points.mint(market, subsidy);

        _markets.push(market);
        isMarket[market] = true;

        emit MarketCreated(
            market, msg.sender, resolver, question, deadline, alphaWad, seedYes, seedNo, subsidy
        );
    }

    // ─── Admin ──────────────────────────────────────────────────────────────

    // Two-step Points ownership handover: the deployer calls
    // points.transferOwnership(factory), then the admin calls this to accept.
    // Anyone may call it; the underlying check on SeerPoints.acceptOwnership
    // already enforces that the caller (the factory) is the pendingOwner.
    function acceptPointsOwnership() external {
        SeerPoints(address(points)).acceptOwnership();
    }

    function setAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert ZeroAddress();
        emit AdminChanged(admin, newAdmin);
        admin = newAdmin;
    }

    function setSubsidyCap(uint256 cap) external onlyAdmin {
        emit SubsidyCapChanged(subsidyCap, cap);
        subsidyCap = cap;
    }

    function setAlphaBounds(uint256 minA, uint256 maxA) external onlyAdmin {
        if (minA == 0 || maxA < minA) revert InvalidAlpha();
        minAlphaWad = minA;
        maxAlphaWad = maxA;
        emit AlphaBoundsChanged(minA, maxA);
    }

    // ─── Views ──────────────────────────────────────────────────────────────

    function marketCount() external view returns (uint256) {
        return _markets.length;
    }

    function marketAt(uint256 i) external view returns (address) {
        return _markets[i];
    }

    function allMarkets() external view returns (address[] memory) {
        return _markets;
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {FixedPointMathLib} from "solady/utils/FixedPointMathLib.sol";

// Liquidity-sensitive LMSR math for a binary YES/NO outcome.
//
//   cost C(q_y, q_n; b) = b * ln(e^(q_y/b) + e^(q_n/b))
//   price_yes           = e^(q_y/b) / (e^(q_y/b) + e^(q_n/b))
//                       = 1 / (1 + e^((q_n - q_y)/b))         (sigmoid form)
//   b(q_y, q_n; alpha)  = alpha * (q_y + q_n)
//
// All `q`, `b`, and `alpha` are WAD-scaled (1e18). The market MUST be seeded
// with strictly positive (q_y + q_n) before any trade, otherwise b is zero and
// the cost function is undefined.
//
// Stability: every ln-of-sum-of-exps uses the log-sum-exp trick
//     ln(e^x + e^y) = max(x,y) + ln(1 + e^(min - max))
// so expWad never sees a positive argument; output range is bounded.
library LsLmsr {
    uint256 internal constant WAD = 1e18;
    int256 internal constant WAD_INT = 1e18;

    error InvalidLiquidity();
    error InvalidInput();

    function liquidity(uint256 qYes, uint256 qNo, uint256 alphaWad) internal pure returns (uint256) {
        return FixedPointMathLib.mulWad(qYes + qNo, alphaWad);
    }

    function cost(uint256 qYes, uint256 qNo, uint256 b) internal pure returns (uint256) {
        if (b == 0) revert InvalidLiquidity();
        int256 lse = _logSumExp(qYes, qNo, b);
        int256 c = (int256(b) * lse) / WAD_INT;
        if (c < 0) revert InvalidInput();
        return uint256(c);
    }

    function priceYes(uint256 qYes, uint256 qNo, uint256 b) internal pure returns (uint256) {
        if (b == 0) revert InvalidLiquidity();
        int256 diff = _signedDiv(qNo, qYes, b);
        int256 e = FixedPointMathLib.expWad(diff);
        int256 denom = WAD_INT + e;
        return uint256((WAD_INT * WAD_INT) / denom);
    }

    function priceNo(uint256 qYes, uint256 qNo, uint256 b) internal pure returns (uint256) {
        return WAD - priceYes(qYes, qNo, b);
    }

    // Cost the trader pays to move the state by (dYes, dNo). Either may be zero.
    // Both deltas are *additions* to outstanding shares; a sell is modelled by
    // calling with the share count reduced beforehand.
    //
    // Returns max(0, cNew - cOld). Integer truncation in cost() can make the
    // raw delta dip ~1 wei negative on a dust trade where the share count is
    // many orders of magnitude smaller than the existing pool. Clamping at 0
    // is safe at this layer: the market contract enforces a minimum share-size
    // per trade, so any clamp-to-zero would already be rejected upstream.
    function costDelta(uint256 qYes, uint256 qNo, uint256 dYes, uint256 dNo, uint256 alphaWad)
        internal
        pure
        returns (uint256)
    {
        uint256 bOld = liquidity(qYes, qNo, alphaWad);
        uint256 qYesNew = qYes + dYes;
        uint256 qNoNew = qNo + dNo;
        uint256 bNew = liquidity(qYesNew, qNoNew, alphaWad);
        uint256 cOld = cost(qYes, qNo, bOld);
        uint256 cNew = cost(qYesNew, qNoNew, bNew);
        return cNew > cOld ? cNew - cOld : 0;
    }

    // Returns (qNo - qYes) * WAD / b as int256, preserving sign.
    function _signedDiv(uint256 qNo, uint256 qYes, uint256 b) private pure returns (int256) {
        if (qNo >= qYes) {
            return int256(FixedPointMathLib.fullMulDiv(qNo - qYes, WAD, b));
        }
        return -int256(FixedPointMathLib.fullMulDiv(qYes - qNo, WAD, b));
    }

    function _logSumExp(uint256 qYes, uint256 qNo, uint256 b) private pure returns (int256) {
        int256 xy = int256(FixedPointMathLib.fullMulDiv(qYes, WAD, b));
        int256 xn = int256(FixedPointMathLib.fullMulDiv(qNo, WAD, b));
        int256 mx = xy > xn ? xy : xn;
        int256 mn = xy > xn ? xn : xy;
        int256 e = FixedPointMathLib.expWad(mn - mx);
        return mx + FixedPointMathLib.lnWad(WAD_INT + e);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev TEST ONLY. A token that takes a fee on every transfer. receiverPays: the receiver gets `value - fee` (the sender's
///      balance drops by `value`). senderPays: the sender's balance drops by `value + fee` and the receiver gets `value`,
///      the shape that would let a vault be drained by redeeming, if the vault did not check its invariant.
contract MockFeeToken is ERC20 {
    uint256 public immutable feeBps;
    bool public immutable senderPays;
    address private constant SINK = address(0xdEaD);

    constructor(uint256 feeBps_, bool senderPays_) ERC20("Fee Token", "FEE") { feeBps = feeBps_; senderPays = senderPays_; }
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }

    function _update(address from, address to, uint256 value) internal override {
        if (from == address(0) || to == address(0) || to == SINK) { super._update(from, to, value); return; }
        uint256 fee = (value * feeBps) / 10_000;
        if (senderPays) {
            super._update(from, to, value);
            if (fee > 0) super._update(from, SINK, fee);
        } else {
            super._update(from, to, value - fee);
            if (fee > 0) super._update(from, SINK, fee);
        }
    }
}

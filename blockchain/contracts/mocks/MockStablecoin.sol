// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/// @dev TEST ONLY. A USDC-like token: 6 decimals, permit, anyone can mint. Never deploy to a real network.
contract MockStablecoin is ERC20, ERC20Permit {
    constructor() ERC20("Mock USD Coin", "mUSDC") ERC20Permit("Mock USD Coin") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

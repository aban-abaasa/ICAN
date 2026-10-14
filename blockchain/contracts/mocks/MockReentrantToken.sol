// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface IVaultLike { function deposit(uint256) external returns (uint256); function redeem(uint256) external returns (uint256); }

/// @dev TEST ONLY. A reserve token that tries to call back into the vault in the middle of a transfer.
///      mode 1 = re-enter deposit() during transferFrom, mode 2 = re-enter redeem() during transfer.
contract MockReentrantToken is ERC20 {
    address public vault;
    uint8 public mode;
    constructor() ERC20("Reentrant", "RE") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function arm(address vault_, uint8 mode_) external { vault = vault_; mode = mode_; }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (vault != address(0)) {
            if (mode == 1 && to == vault) { uint8 m = mode; mode = 0; IVaultLike(vault).deposit(1); mode = m; }
            if (mode == 2 && from == vault) { uint8 m = mode; mode = 0; IVaultLike(vault).redeem(1); mode = m; }
        }
    }
}

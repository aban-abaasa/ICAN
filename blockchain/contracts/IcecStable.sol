// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/**
 * @title IcecStable (ICEC-S), the stable form of icaneracoin
 * @notice A US-dollar-backed token: each unit is backed 1:1 by one unit of a USD stablecoin held in the ReserveVault
 *         that deployed it. Its value stays one US dollar; in a local currency that means it rises when the local
 *         currency weakens against the dollar and falls when it strengthens. It is NOT a promise to beat inflation.
 * @dev The vault is the only address that can mint or burn, fixed at construction. There is no owner, no admin, and no
 *      other privileged function. It is an ordinary ERC-20 (with EIP-2612 permit) otherwise.
 */
contract IcecStable is ERC20, ERC20Permit {
    /// @notice The ReserveVault that issues and redeems this token. Cannot change.
    address public immutable vault;
    uint8 private immutable _decimals;

    error NotVault();

    constructor(address vault_, string memory name_, string memory symbol_, uint8 decimals_)
        ERC20(name_, symbol_)
        ERC20Permit(name_)
    {
        vault = vault_;
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        if (msg.sender != vault) revert NotVault();
        _mint(to, amount);
    }

    /// @dev Only the vault can call this, and the vault only ever burns the caller's own tokens in redeem().
    function burn(address from, uint256 amount) external {
        if (msg.sender != vault) revert NotVault();
        _burn(from, amount);
    }
}

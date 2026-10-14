// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IcecStable} from "./IcecStable.sol";

/**
 * @title ReserveVault
 * @notice Holds a USD stablecoin (the "reserve") and issues ICEC-S 1:1 against it. This is the whole mechanism that keeps
 *         ICEC-S worth one US dollar: every ICEC-S in existence is backed by one unit of the reserve token sitting in this
 *         contract, and can be redeemed for it at any time.
 *
 * What it deliberately does NOT have:
 *   - no fee (there is no fee code to configure),
 *   - no way for anyone to mint ICEC-S except by depositing the reserve (the token only obeys this contract),
 *   - no way for anyone to withdraw the backing (only a *surplus* above the supply can be swept, see sweepSurplus),
 *   - no price, no oracle, no AMM: the exchange rate is 1:1 by construction, so there is nothing to manipulate,
 *   - no upgradeability: the code you audit is the code that runs. If a bug is ever found, deploy a new vault and let
 *     users redeem from this one.
 *
 * Invariant (checked after every deposit and redeem, and tested by randomized sequences):
 *     reserve.balanceOf(vault) >= ICEC-S.totalSupply()
 *
 * Trust that remains, stated plainly: the reserve token's issuer (it can depeg, or freeze this contract's address) and
 * the correctness of this code. The guardian can pause DEPOSITS only; redemption can never be paused.
 */
contract ReserveVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice The stablecoin held as backing (for example USDC).
    IERC20 public immutable reserve;
    /// @notice The unit issued against it. Deployed by this vault, which is its only minter.
    IcecStable public immutable token;
    /// @notice Can pause deposits and sweep a surplus. In production this is a multisig, not a person.
    address public immutable guardian;

    bool public depositsPaused;

    event Deposited(address indexed account, uint256 reserveSent, uint256 minted);
    event Redeemed(address indexed account, uint256 burned, uint256 reserveReturned);
    event DepositsPausedSet(bool paused);
    event SurplusSwept(address indexed to, uint256 amount);

    error ZeroAmount();
    error DepositsArePaused();
    error NotGuardian();
    error NothingToSweep();
    error InvariantBroken();
    error ZeroAddress();

    constructor(IERC20 reserve_, address guardian_, string memory name_, string memory symbol_) {
        if (address(reserve_) == address(0) || guardian_ == address(0)) revert ZeroAddress();
        reserve = reserve_;
        guardian = guardian_;
        // ICEC-S has the same number of decimals as the reserve, so 1 base unit of one is 1 base unit of the other.
        token = new IcecStable(address(this), name_, symbol_, IERC20Metadata(address(reserve_)).decimals());
    }

    // ------------------------------------------------------------------------------------------------------------
    // Users
    // ------------------------------------------------------------------------------------------------------------

    /// @notice Deposit `amount` of the reserve token (approve first) and receive the same amount of ICEC-S.
    /// @dev ICEC-S is minted for what actually ARRIVED (balance difference), so a reserve token that charges a transfer
    ///      fee cannot make the vault issue more than it received.
    function deposit(uint256 amount) external nonReentrant returns (uint256 minted) {
        minted = _deposit(msg.sender, amount);
    }

    /// @notice Same as deposit, but sets the allowance with an EIP-2612 permit signature, so it is one transaction.
    /// @dev The permit is wrapped in try/catch: if someone front-runs the permit with the same signature, the allowance
    ///      is already set and the deposit still goes through.
    function depositWithPermit(uint256 amount, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external
        nonReentrant
        returns (uint256 minted)
    {
        try IERC20Permit(address(reserve)).permit(msg.sender, address(this), amount, deadline, v, r, s) {} catch {}
        minted = _deposit(msg.sender, amount);
    }

    /// @notice Burn `amount` of your ICEC-S and receive `amount` of the reserve token. Always available.
    function redeem(uint256 amount) external nonReentrant returns (uint256 returned) {
        if (amount == 0) revert ZeroAmount();
        token.burn(msg.sender, amount); // effects before interaction
        reserve.safeTransfer(msg.sender, amount);
        returned = amount;
        _checkInvariant();
        emit Redeemed(msg.sender, amount, returned);
    }

    // ------------------------------------------------------------------------------------------------------------
    // Guardian (a multisig in production)
    // ------------------------------------------------------------------------------------------------------------

    /// @notice Pause or resume DEPOSITS. Redemption is never affected.
    function setDepositsPaused(bool paused) external {
        if (msg.sender != guardian) revert NotGuardian();
        depositsPaused = paused;
        emit DepositsPausedSet(paused);
    }

    /// @notice Move reserve tokens held ABOVE the ICEC-S supply (for example sent here by mistake) to `to`.
    ///         It can never touch the backing: the amount is exactly `balance - supply`, and the invariant is re-checked.
    function sweepSurplus(address to) external nonReentrant returns (uint256 amount) {
        if (msg.sender != guardian) revert NotGuardian();
        if (to == address(0)) revert ZeroAddress();
        uint256 bal = reserve.balanceOf(address(this));
        uint256 supply = token.totalSupply();
        if (bal <= supply) revert NothingToSweep();
        amount = bal - supply;
        reserve.safeTransfer(to, amount);
        _checkInvariant();
        emit SurplusSwept(to, amount);
    }

    // ------------------------------------------------------------------------------------------------------------
    // Proof of reserve (anyone can read it, no trust needed)
    // ------------------------------------------------------------------------------------------------------------

    /// @return reserveBalance reserve tokens held by the vault right now
    /// @return supply ICEC-S in existence right now (reserveBalance >= supply must always hold)
    function collateralization() external view returns (uint256 reserveBalance, uint256 supply) {
        return (reserve.balanceOf(address(this)), token.totalSupply());
    }

    // ------------------------------------------------------------------------------------------------------------

    function _deposit(address from, uint256 amount) internal returns (uint256 minted) {
        if (depositsPaused) revert DepositsArePaused();
        if (amount == 0) revert ZeroAmount();
        uint256 before = reserve.balanceOf(address(this));
        reserve.safeTransferFrom(from, address(this), amount);
        minted = reserve.balanceOf(address(this)) - before;
        if (minted == 0) revert ZeroAmount();
        token.mint(from, minted);
        _checkInvariant();
        emit Deposited(from, amount, minted);
    }

    function _checkInvariant() private view {
        if (reserve.balanceOf(address(this)) < token.totalSupply()) revert InvariantBroken();
    }
}

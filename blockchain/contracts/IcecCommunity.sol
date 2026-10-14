// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/**
 * @title IcecCommunity (ICEC-C), the community form of icaneracoin, mirrored on-chain
 * @notice ICEC-C is an on-chain RECEIPT for icaneracoin that lives in the IcanEra platform ledger. It is priced by the
 *         platform's own engine and moves with the market the same way the ledger coin does: this contract has no price,
 *         no oracle and no reserve, because it is not trying to hold a value. Holding it on-chain gives the holder a
 *         public, verifiable record, not extra protection.
 *
 * How it stays tied to the ledger (the "bridge"):
 *   - Withdraw: a user's ledger ICEC is locked in the database, then the bridge operator calls mint() once for that
 *     withdrawal id. A withdrawal id can be minted at most once, ever.
 *   - Deposit: the holder calls burnForCredit(); the bridge sees the event and credits the ledger, but only to an address
 *     the user has proven they own and only up to what was bridged out for them. Anything else is left unclaimed.
 *
 * Why it cannot be transferred (and why that is deliberate):
 *   If ICEC-C could trade on an exchange, anyone could buy it cheaply there and burn it for credit at the engine price,
 *   draining the platform's treasury. So the only things that can happen to a balance are: the bridge mints it, or its
 *   holder burns it. There is no transfer, no transferFrom, and nothing to approve a spender for.
 *
 * Who can do what, in plain terms:
 *   - owner (a multisig in production): set the bridge operator, the daily mint cap and the guardian; resume minting.
 *   - guardian (a separate key): stop minting immediately. It cannot mint, burn or move anything.
 *   - operator (a hot key held by the relayer): mint against a withdrawal id, up to the daily cap. Nothing else.
 *   - holders: burn their own balance. Burning is never blocked, not even by a pause.
 *
 * The daily cap limits the damage of a stolen operator key. It is counted per UTC calendar day, so across a midnight
 * boundary the most that could be minted in 24 hours is twice the cap. A stolen key also cannot turn minted tokens into
 * ledger credit by itself, because the database credits only linked addresses within their outstanding bridged amount.
 *
 * No proxy, no upgrade path: the code you audit is the code that runs.
 */
contract IcecCommunity is ERC20, Ownable2Step {
    /// @notice Mints against withdrawals. Set by the owner; the zero address switches minting off entirely.
    address public operator;
    /// @notice Can pause minting. Cannot do anything else.
    address public guardian;
    /// @notice Largest total that may be minted in one UTC day, in base units (8 decimals, like the ledger).
    uint256 public dailyMintCap;
    bool public mintPaused;

    /// @notice withdrawal id => already minted. A withdrawal can never be minted twice.
    mapping(bytes32 => bool) public processed;
    /// @notice UTC day number (timestamp / 1 days) => amount minted that day.
    mapping(uint256 => uint256) public mintedByDay;

    event Minted(bytes32 indexed withdrawalId, address indexed to, uint256 amount);
    event BurnedForCredit(address indexed account, uint256 amount, bytes32 indexed creditId);
    event OperatorSet(address indexed operator);
    event GuardianSet(address indexed guardian);
    event DailyMintCapSet(uint256 cap);
    event MintPausedSet(bool paused);

    error NotOperator();
    error NotGuardianOrOwner();
    error MintIsPaused();
    error AlreadyProcessed(bytes32 withdrawalId);
    error DailyCapExceeded(uint256 requested, uint256 remaining);
    error ZeroAmount();
    error ZeroAddress();
    error NonTransferable();
    error RenounceDisabled();

    constructor(address owner_, address operator_, address guardian_, uint256 dailyMintCap_)
        ERC20("icaneracoin Community", "ICEC-C")
        Ownable(owner_)
    {
        operator = operator_;
        guardian = guardian_;
        dailyMintCap = dailyMintCap_;
        emit OperatorSet(operator_);
        emit GuardianSet(guardian_);
        emit DailyMintCapSet(dailyMintCap_);
    }

    /// @notice 8 decimals, matching the ledger's precision, so 1 ICEC in the database is 1e8 base units here.
    function decimals() public pure override returns (uint8) {
        return 8;
    }

    // ------------------------------------------------------------------------------------------------------------
    // Bridge operator
    // ------------------------------------------------------------------------------------------------------------

    /// @notice Mint `amount` to `to` for one ledger withdrawal. Each `withdrawalId` works exactly once.
    function mint(address to, uint256 amount, bytes32 withdrawalId) external {
        if (msg.sender != operator) revert NotOperator();
        if (mintPaused) revert MintIsPaused();
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (processed[withdrawalId]) revert AlreadyProcessed(withdrawalId);

        uint256 day = block.timestamp / 1 days;
        uint256 used = mintedByDay[day];
        uint256 cap = dailyMintCap;
        uint256 remaining = used >= cap ? 0 : cap - used;
        if (amount > remaining) revert DailyCapExceeded(amount, remaining);

        processed[withdrawalId] = true;
        mintedByDay[day] = used + amount;
        _mint(to, amount);
        emit Minted(withdrawalId, to, amount);
    }

    /// @notice How much the operator can still mint today.
    function mintableToday() external view returns (uint256) {
        uint256 used = mintedByDay[block.timestamp / 1 days];
        return used >= dailyMintCap ? 0 : dailyMintCap - used;
    }

    // ------------------------------------------------------------------------------------------------------------
    // Holders
    // ------------------------------------------------------------------------------------------------------------

    /// @notice Burn `amount` of your ICEC-C so the platform can credit the same amount back to your ledger balance.
    /// @param creditId a reference you choose (for example from the app) so the credit can be matched to this request.
    /// @dev Works while minting is paused, so nobody is ever locked into the on-chain form.
    function burnForCredit(uint256 amount, bytes32 creditId) external {
        if (amount == 0) revert ZeroAmount();
        _burn(msg.sender, amount);
        emit BurnedForCredit(msg.sender, amount, creditId);
    }

    // ------------------------------------------------------------------------------------------------------------
    // Guardian and owner
    // ------------------------------------------------------------------------------------------------------------

    /// @notice Stop minting at once. The guardian or the owner may call this; only the owner can resume.
    function pauseMint() external {
        if (msg.sender != guardian && msg.sender != owner()) revert NotGuardianOrOwner();
        mintPaused = true;
        emit MintPausedSet(true);
    }

    function unpauseMint() external onlyOwner {
        mintPaused = false;
        emit MintPausedSet(false);
    }

    function setOperator(address operator_) external onlyOwner {
        operator = operator_;
        emit OperatorSet(operator_);
    }

    function setGuardian(address guardian_) external onlyOwner {
        guardian = guardian_;
        emit GuardianSet(guardian_);
    }

    function setDailyMintCap(uint256 cap) external onlyOwner {
        dailyMintCap = cap;
        emit DailyMintCapSet(cap);
    }

    /// @dev Renouncing would leave a paused contract paused forever and the cap and roles frozen, so it is switched off.
    ///      Hand ownership to another multisig with the two-step transfer instead.
    function renounceOwnership() public pure override {
        revert RenounceDisabled();
    }

    // ------------------------------------------------------------------------------------------------------------

    /// @dev OpenZeppelin routes mint, burn and transfer through _update. Only mint (from == 0) and burn (to == 0) pass.
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) revert NonTransferable();
        super._update(from, to, value);
    }
}

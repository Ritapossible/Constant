// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

/**
 * @title ConstantMandate
 * @notice Capped, revocable bill mandates in one stablecoin (ConstantUnits, D-072).
 *
 * A user deposits the stablecoin and opens a line for each bill: who may charge it (ConstantUnits's server
 * address), how much per period, and how long a period is. That spender can then charge the line, at most the
 * allowance in each period and never more than the user's balance, and each order id only once. The charge goes
 * to the treasury fixed at deploy. The user can withdraw what is left, or revoke a line, at any time.
 *
 * The owner can pause and unpause charges, and nothing else: no function sends a user's balance anywhere but back
 * to that user or, through a valid charge, to the treasury. Pausing never blocks a withdrawal or a revoke.
 * No proxy, no upgrade: the token and the treasury are immutable.
 */
contract ConstantMandate is Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// Shortest and longest period a line may use. Bills renew daily at most and yearly at least.
    uint64 public constant MIN_PERIOD = 1 days;
    uint64 public constant MAX_PERIOD = 366 days;

    struct Line {
        address spender; // zero means no line under this id
        bool revoked;
        uint64 start; // periods are fixed windows [start + k * period, start + (k + 1) * period)
        uint64 period;
        uint64 periodIndex; // the window spentInPeriod belongs to
        uint128 allowance; // per period
        uint128 spentInPeriod;
    }

    IERC20 public immutable token;
    address public immutable treasury;

    /// Unspent stablecoin each user holds here.
    mapping(address user => uint256) public balanceOf;
    /// Sum of every balance. The contract always holds at least this much of the token.
    uint256 public totalBalances;
    /// Lines by user and line id (ConstantUnits's line key, hashed). An id is used once per user, even after a revoke.
    mapping(address user => mapping(bytes32 lineId => Line)) internal _lines;
    /// Order ids already charged, per spender, so a retried transaction can never charge twice and nobody can
    /// block ConstantUnits's orders by using its ids first.
    mapping(address spender => mapping(bytes32 orderId => bool)) public charged;

    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event LineOpened(
        address indexed user,
        bytes32 indexed lineId,
        address indexed spender,
        uint128 allowance,
        uint64 period,
        uint64 start
    );
    event Revoked(address indexed user, bytes32 indexed lineId);
    event Charged(
        address indexed user,
        bytes32 indexed lineId,
        bytes32 indexed orderId,
        address spender,
        uint256 amount,
        uint64 periodIndex
    );

    error ZeroAddress();
    error ZeroAmount();
    error BadPeriod(uint64 period);
    error LineExists(bytes32 lineId);
    error NoLine(bytes32 lineId);
    error LineRevoked(bytes32 lineId);
    error NotSpender(address caller);
    error OrderAlreadyCharged(bytes32 orderId);
    error OverAllowance(uint256 requested, uint256 left);
    error InsufficientBalance(uint256 requested, uint256 balance);
    error RenounceDisabled();

    constructor(IERC20 token_, address treasury_, address owner_) Ownable(owner_) {
        if (address(token_) == address(0) || treasury_ == address(0)) revert ZeroAddress();
        token = token_;
        treasury = treasury_;
    }

    // ── User ─────────────────────────────────────────────────────────────────────────────────────────────

    /// Pull `amount` from the caller (after an approve) and credit what actually arrived.
    function deposit(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        uint256 before = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = token.balanceOf(address(this)) - before;
        if (received == 0) revert ZeroAmount();
        balanceOf[msg.sender] += received;
        totalBalances += received;
        emit Deposited(msg.sender, received);
    }

    /// Send `amount` of the caller's unspent balance back to them. Works while paused.
    function withdraw(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        uint256 bal = balanceOf[msg.sender];
        if (amount > bal) revert InsufficientBalance(amount, bal);
        unchecked {
            balanceOf[msg.sender] = bal - amount;
            totalBalances -= amount;
        }
        token.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    /// Let `spender` charge up to `allowance` every `period` seconds, starting now. To change a line, revoke it and
    /// open another id.
    function openLine(bytes32 lineId, address spender, uint128 allowance, uint64 period) external {
        if (spender == address(0)) revert ZeroAddress();
        if (allowance == 0) revert ZeroAmount();
        if (period < MIN_PERIOD || period > MAX_PERIOD) revert BadPeriod(period);
        Line storage l = _lines[msg.sender][lineId];
        if (l.spender != address(0)) revert LineExists(lineId);
        uint64 start = uint64(block.timestamp);
        _lines[msg.sender][lineId] = Line({
            spender: spender,
            revoked: false,
            start: start,
            period: period,
            periodIndex: 0,
            allowance: allowance,
            spentInPeriod: 0
        });
        emit LineOpened(msg.sender, lineId, spender, allowance, period, start);
    }

    /// End a line for good, at once. Works while paused.
    function revoke(bytes32 lineId) external {
        Line storage l = _lines[msg.sender][lineId];
        if (l.spender == address(0)) revert NoLine(lineId);
        if (l.revoked) revert LineRevoked(lineId);
        l.revoked = true;
        emit Revoked(msg.sender, lineId);
    }

    // ── Spender ──────────────────────────────────────────────────────────────────────────────────────────

    /// Charge `amount` from `user`'s balance on `lineId` for the order `orderId`, to the treasury.
    function charge(address user, bytes32 lineId, uint256 amount, bytes32 orderId) external nonReentrant whenNotPaused {
        Line storage l = _lines[user][lineId];
        if (l.spender == address(0)) revert NoLine(lineId);
        if (msg.sender != l.spender) revert NotSpender(msg.sender);
        if (l.revoked) revert LineRevoked(lineId);
        if (amount == 0) revert ZeroAmount();
        if (charged[msg.sender][orderId]) revert OrderAlreadyCharged(orderId);

        uint64 idx = _periodIndex(l);
        uint256 spent = idx == l.periodIndex ? l.spentInPeriod : 0;
        uint256 left = l.allowance - spent;
        if (amount > left) revert OverAllowance(amount, left);
        uint256 bal = balanceOf[user];
        if (amount > bal) revert InsufficientBalance(amount, bal);

        charged[msg.sender][orderId] = true;
        l.periodIndex = idx;
        l.spentInPeriod = SafeCast.toUint128(spent + amount); // ≤ allowance, so it always fits
        unchecked {
            balanceOf[user] = bal - amount;
            totalBalances -= amount;
        }
        token.safeTransfer(treasury, amount);
        emit Charged(user, lineId, orderId, msg.sender, amount, idx);
    }

    // ── Owner ────────────────────────────────────────────────────────────────────────────────────────────

    /// Stop charges (an incident, a key rotation). Deposits, withdrawals and revokes keep working.
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// Ownership can be handed over (two steps) but never dropped: a paused contract with no owner would stay paused.
    function renounceOwnership() public view override onlyOwner {
        revert RenounceDisabled();
    }

    // ── Views ────────────────────────────────────────────────────────────────────────────────────────────

    function lineOf(address user, bytes32 lineId) external view returns (Line memory) {
        return _lines[user][lineId];
    }

    /// What the spender may still charge on this line now, and when the current period ends. Zero once revoked.
    function available(address user, bytes32 lineId) external view returns (uint256 left, uint64 periodEnd) {
        Line storage l = _lines[user][lineId];
        if (l.spender == address(0)) return (0, 0);
        uint64 idx = _periodIndex(l);
        periodEnd = l.start + (idx + 1) * l.period;
        if (l.revoked) return (0, periodEnd);
        uint256 spent = idx == l.periodIndex ? l.spentInPeriod : 0;
        left = l.allowance - spent;
        uint256 bal = balanceOf[user];
        if (bal < left) left = bal;
    }

    function _periodIndex(Line storage l) private view returns (uint64) {
        return uint64((block.timestamp - l.start) / l.period);
    }
}

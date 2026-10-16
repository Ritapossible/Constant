// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ConstantMandate} from "../src/ConstantMandate.sol";
import {TestStable} from "../src/TestStable.sol";

/// Drives the mandate with random users, lines, charges, withdrawals, revokes, pauses, time, and attacks by the
/// owner and a stranger, keeping its own ledger to check against.
contract Handler is Test {
    ConstantMandate public m;
    TestStable public usd;
    address public owner;
    address public treasury;
    address public spender = makeAddr("spender");
    address public stranger = makeAddr("stranger");

    address[] public users;
    bytes32[] public lineIds;
    uint256 public nextOrder;

    /// Ghost ledger.
    mapping(address => uint256) public expectedBalance;
    uint256 public charged;
    /// Spent per (user, line, window), recomputed from successful charges only.
    mapping(bytes32 => uint256) public spentInWindow;
    /// Order ids that succeeded, per spender.
    mapping(bytes32 => uint256) public timesCharged;
    uint256 public strangerTakes; // anything a stranger or the owner managed to move
    uint256 public violations; // charges that succeeded but should not have

    constructor(ConstantMandate m_, TestStable usd_, address owner_, address treasury_) {
        m = m_;
        usd = usd_;
        owner = owner_;
        treasury = treasury_;
        for (uint256 i; i < 4; i++) {
            users.push(makeAddr(string(abi.encodePacked("user", i))));
        }
        lineIds.push(keccak256("a"));
        lineIds.push(keccak256("b"));
        lineIds.push(keccak256("c"));
    }

    function _user(uint256 s) internal view returns (address) {
        return users[s % users.length];
    }

    function _line(uint256 s) internal view returns (bytes32) {
        return lineIds[s % lineIds.length];
    }

    function deposit(uint256 us, uint256 amount) external {
        address u = _user(us);
        amount = bound(amount, 1, 1_000e6);
        usd.faucet(u, amount);
        vm.startPrank(u);
        usd.approve(address(m), amount);
        m.deposit(amount);
        vm.stopPrank();
        expectedBalance[u] += amount;
    }

    function withdraw(uint256 us, uint256 amount) external {
        address u = _user(us);
        uint256 bal = m.balanceOf(u);
        if (bal == 0) return;
        amount = bound(amount, 1, bal);
        vm.prank(u);
        m.withdraw(amount);
        expectedBalance[u] -= amount;
    }

    function openLine(uint256 us, uint256 ls, uint128 allowance, uint64 period) external {
        address u = _user(us);
        bytes32 id = _line(ls);
        if (m.lineOf(u, id).spender != address(0)) return;
        allowance = uint128(bound(allowance, 1, 500e6));
        period = uint64(bound(period, m.MIN_PERIOD(), m.MAX_PERIOD()));
        vm.prank(u);
        m.openLine(id, spender, allowance, period);
    }

    function revoke(uint256 us, uint256 ls) external {
        address u = _user(us);
        bytes32 id = _line(ls);
        ConstantMandate.Line memory l = m.lineOf(u, id);
        if (l.spender == address(0) || l.revoked) return;
        vm.prank(u);
        m.revoke(id);
    }

    function charge(uint256 us, uint256 ls, uint256 amount, bool reuseOrder) external {
        address u = _user(us);
        bytes32 id = _line(ls);
        amount = bound(amount, 1, 600e6);
        bytes32 order = reuseOrder && nextOrder > 0 ? bytes32(nextOrder - 1) : bytes32(nextOrder++);
        ConstantMandate.Line memory l = m.lineOf(u, id);
        vm.prank(spender);
        try m.charge(u, id, amount, order) {
            // It succeeded: record it, then the invariants check it was allowed.
            uint256 w = (block.timestamp - l.start) / l.period;
            spentInWindow[keccak256(abi.encode(u, id, w))] += amount;
            timesCharged[order]++;
            expectedBalance[u] -= amount;
            charged += amount;
            // Recorded, not asserted: a revert inside the handler would be ignored (fail_on_revert = false).
            if (l.revoked || l.spender == address(0)) violations++;
            if (m.paused()) violations++;
            if (spentInWindow[keccak256(abi.encode(u, id, w))] > l.allowance) violations++;
            if (timesCharged[order] > 1) violations++;
        } catch {}
    }

    function warp(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 0, 90 days));
    }

    function togglePause() external {
        bool paused = m.paused(); // read first: a prank applies to the very next call
        vm.prank(owner);
        if (paused) m.unpause();
        else m.pause();
    }

    /// The owner and a stranger try every way to move someone's balance; none may work.
    function attack(uint256 us, uint256 ls, uint256 amount, bool asOwner) external {
        address a = asOwner ? owner : stranger;
        address u = _user(us);
        bytes32 id = _line(ls);
        amount = bound(amount, 1, 1_000e6);
        uint256 before = usd.balanceOf(a);
        vm.startPrank(a);
        try m.charge(u, id, amount, bytes32(type(uint256).max - nextOrder++)) {
            strangerTakes += amount;
        } catch {}
        try m.withdraw(amount) {
            strangerTakes += amount;
        } catch {}
        try m.revoke(id) {} catch {}
        vm.stopPrank();
        if (usd.balanceOf(a) > before) strangerTakes += usd.balanceOf(a) - before;
    }

    function usersLength() external view returns (uint256) {
        return users.length;
    }
}

contract ConstantMandateInvariants is Test {
    ConstantMandate m;
    TestStable usd;
    Handler h;
    address owner = makeAddr("owner");
    address treasury = makeAddr("treasury");

    function setUp() public {
        vm.warp(1_760_000_000);
        usd = new TestStable();
        m = new ConstantMandate(IERC20(address(usd)), treasury, owner);
        h = new Handler(m, usd, owner, treasury);
        targetContract(address(h));
    }

    /// The contract always holds at least the sum of user balances (exactly, with a plain token).
    function invariant_holdsEveryBalance() public view {
        uint256 sum;
        for (uint256 i; i < h.usersLength(); i++) {
            sum += m.balanceOf(h.users(i));
        }
        assertEq(sum, m.totalBalances());
        assertGe(usd.balanceOf(address(m)), m.totalBalances());
    }

    /// Every balance is exactly deposits − withdrawals − valid charges: nobody else ever moved it.
    function invariant_balancesMatchLedger() public view {
        for (uint256 i; i < h.usersLength(); i++) {
            address u = h.users(i);
            assertEq(m.balanceOf(u), h.expectedBalance(u));
        }
    }

    /// The treasury receives exactly what was validly charged, and nothing else.
    function invariant_treasuryGetsOnlyCharges() public view {
        assertEq(usd.balanceOf(treasury), h.charged());
    }

    /// No charge ever succeeded on a revoked line, while paused, over a window's allowance, or twice for one order.
    function invariant_noForbiddenCharge() public view {
        assertEq(h.violations(), 0);
    }

    function invariant_ownerAndStrangerTakeNothing() public view {
        assertEq(h.strangerTakes(), 0);
        assertEq(usd.balanceOf(owner), 0);
        assertEq(usd.balanceOf(h.stranger()), 0);
    }
}

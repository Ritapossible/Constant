// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ConstantMandate} from "../src/ConstantMandate.sol";
import {TestStable} from "../src/TestStable.sol";
import {FeeToken} from "./mocks/FeeToken.sol";
import {HookToken} from "./mocks/HookToken.sol";

/// Every rule in ARCHITECTURE "QIE" and HACKATHON.md "Tests", one test each, plus fuzzing of amounts and periods.
contract ConstantMandateTest is Test {
    ConstantMandate m;
    TestStable usd;

    address owner = makeAddr("owner");
    address treasury = makeAddr("treasury");
    address spender = makeAddr("spender"); // ConstantUnits's server
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address mallory = makeAddr("mallory");

    bytes32 constant LINE = keccak256("line:alice-mtn-data");
    bytes32 constant ORDER1 = keccak256("order:1");
    bytes32 constant ORDER2 = keccak256("order:2");
    uint128 constant CAP = 50e6; // $50 a period
    uint64 constant MONTH = 30 days;

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

    function setUp() public {
        vm.warp(1_760_000_000);
        usd = new TestStable();
        m = new ConstantMandate(IERC20(address(usd)), treasury, owner);
        _fund(alice, 200e6);
    }

    function _fund(address who, uint256 amount) internal {
        usd.faucet(who, amount);
        vm.startPrank(who);
        usd.approve(address(m), amount);
        m.deposit(amount);
        vm.stopPrank();
    }

    function _open() internal {
        vm.prank(alice);
        m.openLine(LINE, spender, CAP, MONTH);
    }

    // ── Construction ────────────────────────────────────────────────────────────────────────────────────

    function test_constructor_setsImmutables() public view {
        assertEq(address(m.token()), address(usd));
        assertEq(m.treasury(), treasury);
        assertEq(m.owner(), owner);
    }

    function test_constructor_rejectsZeroAddresses() public {
        vm.expectRevert(ConstantMandate.ZeroAddress.selector);
        new ConstantMandate(IERC20(address(0)), treasury, owner);
        vm.expectRevert(ConstantMandate.ZeroAddress.selector);
        new ConstantMandate(IERC20(address(usd)), address(0), owner);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new ConstantMandate(IERC20(address(usd)), treasury, address(0));
    }

    // ── Deposit and withdraw ────────────────────────────────────────────────────────────────────────────

    function test_deposit_creditsAndEmits() public {
        usd.faucet(bob, 10e6);
        vm.startPrank(bob);
        usd.approve(address(m), 10e6);
        vm.expectEmit(address(m));
        emit Deposited(bob, 10e6);
        m.deposit(10e6);
        vm.stopPrank();
        assertEq(m.balanceOf(bob), 10e6);
        assertEq(m.totalBalances(), 210e6);
        assertEq(usd.balanceOf(address(m)), 210e6);
    }

    function test_deposit_rejectsZero() public {
        vm.prank(alice);
        vm.expectRevert(ConstantMandate.ZeroAmount.selector);
        m.deposit(0);
    }

    function test_deposit_withoutApprovalReverts() public {
        usd.faucet(bob, 10e6);
        vm.prank(bob);
        vm.expectRevert();
        m.deposit(10e6);
    }

    function test_deposit_feeTokenCreditsWhatArrives() public {
        FeeToken fee = new FeeToken();
        ConstantMandate fm = new ConstantMandate(IERC20(address(fee)), treasury, owner);
        fee.mint(bob, 100e6);
        vm.startPrank(bob);
        fee.approve(address(fm), 100e6);
        fm.deposit(100e6);
        vm.stopPrank();
        assertEq(fm.balanceOf(bob), 99e6, "1% burned on the way in, not credited");
        assertEq(fee.balanceOf(address(fm)), fm.totalBalances());
    }

    function test_withdraw_returnsToUser() public {
        vm.prank(alice);
        vm.expectEmit(address(m));
        emit Withdrawn(alice, 80e6);
        m.withdraw(80e6);
        assertEq(m.balanceOf(alice), 120e6);
        assertEq(usd.balanceOf(alice), 80e6);
    }

    function test_withdraw_moreThanBalanceReverts() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ConstantMandate.InsufficientBalance.selector, 201e6, 200e6));
        m.withdraw(201e6);
    }

    function test_withdraw_rejectsZero() public {
        vm.prank(alice);
        vm.expectRevert(ConstantMandate.ZeroAmount.selector);
        m.withdraw(0);
    }

    function test_withdraw_cannotTakeSomeoneElsesBalance() public {
        vm.prank(mallory);
        vm.expectRevert(abi.encodeWithSelector(ConstantMandate.InsufficientBalance.selector, 1, 0));
        m.withdraw(1);
        assertEq(m.balanceOf(alice), 200e6);
    }

    /// HACKATHON "Tests": pause blocks a withdrawal → must fail the build.
    function test_withdraw_worksWhilePaused() public {
        vm.prank(owner);
        m.pause();
        vm.prank(alice);
        m.withdraw(200e6);
        assertEq(usd.balanceOf(alice), 200e6);
    }

    // ── Lines ───────────────────────────────────────────────────────────────────────────────────────────

    function test_openLine_storesAndEmits() public {
        vm.prank(alice);
        vm.expectEmit(address(m));
        emit LineOpened(alice, LINE, spender, CAP, MONTH, uint64(block.timestamp));
        m.openLine(LINE, spender, CAP, MONTH);
        ConstantMandate.Line memory l = m.lineOf(alice, LINE);
        assertEq(l.spender, spender);
        assertEq(l.allowance, CAP);
        assertEq(l.period, MONTH);
        assertEq(l.start, block.timestamp);
        assertFalse(l.revoked);
        (uint256 left, uint64 end) = m.available(alice, LINE);
        assertEq(left, CAP);
        assertEq(end, block.timestamp + MONTH);
    }

    function test_openLine_validates() public {
        vm.startPrank(alice);
        vm.expectRevert(ConstantMandate.ZeroAddress.selector);
        m.openLine(LINE, address(0), CAP, MONTH);
        vm.expectRevert(ConstantMandate.ZeroAmount.selector);
        m.openLine(LINE, spender, 0, MONTH);
        vm.expectRevert(abi.encodeWithSelector(ConstantMandate.BadPeriod.selector, 1 days - 1));
        m.openLine(LINE, spender, CAP, 1 days - 1);
        vm.expectRevert(abi.encodeWithSelector(ConstantMandate.BadPeriod.selector, 366 days + 1));
        m.openLine(LINE, spender, CAP, 366 days + 1);
        vm.stopPrank();
    }

    function test_openLine_idCannotBeReused_evenAfterRevoke() public {
        _open();
        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(ConstantMandate.LineExists.selector, LINE));
        m.openLine(LINE, spender, CAP * 10, MONTH);
        m.revoke(LINE);
        vm.expectRevert(abi.encodeWithSelector(ConstantMandate.LineExists.selector, LINE));
        m.openLine(LINE, spender, CAP * 10, MONTH);
        vm.stopPrank();
    }

    function test_openLine_sameIdForDifferentUsersIsSeparate() public {
        _open();
        _fund(bob, 10e6);
        vm.prank(bob);
        m.openLine(LINE, spender, 5e6, MONTH);
        vm.prank(spender);
        m.charge(bob, LINE, 5e6, ORDER1);
        assertEq(m.balanceOf(alice), 200e6, "alice's line untouched");
    }

    function test_revoke_emitsAndStopsCharges() public {
        _open();
        vm.prank(alice);
        vm.expectEmit(address(m));
        emit Revoked(alice, LINE);
        m.revoke(LINE);
        (uint256 left,) = m.available(alice, LINE);
        assertEq(left, 0);
        /// HACKATHON "Tests": a revoked line charges → must fail the build.
        vm.prank(spender);
        vm.expectRevert(abi.encodeWithSelector(ConstantMandate.LineRevoked.selector, LINE));
        m.charge(alice, LINE, 1e6, ORDER1);
    }

    function test_revoke_twiceOrMissingReverts() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ConstantMandate.NoLine.selector, LINE));
        m.revoke(LINE);
        _open();
        vm.startPrank(alice);
        m.revoke(LINE);
        vm.expectRevert(abi.encodeWithSelector(ConstantMandate.LineRevoked.selector, LINE));
        m.revoke(LINE);
        vm.stopPrank();
    }

    function test_revoke_onlyTheUsersOwnLine() public {
        _open();
        vm.prank(spender);
        vm.expectRevert(abi.encodeWithSelector(ConstantMandate.NoLine.selector, LINE));
        m.revoke(LINE);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(ConstantMandate.NoLine.selector, LINE));
        m.revoke(LINE);
        assertFalse(m.lineOf(alice, LINE).revoked);
    }

    function test_revoke_worksWhilePaused() public {
        _open();
        vm.prank(owner);
        m.pause();
        vm.prank(alice);
        m.revoke(LINE);
        assertTrue(m.lineOf(alice, LINE).revoked);
    }

    // ── Charge ──────────────────────────────────────────────────────────────────────────────────────────

    function test_charge_movesToTreasuryAndEmits() public {
        _open();
        vm.prank(spender);
        vm.expectEmit(address(m));
        emit Charged(alice, LINE, ORDER1, spender, 20e6, 0);
        m.charge(alice, LINE, 20e6, ORDER1);
        assertEq(usd.balanceOf(treasury), 20e6);
        assertEq(m.balanceOf(alice), 180e6);
        assertEq(m.totalBalances(), 180e6);
        assertTrue(m.charged(spender, ORDER1));
        (uint256 left,) = m.available(alice, LINE);
        assertEq(left, 30e6);
    }

    /// HACKATHON "Tests": the spender charges over the cap → must fail the build.
    function test_charge_overAllowanceReverts() public {
        _open();
        vm.startPrank(spender);
        vm.expectRevert(abi.encodeWithSelector(ConstantMandate.OverAllowance.selector, CAP + 1, CAP));
        m.charge(alice, LINE, CAP + 1, ORDER1);
        m.charge(alice, LINE, 30e6, ORDER1);
        vm.expectRevert(abi.encodeWithSelector(ConstantMandate.OverAllowance.selector, 21e6, 20e6));
        m.charge(alice, LINE, 21e6, ORDER2);
        m.charge(alice, LINE, 20e6, ORDER2); // exactly the rest is fine
        vm.stopPrank();
        assertEq(usd.balanceOf(treasury), CAP);
    }

    /// HACKATHON "Tests": a second caller charges → must fail the build.
    function test_charge_onlyTheLinesSpender() public {
        _open();
        address[3] memory others = [mallory, owner, alice];
        for (uint256 i; i < others.length; i++) {
            vm.prank(others[i]);
            vm.expectRevert(abi.encodeWithSelector(ConstantMandate.NotSpender.selector, others[i]));
            m.charge(alice, LINE, 1e6, ORDER1);
        }
        assertEq(m.balanceOf(alice), 200e6);
    }

    /// HACKATHON "Tests": the same order is charged twice → must fail the build.
    function test_charge_sameOrderOnlyOnce_evenOnAnotherLineOrPeriod() public {
        _open();
        bytes32 line2 = keccak256("line:alice-light");
        vm.prank(alice);
        m.openLine(line2, spender, CAP, MONTH);
        vm.startPrank(spender);
        m.charge(alice, LINE, 10e6, ORDER1);
        vm.expectRevert(abi.encodeWithSelector(ConstantMandate.OrderAlreadyCharged.selector, ORDER1));
        m.charge(alice, LINE, 10e6, ORDER1);
        vm.expectRevert(abi.encodeWithSelector(ConstantMandate.OrderAlreadyCharged.selector, ORDER1));
        m.charge(alice, line2, 10e6, ORDER1);
        vm.warp(block.timestamp + MONTH);
        vm.expectRevert(abi.encodeWithSelector(ConstantMandate.OrderAlreadyCharged.selector, ORDER1));
        m.charge(alice, LINE, 10e6, ORDER1);
        vm.stopPrank();
        assertEq(usd.balanceOf(treasury), 10e6);
    }

    /// Someone who opens a line on their own money, naming themselves spender, can't burn ConstantUnits's order ids.
    function test_charge_orderIdsArePerSpender_noGriefing() public {
        _fund(mallory, 5e6);
        vm.startPrank(mallory);
        m.openLine(LINE, mallory, 5e6, MONTH);
        m.charge(mallory, LINE, 1e6, ORDER1);
        vm.stopPrank();
        _open();
        vm.prank(spender);
        m.charge(alice, LINE, 10e6, ORDER1);
        assertTrue(m.charged(spender, ORDER1));
    }

    function test_charge_overBalanceReverts() public {
        _fund(bob, 5e6);
        vm.prank(bob);
        m.openLine(LINE, spender, CAP, MONTH);
        vm.prank(spender);
        vm.expectRevert(abi.encodeWithSelector(ConstantMandate.InsufficientBalance.selector, 6e6, 5e6));
        m.charge(bob, LINE, 6e6, ORDER1);
        (uint256 left,) = m.available(bob, LINE);
        assertEq(left, 5e6, "available is capped by the balance");
    }

    function test_charge_zeroOrMissingLineReverts() public {
        vm.prank(spender);
        vm.expectRevert(abi.encodeWithSelector(ConstantMandate.NoLine.selector, LINE));
        m.charge(alice, LINE, 1e6, ORDER1);
        _open();
        vm.prank(spender);
        vm.expectRevert(ConstantMandate.ZeroAmount.selector);
        m.charge(alice, LINE, 0, ORDER1);
    }

    function test_charge_blockedWhilePaused_thenResumes() public {
        _open();
        vm.prank(owner);
        m.pause();
        vm.prank(spender);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        m.charge(alice, LINE, 1e6, ORDER1);
        vm.prank(owner);
        m.unpause();
        vm.prank(spender);
        m.charge(alice, LINE, 1e6, ORDER1);
        assertEq(usd.balanceOf(treasury), 1e6);
    }

    function test_charge_allowanceResetsEachFixedPeriod() public {
        _open();
        uint256 t0 = block.timestamp;
        vm.startPrank(spender);
        m.charge(alice, LINE, CAP, ORDER1);
        // One second before the window ends: still the same period.
        vm.warp(t0 + MONTH - 1);
        vm.expectRevert(abi.encodeWithSelector(ConstantMandate.OverAllowance.selector, 1, 0));
        m.charge(alice, LINE, 1, ORDER2);
        // Next window: the full allowance again, not more.
        vm.warp(t0 + MONTH);
        vm.expectRevert(abi.encodeWithSelector(ConstantMandate.OverAllowance.selector, CAP + 1, CAP));
        m.charge(alice, LINE, CAP + 1, ORDER2);
        m.charge(alice, LINE, CAP, ORDER2);
        // Skipped windows don't accumulate.
        vm.warp(t0 + 5 * MONTH + 3);
        vm.expectRevert(abi.encodeWithSelector(ConstantMandate.OverAllowance.selector, CAP + 1, CAP));
        m.charge(alice, LINE, CAP + 1, keccak256("order:3"));
        m.charge(alice, LINE, CAP, keccak256("order:3"));
        vm.stopPrank();
        assertEq(m.lineOf(alice, LINE).periodIndex, 5);
        (, uint64 end) = m.available(alice, LINE);
        assertEq(end, t0 + 6 * MONTH);
    }

    function test_charge_cannotReenter() public {
        HookToken hook = new HookToken();
        ConstantMandate hm = new ConstantMandate(IERC20(address(hook)), treasury, owner);
        hook.mint(alice, 100e6);
        vm.startPrank(alice);
        hook.approve(address(hm), 100e6);
        hm.deposit(100e6);
        hm.openLine(LINE, address(hook), CAP, MONTH); // the token itself is the spender, to try re-entering
        vm.stopPrank();
        // During charge's transfer to the treasury, the token calls charge again with another order.
        hook.setHook(address(hm), abi.encodeCall(ConstantMandate.charge, (alice, LINE, 1e6, ORDER2)));
        vm.prank(address(hook));
        hm.charge(alice, LINE, 10e6, ORDER1);
        assertEq(hook.hookRevert(), abi.encodeWithSelector(ReentrancyGuard.ReentrancyGuardReentrantCall.selector));
        assertEq(hm.balanceOf(alice), 90e6, "only the outer charge happened");
        assertFalse(hm.charged(address(hook), ORDER2));
    }

    // ── Owner ───────────────────────────────────────────────────────────────────────────────────────────

    /// HACKATHON "Tests": the owner can move a user's balance → must fail the build. The owner's only powers are
    /// pause, unpause and handing over ownership; none of them touches a balance.
    function test_owner_cannotMoveBalances() public {
        _open();
        vm.startPrank(owner);
        vm.expectRevert(abi.encodeWithSelector(ConstantMandate.NotSpender.selector, owner));
        m.charge(alice, LINE, 1e6, ORDER1);
        vm.expectRevert(abi.encodeWithSelector(ConstantMandate.InsufficientBalance.selector, 1e6, 0));
        m.withdraw(1e6);
        m.pause();
        m.unpause();
        vm.stopPrank();
        assertEq(m.balanceOf(alice), 200e6);
        assertEq(usd.balanceOf(address(m)), 200e6);
    }

    function test_pause_onlyOwner() public {
        vm.prank(mallory);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, mallory));
        m.pause();
        vm.prank(spender);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, spender));
        m.unpause();
    }

    function test_ownership_twoStepAndNeverRenounced() public {
        vm.prank(owner);
        vm.expectRevert(ConstantMandate.RenounceDisabled.selector);
        m.renounceOwnership();
        vm.prank(owner);
        m.transferOwnership(bob);
        assertEq(m.owner(), owner, "not until bob accepts");
        vm.prank(mallory);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, mallory));
        m.acceptOwnership();
        vm.prank(bob);
        m.acceptOwnership();
        assertEq(m.owner(), bob);
    }

    function test_testStable_refusesMainnetAndBigMints() public {
        vm.expectRevert(abi.encodeWithSelector(TestStable.TooMuch.selector, 1_000e6 + 1));
        usd.faucet(bob, 1_000e6 + 1);
        vm.chainId(1990);
        vm.expectRevert(TestStable.Mainnet.selector);
        new TestStable();
    }

    // ── Fuzz ────────────────────────────────────────────────────────────────────────────────────────────

    /// Any sequence of charges at any times never takes more than the allowance in one window.
    function testFuzz_charges_neverExceedAllowancePerWindow(
        uint128 allowance,
        uint64 period,
        uint64[8] calldata gaps,
        uint128[8] calldata amounts
    ) public {
        allowance = uint128(bound(allowance, 1, 1_000e6));
        period = uint64(bound(period, m.MIN_PERIOD(), m.MAX_PERIOD()));
        usd.faucet(bob, 1_000e6);
        vm.startPrank(bob);
        usd.approve(address(m), 1_000e6);
        m.deposit(1_000e6);
        m.openLine(LINE, spender, allowance, period);
        vm.stopPrank();
        uint256 start = block.timestamp;

        uint256 window = type(uint256).max;
        uint256 spentInWindow;
        for (uint256 i; i < 8; i++) {
            vm.warp(block.timestamp + bound(gaps[i], 0, uint256(period) * 2));
            uint256 w = (block.timestamp - start) / period;
            if (w != window) (window, spentInWindow) = (w, 0);
            uint256 amt = bound(amounts[i], 1, uint256(allowance) + 1);
            bool fits = spentInWindow + amt <= allowance && amt <= m.balanceOf(bob);
            vm.prank(spender);
            if (fits) {
                m.charge(bob, LINE, amt, bytes32(i));
                spentInWindow += amt;
            } else {
                vm.expectRevert();
                m.charge(bob, LINE, amt, bytes32(i));
            }
            assertLe(spentInWindow, allowance);
        }
        assertEq(usd.balanceOf(treasury) + m.balanceOf(bob), 1_000e6, "nothing created or lost");
    }

    function testFuzz_depositWithdraw_roundTrips(uint256 dep, uint256 wd) public {
        dep = bound(dep, 1, 1_000e6);
        wd = bound(wd, 1, dep);
        usd.faucet(bob, dep);
        vm.startPrank(bob);
        usd.approve(address(m), dep);
        m.deposit(dep);
        m.withdraw(wd);
        vm.stopPrank();
        assertEq(m.balanceOf(bob), dep - wd);
        assertEq(usd.balanceOf(bob), wd);
        assertEq(usd.balanceOf(address(m)), m.totalBalances());
    }
}

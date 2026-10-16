// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// Calls back into a target during transfers, to prove the mandate can't be re-entered.
contract HookToken is ERC20 {
    address public hookTarget;
    bytes public hookData;
    bool public hookFired;
    bytes public hookRevert;

    constructor() ERC20("Hook", "HOOK") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setHook(address target, bytes calldata data) external {
        hookTarget = target;
        hookData = data;
        hookFired = false;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (hookTarget != address(0) && !hookFired) {
            hookFired = true;
            (bool ok, bytes memory ret) = hookTarget.call(hookData);
            if (!ok) hookRevert = ret;
        }
    }
}

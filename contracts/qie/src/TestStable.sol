// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title TestStable
 * @notice A worthless 6-decimal dollar for QIE testnet (chain 1983) and local runs only, standing in for the
 * official QIE stablecoin until its address is confirmed (HACKATHON.md). Anyone can mint up to 1,000 at a time.
 * The deploy script refuses to deploy it on mainnet.
 */
contract TestStable is ERC20 {
    uint256 public constant FAUCET_MAX = 1_000e6;

    error TooMuch(uint256 amount);
    error Mainnet();

    constructor() ERC20("ConstantUnits Test Dollar", "tUSD") {
        if (block.chainid == 1990) revert Mainnet();
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function faucet(address to, uint256 amount) external {
        if (amount > FAUCET_MAX) revert TooMuch(amount);
        _mint(to, amount);
    }
}

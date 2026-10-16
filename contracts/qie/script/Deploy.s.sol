// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20, IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {ConstantMandate} from "../src/ConstantMandate.sol";
import {TestStable} from "../src/TestStable.sol";

/**
 * Deploys ConstantMandate (D-072). Only on QIE testnet (1983), QIE mainnet (1990) or a local chain (31337).
 *
 *   QIE_TREASURY=0x… QIE_OWNER=0x… forge script script/Deploy.s.sol --rpc-url qie_testnet --broadcast \
 *     --private-key $QIE_DEPLOYER_KEY
 *
 * Testnet and local: deploys TestStable as the stablecoin unless QIE_STABLECOIN is set.
 * Mainnet: refuses unless addresses.json records the official stablecoin, and that contract's code, symbol and
 * decimals match the record. Never deploys TestStable there. Copy the printed addresses into addresses.json.
 */
contract Deploy is Script {
    uint256 constant TESTNET = 1983;
    uint256 constant MAINNET = 1990;
    uint256 constant LOCAL = 31337;

    function run() external returns (ConstantMandate mandate, address stablecoin) {
        uint256 id = block.chainid;
        require(id == TESTNET || id == MAINNET || id == LOCAL, "Deploy: not a QIE chain");
        address treasury = vm.envAddress("QIE_TREASURY");
        address owner = vm.envAddress("QIE_OWNER");
        require(treasury != address(0) && owner != address(0), "Deploy: set QIE_TREASURY and QIE_OWNER");

        if (id == MAINNET) {
            stablecoin = _officialStablecoin();
        } else {
            stablecoin = vm.envOr("QIE_STABLECOIN", address(0));
        }

        vm.startBroadcast();
        if (stablecoin == address(0)) stablecoin = address(new TestStable());
        mandate = new ConstantMandate(IERC20(stablecoin), treasury, owner);
        vm.stopBroadcast();

        require(address(mandate.token()) == stablecoin, "Deploy: token readback");
        require(mandate.treasury() == treasury, "Deploy: treasury readback");
        require(mandate.owner() == owner, "Deploy: owner readback");

        console2.log("chain", id);
        console2.log("stablecoin", stablecoin, IERC20Metadata(stablecoin).symbol());
        console2.log("mandate", address(mandate));
        console2.log("treasury", treasury);
        console2.log("owner", owner);
    }

    function _officialStablecoin() internal view returns (address token) {
        // Read-only, and foundry.toml allows reading addresses.json alone.
        // forge-lint: disable-next-line(unsafe-cheatcode)
        string memory json = vm.readFile(string.concat(vm.projectRoot(), "/addresses.json"));
        token = vm.parseJsonAddress(json, ".1990.stablecoin.address");
        require(token != address(0), "Deploy: no official stablecoin in addresses.json (ask the QIE team)");
        require(token.code.length > 0, "Deploy: stablecoin has no code on this chain");
        string memory symbol = vm.parseJsonString(json, ".1990.stablecoin.symbol");
        uint256 decimals = vm.parseJsonUint(json, ".1990.stablecoin.decimals");
        require(keccak256(bytes(IERC20Metadata(token).symbol())) == keccak256(bytes(symbol)), "Deploy: symbol differs");
        require(IERC20Metadata(token).decimals() == decimals, "Deploy: decimals differ");
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PaytagRegistry} from "../src/PaytagRegistry.sol";
import {PaytagResolver} from "../src/PaytagResolver.sol";
import {Script, console} from "forge-std/Script.sol";

/// @notice Deploys the registry and its resolver.
///   forge script script/Deploy.s.sol --rpc-url base_sepolia --broadcast --verify
contract Deploy is Script {
    function run() external returns (PaytagRegistry registry, PaytagResolver resolver) {
        vm.startBroadcast(vm.envUint("DEPLOYER_PRIVATE_KEY"));
        registry = new PaytagRegistry();
        resolver = new PaytagResolver(registry);
        vm.stopBroadcast();

        console.log("PaytagRegistry:", address(registry));
        console.log("PaytagResolver:", address(resolver));
    }
}

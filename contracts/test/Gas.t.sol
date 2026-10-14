// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PaytagRegistry} from "../src/PaytagRegistry.sol";
import {PaytagResolver} from "../src/PaytagResolver.sol";
import {Test} from "forge-std/Test.sol";
import {VmSafe} from "forge-std/Vm.sol";

/// @notice Fixed scenarios for per-call gas, written to `snapshots/GasTest.json`. Each test measures
///         exactly one external call so the numbers are comparable across optimization passes.
contract GasTest is Test {
    PaytagRegistry registry;
    PaytagResolver resolver;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    bytes32 node;

    bytes constant SOL = hex"0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c";
    bytes constant BTC = hex"0014751e76e8199196d454941c45d1b3a323f1433bd6";

    /// `forge coverage` compiles without the optimizer; skip so it can't overwrite the committed
    /// snapshot with unoptimized numbers.
    modifier notUnderCoverage() {
        vm.skip(vm.isContext(VmSafe.ForgeContext.Coverage));
        _;
    }

    function setUp() public {
        registry = new PaytagRegistry();
        resolver = new PaytagResolver(registry);
        vm.prank(alice);
        node = registry.register("derrick");
    }

    function test_gas_register_3chars() public notUnderCoverage {
        vm.prank(bob);
        registry.register("abc");
        vm.snapshotGasLastFrame("register (3 chars)");
    }

    function test_gas_register_20chars() public notUnderCoverage {
        vm.prank(bob);
        registry.register("abcdefghijklmnopqrst");
        vm.snapshotGasLastFrame("register (20 chars)");
    }

    function test_gas_transfer() public notUnderCoverage {
        vm.prank(alice);
        registry.transfer(node, bob);
        vm.snapshotGasLastFrame("transfer");
    }

    function test_gas_setRecord_eth_new() public notUnderCoverage {
        vm.prank(alice);
        resolver.setRecord(node, 60, abi.encodePacked(alice));
        vm.snapshotGasLastFrame("setRecord ETH (new)");
    }

    function test_gas_setRecord_eth_overwrite() public notUnderCoverage {
        vm.startPrank(alice);
        resolver.setRecord(node, 60, abi.encodePacked(alice));
        resolver.setRecord(node, 60, abi.encodePacked(bob));
        vm.stopPrank();
        vm.snapshotGasLastFrame("setRecord ETH (overwrite)");
    }

    function test_gas_setRecord_sol_new() public notUnderCoverage {
        vm.prank(alice);
        resolver.setRecord(node, 501, SOL);
        vm.snapshotGasLastFrame("setRecord SOL 32B (new)");
    }

    function test_gas_setRecord_btc_new() public notUnderCoverage {
        vm.prank(alice);
        resolver.setRecord(node, 0, BTC);
        vm.snapshotGasLastFrame("setRecord BTC 22B (new)");
    }

    function test_gas_setReverse() public notUnderCoverage {
        vm.startPrank(alice);
        resolver.setRecord(node, 60, abi.encodePacked(alice));
        resolver.setReverse(node);
        vm.stopPrank();
        vm.snapshotGasLastFrame("setReverse");
    }

    function test_gas_addr_eth() public notUnderCoverage {
        vm.prank(alice);
        resolver.setRecord(node, 60, abi.encodePacked(alice));
        resolver.addr(node, 60);
        vm.snapshotGasLastFrame("addr ETH");
    }

    function test_gas_addr_sol() public notUnderCoverage {
        vm.prank(alice);
        resolver.setRecord(node, 501, SOL);
        resolver.addr(node, 501);
        vm.snapshotGasLastFrame("addr SOL");
    }

    function test_gas_reverse() public notUnderCoverage {
        vm.startPrank(alice);
        resolver.setRecord(node, 60, abi.encodePacked(alice));
        resolver.setReverse(node);
        vm.stopPrank();
        resolver.reverse(alice);
        vm.snapshotGasLastFrame("reverse");
    }
}

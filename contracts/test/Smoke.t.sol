// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PaytagRegistry} from "../src/PaytagRegistry.sol";
import {PaytagResolver} from "../src/PaytagResolver.sol";
import {Test} from "forge-std/Test.sol";

/// @notice End-to-end happy path. The exhaustive unit, fuzz and invariant suites live alongside.
contract SmokeTest is Test {
    PaytagRegistry registry;
    PaytagResolver resolver;

    address alice = makeAddr("alice");

    function setUp() public {
        registry = new PaytagRegistry();
        resolver = new PaytagResolver(registry);
    }

    function test_registerSetRecordsAndReverse() public {
        vm.startPrank(alice);
        bytes32 node = registry.register("Derrick");
        resolver.setRecord(node, 60, abi.encodePacked(alice));
        resolver.setRecord(node, 501, hex"0102");
        resolver.setReverse(node);
        vm.stopPrank();

        assertEq(node, keccak256("derrick"));
        assertEq(registry.owner(node), alice);
        assertEq(resolver.addr(node, 60), abi.encodePacked(alice));
        assertEq(resolver.addr(node, 501), hex"0102");
        assertEq(resolver.reverse(alice), node);
    }
}

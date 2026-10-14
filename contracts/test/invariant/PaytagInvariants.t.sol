// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PaytagRegistry} from "../../src/PaytagRegistry.sol";
import {PaytagResolver} from "../../src/PaytagResolver.sol";
import {Handler} from "./Handler.sol";
import {Test, console} from "forge-std/Test.sol";

contract PaytagInvariantsTest is Test {
    PaytagRegistry registry;
    PaytagResolver resolver;
    Handler handler;

    function setUp() public {
        registry = new PaytagRegistry();
        resolver = new PaytagResolver(registry);
        handler = new Handler(registry, resolver);

        bytes4[] memory selectors = new bytes4[](6);
        selectors[0] = Handler.register.selector;
        selectors[1] = Handler.transfer.selector;
        selectors[2] = Handler.setEthRecord.selector;
        selectors[3] = Handler.setOtherRecord.selector;
        selectors[4] = Handler.setReverse.selector;
        selectors[5] = Handler.register.selector; // weight registration 2x
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
        targetContract(address(handler));
    }

    /// Every registered node has exactly one owner: non-zero, and the one the model expects.
    function invariant_everyRegisteredNodeHasExactlyOneOwner() public view {
        uint256 n = handler.nodeCount();
        for (uint256 i; i < n; ++i) {
            bytes32 node = handler.nodeAt(i);
            address owner = registry.owner(node);
            assertTrue(owner != address(0), "registered node lost its owner");
            assertEq(owner, handler.ghostOwner(node), "owner diverged from model");
        }
        assertEq(handler.unauthorizedWrites(), 0, "non-owner write succeeded");
    }

    /// Wherever reverse returns a node, the forward ETH record of that node points back.
    function invariant_reverseRoundTrips() public view {
        address[] memory actors = handler.actors();
        for (uint256 i; i < actors.length; ++i) {
            bytes32 node = resolver.reverse(actors[i]);
            if (node == bytes32(0)) continue;
            assertTrue(handler.ghostRegistered(node), "reverse points at unregistered node");
            assertEq(resolver.addr(node, 60), abi.encodePacked(actors[i]), "reverse not forward");
        }
    }

    /// No two distinct normalized names share a node, every node is keccak256 of its name, and
    /// no name or case variant was ever registered twice.
    function invariant_noNameCollisions() public view {
        uint256 n = handler.nodeCount();
        for (uint256 i; i < n; ++i) {
            bytes32 node = handler.nodeAt(i);
            assertEq(node, keccak256(bytes(handler.nameAt(i))), "node is not hash of name");
            assertEq(registry.nodeOf(handler.nameAt(i)), node, "nodeOf disagrees");
            for (uint256 j = i + 1; j < n; ++j) {
                assertTrue(node != handler.nodeAt(j), "two registrations share a node");
            }
        }
        assertEq(handler.duplicateRegistrations(), 0, "duplicate registration");
        assertEq(handler.missedRegistrations(), 0, "fresh valid name failed to register");
    }

    function afterInvariant() external view {
        console.log("register          ", handler.calls("register"));
        console.log("register:taken    ", handler.calls("register:taken"));
        console.log("transfer          ", handler.calls("transfer"));
        console.log("transfer:rejected ", handler.calls("transfer:rejected"));
        console.log("setEthRecord      ", handler.calls("setEthRecord"));
        console.log("setEthRecord:rej  ", handler.calls("setEthRecord:rejected"));
        console.log("setOtherRecord    ", handler.calls("setOtherRecord"));
        console.log("setReverse        ", handler.calls("setReverse"));
        console.log("setReverse:rej    ", handler.calls("setReverse:rejected"));
    }
}

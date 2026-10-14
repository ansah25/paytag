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
    /// Writes succeed exactly when the caller owns the node.
    function invariant_everyRegisteredNodeHasExactlyOneOwner() public view {
        uint256 n = handler.nodeCount();
        for (uint256 i; i < n; ++i) {
            bytes32 node = handler.nodeAt(i);
            address owner = registry.owner(node);
            assertTrue(owner != address(0), "registered node lost its owner");
            assertEq(owner, handler.ghostOwner(node), "owner diverged from model");
        }
        assertEq(handler.unauthorizedWrites(), 0, "non-owner write succeeded");
        assertEq(handler.authorizedReverts(), 0, "owner write with valid input reverted");
    }

    /// Every record the resolver serves equals the last value its owner wrote.
    function invariant_recordsMatchModel() public view {
        uint256 n = handler.nodeCount();
        for (uint256 i; i < n; ++i) {
            bytes32 node = handler.nodeAt(i);
            address eth = handler.ghostEth(node);
            bytes memory expected = eth == address(0) ? bytes("") : abi.encodePacked(eth);
            assertEq(resolver.addr(node, 60), expected, "ETH record diverged from model");
        }
        uint256 k = handler.recordKeyCount();
        for (uint256 i; i < k; ++i) {
            (bytes32 node, uint256 coinType, bytes memory value) = handler.recordAt(i);
            assertEq(resolver.addr(node, coinType), value, "record diverged from model");
        }
    }

    /// Reverse resolution round-trips wherever it is set (`addr(reverse(a), 60) == a`), and
    /// returns exactly what the model predicts: the claim while forward-verified, else zero.
    function invariant_reverseRoundTrips() public view {
        address[] memory actors = handler.actors();
        for (uint256 i; i < actors.length; ++i) {
            bytes32 node = resolver.reverse(actors[i]);
            assertEq(node, handler.expectedReverse(actors[i]), "reverse diverged from model");
            if (node == bytes32(0)) continue;
            assertTrue(handler.ghostRegistered(node), "reverse points at unregistered node");
            assertEq(resolver.addr(node, 60), abi.encodePacked(actors[i]), "reverse not forward");
        }
        assertEq(handler.reverseViolations(), 0, "setReverse outcome disagreed with model");
    }

    /// No two distinct normalized names share a node, every node is keccak256 of its name, no
    /// name or case variant registers twice, and no reserved name registers at all.
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
        assertEq(handler.reservedRegistrations(), 0, "reserved name registered");
    }

    /// Per-run call mix, for eyeballing with -vv. Not asserted: a single 64-call run can
    /// legitimately miss a path, so liveness is enforced by `authorizedReverts` instead.
    function afterInvariant() external view {
        console.log("register          ", handler.calls("register"));
        console.log("register:rejected ", handler.calls("register:rejected"));
        console.log("transfer          ", handler.calls("transfer"));
        console.log("transfer:rejected ", handler.calls("transfer:rejected"));
        console.log("setEthRecord      ", handler.calls("setEthRecord"));
        console.log("setEthRecord:rej  ", handler.calls("setEthRecord:rejected"));
        console.log("setOtherRecord    ", handler.calls("setOtherRecord"));
        console.log("setOtherRecord:rej", handler.calls("setOtherRecord:rejected"));
        console.log("setReverse        ", handler.calls("setReverse"));
        console.log("setReverse:rej    ", handler.calls("setReverse:rejected"));
    }
}

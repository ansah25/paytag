// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PaytagRegistry} from "../src/PaytagRegistry.sol";
import {Names} from "./utils/Names.sol";
import {Test} from "forge-std/Test.sol";

contract PaytagRegistryTest is Test {
    PaytagRegistry registry;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    event NameRegistered(bytes32 indexed node, string name, address indexed owner);
    event Transfer(bytes32 indexed node, address indexed from, address indexed to);

    function setUp() public {
        registry = new PaytagRegistry();
    }

    // ---------------------------------------------------------------- register

    function test_register_setsOwnerAndReturnsNode() public {
        vm.prank(alice);
        bytes32 node = registry.register("derrick");

        assertEq(node, keccak256("derrick"));
        assertEq(registry.owner(node), alice);
    }

    function test_register_emitsEvents() public {
        bytes32 node = keccak256("derrick");

        vm.expectEmit(address(registry));
        emit NameRegistered(node, "derrick", alice);
        vm.expectEmit(address(registry));
        emit Transfer(node, address(0), alice);

        vm.prank(alice);
        registry.register("derrick");
    }

    function test_register_normalizesUppercase() public {
        vm.prank(alice);
        bytes32 node = registry.register("DeRRick_01");

        assertEq(node, keccak256("derrick_01"));
    }

    function test_register_emitsNormalizedName() public {
        vm.expectEmit(address(registry));
        emit NameRegistered(keccak256("derrick"), "derrick", alice);

        vm.prank(alice);
        registry.register("DERRICK");
    }

    function test_register_acceptsLengthBounds() public {
        vm.startPrank(alice);
        registry.register("abc");
        registry.register("abcdefghijklmnopqrst");
        vm.stopPrank();

        assertEq(registry.owner(keccak256("abc")), alice);
        assertEq(registry.owner(keccak256("abcdefghijklmnopqrst")), alice);
    }

    function test_register_acceptsFullCharset() public {
        vm.startPrank(alice);
        registry.register("abcdefghijklm");
        registry.register("nopqrstuvwxyz");
        registry.register("0123456789_");
        vm.stopPrank();
    }

    function test_register_revertsWhenTaken() public {
        vm.prank(alice);
        bytes32 node = registry.register("derrick");

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(PaytagRegistry.NameTaken.selector, node));
        registry.register("derrick");
    }

    function test_register_revertsWhenTakenByCaseVariant() public {
        vm.prank(alice);
        bytes32 node = registry.register("derrick");

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(PaytagRegistry.NameTaken.selector, node));
        registry.register("Derrick");
    }

    function test_register_revertsWhenOwnerReRegisters() public {
        vm.startPrank(alice);
        bytes32 node = registry.register("derrick");
        vm.expectRevert(abi.encodeWithSelector(PaytagRegistry.NameTaken.selector, node));
        registry.register("derrick");
        vm.stopPrank();
    }

    function test_register_revertsOnEmpty() public {
        vm.expectRevert(abi.encodeWithSelector(PaytagRegistry.InvalidLength.selector, 0));
        registry.register("");
    }

    function test_register_revertsTooShort() public {
        vm.expectRevert(abi.encodeWithSelector(PaytagRegistry.InvalidLength.selector, 2));
        registry.register("ab");
    }

    function test_register_revertsTooLong() public {
        vm.expectRevert(abi.encodeWithSelector(PaytagRegistry.InvalidLength.selector, 21));
        registry.register("abcdefghijklmnopqrstu");
    }

    function test_register_revertsOnSpace() public {
        vm.expectRevert(
            abi.encodeWithSelector(PaytagRegistry.InvalidCharacter.selector, 3, bytes1(" "))
        );
        registry.register("der rick");
    }

    function test_register_revertsOnPunctuation() public {
        bytes memory bad = "-.@!/:`{[";
        for (uint256 i; i < bad.length; ++i) {
            bytes memory name = abi.encodePacked("ab", bad[i]);
            vm.expectRevert(
                abi.encodeWithSelector(PaytagRegistry.InvalidCharacter.selector, 2, bad[i])
            );
            registry.register(string(name));
        }
    }

    function test_register_revertsOnNullByte() public {
        vm.expectRevert(
            abi.encodeWithSelector(PaytagRegistry.InvalidCharacter.selector, 1, bytes1(0x00))
        );
        registry.register(string(hex"610062"));
    }

    function test_register_revertsOnCyrillicHomoglyph() public {
        // "pаypal" with a Cyrillic "а" (U+0430, UTF-8 0xD0 0xB0) at byte index 1.
        vm.expectRevert(abi.encodeWithSelector(PaytagRegistry.NonAsciiName.selector, 1));
        registry.register(string(hex"70d0b07970616c"));
    }

    function test_register_revertsOnZeroWidthJoiner() public {
        // "abc" + U+200D (0xE2 0x80 0x8D) appended.
        vm.expectRevert(abi.encodeWithSelector(PaytagRegistry.NonAsciiName.selector, 3));
        registry.register(string(hex"616263e2808d"));
    }

    function test_register_reportsFirstInvalidIndex() public {
        vm.expectRevert(
            abi.encodeWithSelector(PaytagRegistry.InvalidCharacter.selector, 1, bytes1("-"))
        );
        registry.register("a-b c");
    }

    function test_register_lengthCheckedBeforeCharset() public {
        vm.expectRevert(abi.encodeWithSelector(PaytagRegistry.InvalidLength.selector, 2));
        registry.register("-!");
    }

    // ---------------------------------------------------------------- transfer

    function test_transfer_movesOwnership() public {
        vm.prank(alice);
        bytes32 node = registry.register("derrick");

        vm.prank(alice);
        registry.transfer(node, bob);

        assertEq(registry.owner(node), bob);
    }

    function test_transfer_emitsEvent() public {
        vm.prank(alice);
        bytes32 node = registry.register("derrick");

        vm.expectEmit(address(registry));
        emit Transfer(node, alice, bob);

        vm.prank(alice);
        registry.transfer(node, bob);
    }

    function test_transfer_newOwnerCanTransferAgain() public {
        vm.prank(alice);
        bytes32 node = registry.register("derrick");
        vm.prank(alice);
        registry.transfer(node, bob);

        vm.prank(bob);
        registry.transfer(node, alice);

        assertEq(registry.owner(node), alice);
    }

    function test_transfer_toSelfIsAllowed() public {
        vm.startPrank(alice);
        bytes32 node = registry.register("derrick");
        registry.transfer(node, alice);
        vm.stopPrank();

        assertEq(registry.owner(node), alice);
    }

    function test_transfer_revertsForNonOwner() public {
        vm.prank(alice);
        bytes32 node = registry.register("derrick");

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(PaytagRegistry.NotOwner.selector, node, bob));
        registry.transfer(node, bob);
    }

    function test_transfer_revertsForPreviousOwner() public {
        vm.prank(alice);
        bytes32 node = registry.register("derrick");
        vm.prank(alice);
        registry.transfer(node, bob);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(PaytagRegistry.NotOwner.selector, node, alice));
        registry.transfer(node, alice);
    }

    function test_transfer_revertsForUnregisteredNode() public {
        bytes32 node = keccak256("nobody");

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(PaytagRegistry.NotOwner.selector, node, alice));
        registry.transfer(node, bob);
    }

    function test_transfer_revertsForZeroAddress() public {
        vm.startPrank(alice);
        bytes32 node = registry.register("derrick");
        vm.expectRevert(PaytagRegistry.ZeroAddress.selector);
        registry.transfer(node, address(0));
        vm.stopPrank();
    }

    function test_transfer_zeroCallerCannotClaimUnregistered() public {
        // Unregistered nodes have owner == address(0); a zero caller must still be rejected.
        bytes32 node = keccak256("nobody");

        vm.prank(address(0));
        vm.expectRevert(abi.encodeWithSelector(PaytagRegistry.NotOwner.selector, node, address(0)));
        registry.transfer(node, alice);
    }

    // ---------------------------------------------------------------- views

    function test_owner_unregisteredIsZero() public view {
        assertEq(registry.owner(keccak256("nobody")), address(0));
    }

    function test_nodeOf_matchesRegister() public {
        vm.prank(alice);
        bytes32 node = registry.register("Derrick");

        assertEq(registry.nodeOf("DERRICK"), node);
        assertEq(registry.nodeOf("derrick"), node);
    }

    function test_nodeOf_revertsOnInvalid() public {
        vm.expectRevert(abi.encodeWithSelector(PaytagRegistry.InvalidLength.selector, 1));
        registry.nodeOf("a");
    }

    function test_normalize_lowercases() public view {
        assertEq(registry.normalize("ABCxyz_09"), "abcxyz_09");
    }

    function test_constants() public view {
        assertEq(registry.MIN_LENGTH(), 3);
        assertEq(registry.MAX_LENGTH(), 20);
    }

    // ---------------------------------------------------------------- fuzz

    /// normalize(normalize(x)) == normalize(x) for every accepted input.
    function testFuzz_normalizeIsIdempotent(bytes calldata raw) public view {
        try registry.normalize(string(raw)) returns (string memory once) {
            assertEq(registry.normalize(once), once);
        } catch {}
    }

    /// The contract agrees with an independent reference model on every byte string: it accepts
    /// exactly the valid ones and returns their ASCII lowercase.
    function testFuzz_normalizeMatchesReference(bytes calldata raw) public view {
        bool valid = Names.isValid(raw);
        try registry.normalize(string(raw)) returns (string memory out) {
            assertTrue(valid, "accepted an invalid name");
            assertEq(bytes(out), Names.lower(raw));
        } catch {
            assertFalse(valid, "rejected a valid name");
        }
    }

    /// Same check over inputs that are valid far more often than random bytes are.
    function testFuzz_normalizeMatchesReference_validShaped(uint256 seed, uint256 caseMask)
        public
        view
    {
        bytes memory raw = bytes(Names.fromSeed(seed));
        for (uint256 i; i < raw.length; ++i) {
            if ((caseMask >> i) & 1 == 1 && raw[i] >= "a" && raw[i] <= "z") {
                raw[i] = bytes1(uint8(raw[i]) - 32);
            }
        }
        assertEq(bytes(registry.normalize(string(raw))), Names.lower(raw));
    }

    function testFuzz_registerSetsOwner(uint256 seed, address caller) public {
        vm.assume(caller != address(0));
        string memory name = Names.fromSeed(seed);

        vm.prank(caller);
        bytes32 node = registry.register(name);

        assertEq(node, keccak256(bytes(name)));
        assertEq(registry.owner(node), caller);
    }

    function testFuzz_caseVariantIsTaken(uint256 seed) public {
        string memory name = Names.fromSeed(seed);
        vm.prank(alice);
        bytes32 node = registry.register(name);

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(PaytagRegistry.NameTaken.selector, node));
        registry.register(Names.upper(name));
    }

    function testFuzz_distinctNamesGetDistinctNodes(uint256 seedA, uint256 seedB) public {
        string memory a = Names.fromSeed(seedA);
        string memory b = Names.fromSeed(seedB);
        vm.assume(keccak256(bytes(a)) != keccak256(bytes(b)));

        vm.prank(alice);
        bytes32 nodeA = registry.register(a);
        vm.prank(bob);
        bytes32 nodeB = registry.register(b);

        assertTrue(nodeA != nodeB);
        assertEq(registry.owner(nodeA), alice);
        assertEq(registry.owner(nodeB), bob);
    }

    function testFuzz_transferOnlyByOwner(uint256 seed, address stranger, address to) public {
        vm.assume(stranger != alice && to != address(0));
        vm.prank(alice);
        bytes32 node = registry.register(Names.fromSeed(seed));

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(PaytagRegistry.NotOwner.selector, node, stranger));
        registry.transfer(node, to);

        vm.prank(alice);
        registry.transfer(node, to);
        assertEq(registry.owner(node), to);
    }
}

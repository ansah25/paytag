// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PaytagRegistry} from "../src/PaytagRegistry.sol";
import {Names} from "./utils/Names.sol";
import {PaytagTest} from "./utils/PaytagTest.sol";

contract PaytagRegistryTest is PaytagTest {
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
        bytes32 node = _register(registry, alice, "derrick");

        assertEq(node, keccak256("derrick"));
        assertEq(registry.owner(node), alice);
    }

    function test_register_emitsEvents() public {
        bytes32 node = keccak256("derrick");
        _commitAndWait(registry, alice, "derrick");

        vm.expectEmit(address(registry));
        emit NameRegistered(node, "derrick", alice);
        vm.expectEmit(address(registry));
        emit Transfer(node, address(0), alice);

        vm.prank(alice);
        registry.register("derrick", SECRET);
    }

    function test_register_normalizesUppercase() public {
        bytes32 node = _register(registry, alice, "DeRRick_01");

        assertEq(node, keccak256("derrick_01"));
    }

    function test_register_emitsNormalizedName() public {
        _commitAndWait(registry, alice, "DERRICK");
        vm.expectEmit(address(registry));
        emit NameRegistered(keccak256("derrick"), "derrick", alice);

        vm.prank(alice);
        registry.register("DERRICK", SECRET);
    }

    function test_register_acceptsLengthBounds() public {
        _register(registry, alice, "abc");
        _register(registry, alice, "abcdefghijklmnopqrst");

        assertEq(registry.owner(keccak256("abc")), alice);
        assertEq(registry.owner(keccak256("abcdefghijklmnopqrst")), alice);
    }

    function test_register_acceptsFullCharset() public {
        _register(registry, alice, "abcdefghijklm");
        _register(registry, alice, "nopqrstuvwxyz");
        _register(registry, alice, "0123456789_");
    }

    function test_register_revertsWhenTaken() public {
        bytes32 node = _register(registry, alice, "derrick");

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(PaytagRegistry.NameTaken.selector, node));
        registry.register("derrick", SECRET);
    }

    function test_register_revertsWhenTakenByCaseVariant() public {
        bytes32 node = _register(registry, alice, "derrick");

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(PaytagRegistry.NameTaken.selector, node));
        registry.register("Derrick", SECRET);
    }

    function test_register_revertsWhenOwnerReRegisters() public {
        bytes32 node = _register(registry, alice, "derrick");
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(PaytagRegistry.NameTaken.selector, node));
        registry.register("derrick", SECRET);
    }

    function test_register_revertsOnEmpty() public {
        vm.expectRevert(abi.encodeWithSelector(PaytagRegistry.InvalidLength.selector, 0));
        registry.register("", SECRET);
    }

    function test_register_revertsTooShort() public {
        vm.expectRevert(abi.encodeWithSelector(PaytagRegistry.InvalidLength.selector, 2));
        registry.register("ab", SECRET);
    }

    function test_register_revertsTooLong() public {
        vm.expectRevert(abi.encodeWithSelector(PaytagRegistry.InvalidLength.selector, 21));
        registry.register("abcdefghijklmnopqrstu", SECRET);
    }

    function test_register_revertsOnSpace() public {
        vm.expectRevert(
            abi.encodeWithSelector(PaytagRegistry.InvalidCharacter.selector, 3, bytes1(" "))
        );
        registry.register("der rick", SECRET);
    }

    function test_register_revertsOnPunctuation() public {
        bytes memory bad = "-.@!/:`{[";
        for (uint256 i; i < bad.length; ++i) {
            bytes memory name = abi.encodePacked("ab", bad[i]);
            vm.expectRevert(
                abi.encodeWithSelector(PaytagRegistry.InvalidCharacter.selector, 2, bad[i])
            );
            registry.register(string(name), SECRET);
        }
    }

    function test_register_revertsOnNullByte() public {
        vm.expectRevert(
            abi.encodeWithSelector(PaytagRegistry.InvalidCharacter.selector, 1, bytes1(0x00))
        );
        registry.register(string(hex"610062"), SECRET);
    }

    function test_register_revertsOnCyrillicHomoglyph() public {
        // "pаypal" with a Cyrillic "а" (U+0430, UTF-8 0xD0 0xB0) at byte index 1.
        vm.expectRevert(abi.encodeWithSelector(PaytagRegistry.NonAsciiName.selector, 1));
        registry.register(string(hex"70d0b07970616c"), SECRET);
    }

    function test_register_revertsOnZeroWidthJoiner() public {
        // "abc" + U+200D (0xE2 0x80 0x8D) appended.
        vm.expectRevert(abi.encodeWithSelector(PaytagRegistry.NonAsciiName.selector, 3));
        registry.register(string(hex"616263e2808d"), SECRET);
    }

    function test_register_reportsFirstInvalidIndex() public {
        vm.expectRevert(
            abi.encodeWithSelector(PaytagRegistry.InvalidCharacter.selector, 1, bytes1("-"))
        );
        registry.register("a-b c", SECRET);
    }

    function test_register_lengthCheckedBeforeCharset() public {
        vm.expectRevert(abi.encodeWithSelector(PaytagRegistry.InvalidLength.selector, 2));
        registry.register("-!", SECRET);
    }

    function test_register_revertsOnEveryReservedName() public {
        string[] memory names = Names.reserved();
        for (uint256 i; i < names.length; ++i) {
            bytes32 n = keccak256(bytes(names[i]));
            vm.expectRevert(abi.encodeWithSelector(PaytagRegistry.ReservedName.selector, n));
            registry.register(names[i], SECRET);
        }
    }

    function test_register_revertsOnReservedCaseVariant() public {
        vm.expectRevert(
            abi.encodeWithSelector(PaytagRegistry.ReservedName.selector, keccak256("paytag"))
        );
        registry.register("PayTag", SECRET);
    }

    function test_register_allowsNearMissOfReserved() public {
        _register(registry, alice, "paytag_");
        _register(registry, alice, "admin1");
        _register(registry, alice, "apis");
    }

    function test_isReserved_matchesIndependentList() public view {
        string[] memory names = Names.reserved();
        assertEq(names.length, 28);
        for (uint256 i; i < names.length; ++i) {
            assertTrue(registry.isReserved(keccak256(bytes(names[i]))), names[i]);
        }
        assertFalse(registry.isReserved(keccak256("derrick")));
        assertFalse(registry.isReserved(bytes32(0)));
    }

    /// No hash outside the independent list is reserved.
    function testFuzz_isReservedMatchesReference(bytes32 node) public view {
        assertEq(registry.isReserved(node), _inReservedList(node));
    }

    function _inReservedList(bytes32 node) internal pure returns (bool) {
        string[] memory names = Names.reserved();
        for (uint256 i; i < names.length; ++i) {
            if (keccak256(bytes(names[i])) == node) return true;
        }
        return false;
    }

    // ---------------------------------------------------------------- transfer

    function test_transfer_movesOwnership() public {
        bytes32 node = _register(registry, alice, "derrick");

        vm.prank(alice);
        registry.transfer(node, bob);

        assertEq(registry.owner(node), bob);
    }

    function test_transfer_emitsEvent() public {
        bytes32 node = _register(registry, alice, "derrick");

        vm.expectEmit(address(registry));
        emit Transfer(node, alice, bob);

        vm.prank(alice);
        registry.transfer(node, bob);
    }

    function test_transfer_newOwnerCanTransferAgain() public {
        bytes32 node = _register(registry, alice, "derrick");
        vm.prank(alice);
        registry.transfer(node, bob);

        vm.prank(bob);
        registry.transfer(node, alice);

        assertEq(registry.owner(node), alice);
    }

    function test_transfer_toSelfIsAllowed() public {
        bytes32 node = _register(registry, alice, "derrick");
        vm.prank(alice);
        registry.transfer(node, alice);

        assertEq(registry.owner(node), alice);
    }

    function test_transfer_revertsForNonOwner() public {
        bytes32 node = _register(registry, alice, "derrick");

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(PaytagRegistry.NotOwner.selector, node, bob));
        registry.transfer(node, bob);
    }

    function test_transfer_revertsForPreviousOwner() public {
        bytes32 node = _register(registry, alice, "derrick");
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
        bytes32 node = _register(registry, alice, "derrick");
        vm.prank(alice);
        vm.expectRevert(PaytagRegistry.ZeroAddress.selector);
        registry.transfer(node, address(0));
    }

    function test_transfer_zeroCallerCannotClaimUnregistered() public {
        // Unregistered nodes have owner == address(0); a zero caller must still be rejected.
        bytes32 node = keccak256("nobody");

        vm.prank(address(0));
        vm.expectRevert(abi.encodeWithSelector(PaytagRegistry.NotOwner.selector, node, address(0)));
        registry.transfer(node, alice);
    }

    // ---------------------------------------------------------------- commit-reveal

    address mallory = makeAddr("mallory");

    function test_commit_recordsTime() public {
        bytes32 c = registry.makeCommitment("derrick", alice, SECRET);
        vm.prank(alice);
        registry.commit(c);
        assertEq(registry.commitmentTime(alice, c), block.timestamp);
    }

    function test_register_consumesCommitment() public {
        bytes32 c = registry.makeCommitment("derrick", alice, SECRET);
        _register(registry, alice, "derrick");
        assertEq(registry.commitmentTime(alice, c), 0);
    }

    function test_register_revertsWithoutCommitment() public {
        bytes32 c = registry.makeCommitment("derrick", alice, SECRET);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(PaytagRegistry.CommitmentNotFound.selector, c));
        registry.register("derrick", SECRET);
    }

    function test_register_revertsWithWrongSecret() public {
        _commitAndWait(registry, alice, "derrick");
        bytes32 c = registry.makeCommitment("derrick", alice, bytes32(uint256(1)));
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(PaytagRegistry.CommitmentNotFound.selector, c));
        registry.register("derrick", bytes32(uint256(1)));
    }

    function test_register_revertsWhenRevealedFromAnotherWallet() public {
        // The owner is bound into the hash: Alice's commitment doesn't exist for Bob.
        _commitAndWait(registry, alice, "derrick");
        bytes32 c = registry.makeCommitment("derrick", bob, SECRET);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(PaytagRegistry.CommitmentNotFound.selector, c));
        registry.register("derrick", SECRET);
    }

    function test_register_revertsWhenTooNew() public {
        _commit(registry, alice, "derrick");
        bytes32 c = registry.makeCommitment("derrick", alice, SECRET);
        uint256 revealableAt = block.timestamp + registry.MIN_COMMITMENT_AGE();
        vm.warp(revealableAt - 1);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(PaytagRegistry.CommitmentTooNew.selector, c, revealableAt)
        );
        registry.register("derrick", SECRET);
    }

    function test_register_sameBlockRevealRejected() public {
        _commit(registry, alice, "derrick");
        vm.prank(alice);
        vm.expectPartialRevert(PaytagRegistry.CommitmentTooNew.selector);
        registry.register("derrick", SECRET);
    }

    function test_register_acceptsExactMinAndMaxAge() public {
        _commit(registry, alice, "derrick");
        vm.warp(block.timestamp + registry.MIN_COMMITMENT_AGE());
        vm.prank(alice);
        registry.register("derrick", SECRET);

        _commit(registry, alice, "derrick_2");
        vm.warp(block.timestamp + registry.MAX_COMMITMENT_AGE());
        vm.prank(alice);
        registry.register("derrick_2", SECRET);
        assertEq(registry.owner(keccak256("derrick_2")), alice);
    }

    function test_register_revertsWhenTooOld() public {
        _commit(registry, alice, "derrick");
        bytes32 c = registry.makeCommitment("derrick", alice, SECRET);
        uint256 expiredAt = block.timestamp + registry.MAX_COMMITMENT_AGE();
        vm.warp(expiredAt + 1);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(PaytagRegistry.CommitmentTooOld.selector, c, expiredAt)
        );
        registry.register("derrick", SECRET);
    }

    function test_commit_othersCannotRestartYourClock() public {
        // The hash is public once Alice's commit lands; Mallory re-committing it must not touch
        // Alice's commitment (it only creates one under Mallory, which binds Alice and is useless).
        _commit(registry, alice, "derrick");
        bytes32 c = registry.makeCommitment("derrick", alice, SECRET);
        uint256 committedAt = block.timestamp;
        vm.warp(block.timestamp + registry.MIN_COMMITMENT_AGE() - 1);
        vm.prank(mallory);
        registry.commit(c);
        assertEq(registry.commitmentTime(alice, c), committedAt);

        vm.warp(block.timestamp + 1);
        vm.prank(alice);
        bytes32 node = registry.register("derrick", SECRET);
        assertEq(registry.owner(node), alice);
    }

    function test_register_revertedRevealCanBeRetried() public {
        // A reveal sent too early reverts and publishes the name and secret. Alice's commitment
        // survives, so she reveals again as soon as it's ready; Mallory's fresh commitment is too
        // new to race her.
        _commit(registry, alice, "derrick");
        vm.prank(alice);
        vm.expectPartialRevert(PaytagRegistry.CommitmentTooNew.selector);
        registry.register("derrick", SECRET);
        _commit(registry, mallory, "derrick");

        vm.warp(block.timestamp + registry.MIN_COMMITMENT_AGE());
        vm.prank(alice);
        bytes32 node = registry.register("derrick", SECRET);
        assertEq(registry.owner(node), alice);
    }

    function test_commit_recommitRestartsClock() public {
        _commitAndWait(registry, alice, "derrick");
        _commit(registry, alice, "derrick"); // same hash again: clock restarts
        vm.prank(alice);
        vm.expectPartialRevert(PaytagRegistry.CommitmentTooNew.selector);
        registry.register("derrick", SECRET);
    }

    function test_register_pendingRevealCannotBeRaced() public {
        // Mallory sees Alice's reveal (and so the name) pending, and commits to it herself.
        _commitAndWait(registry, alice, "derrick");
        _commit(registry, mallory, "derrick");

        // Racing in the same window fails: her commitment is too new...
        vm.prank(mallory);
        vm.expectPartialRevert(PaytagRegistry.CommitmentTooNew.selector);
        registry.register("derrick", SECRET);

        // ...Alice's reveal lands, and once Mallory's matures the name is already taken.
        vm.prank(alice);
        bytes32 node = registry.register("derrick", SECRET);
        vm.warp(block.timestamp + registry.MIN_COMMITMENT_AGE());
        vm.prank(mallory);
        vm.expectRevert(abi.encodeWithSelector(PaytagRegistry.NameTaken.selector, node));
        registry.register("derrick", SECRET);
        assertEq(registry.owner(node), alice);
    }

    function test_makeCommitment_normalizes() public view {
        assertEq(
            registry.makeCommitment("DeRRick", alice, SECRET),
            registry.makeCommitment("derrick", alice, SECRET)
        );
        assertEq(
            registry.makeCommitment("derrick", alice, SECRET),
            keccak256(abi.encode(keccak256("derrick"), alice, SECRET))
        );
    }

    function test_makeCommitment_revertsOnInvalidName() public {
        vm.expectRevert(abi.encodeWithSelector(PaytagRegistry.InvalidLength.selector, 2));
        registry.makeCommitment("ab", alice, SECRET);
    }

    // ---------------------------------------------------------------- epochs

    function test_epoch_startsAtZero() public {
        bytes32 node = _register(registry, alice, "derrick");
        assertEq(registry.epoch(node), 0);
        (address owner, uint256 epoch) = registry.ownerAndEpoch(node);
        assertEq(owner, alice);
        assertEq(epoch, 0);
    }

    function test_epoch_incrementsOnTransferToSomeoneElse() public {
        bytes32 node = _register(registry, alice, "derrick");
        vm.prank(alice);
        registry.transfer(node, bob);
        assertEq(registry.epoch(node), 1);
        vm.prank(bob);
        registry.transfer(node, alice);
        (address owner, uint256 epoch) = registry.ownerAndEpoch(node);
        assertEq(owner, alice);
        assertEq(epoch, 2);
    }

    function test_epoch_unchangedBySelfTransfer() public {
        bytes32 node = _register(registry, alice, "derrick");
        vm.expectEmit(address(registry));
        emit Transfer(node, alice, alice);
        vm.prank(alice);
        registry.transfer(node, alice);
        assertEq(registry.epoch(node), 0);
    }

    function test_epoch_unregisteredIsZero() public view {
        (address owner, uint256 epoch) = registry.ownerAndEpoch(keccak256("nobody"));
        assertEq(owner, address(0));
        assertEq(epoch, 0);
    }

    // ---------------------------------------------------------------- views

    function test_owner_unregisteredIsZero() public view {
        assertEq(registry.owner(keccak256("nobody")), address(0));
    }

    function test_nodeOf_matchesRegister() public {
        bytes32 node = _register(registry, alice, "Derrick");

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
        assertEq(registry.MIN_COMMITMENT_AGE(), 15);
        assertEq(registry.MAX_COMMITMENT_AGE(), 1 days);
    }

    // ---------------------------------------------------------------- fuzz

    /// normalize(normalize(x)) == normalize(x) for every accepted input; every other input is
    /// rejected. Random bytes are almost never valid, so the valid-shaped variant below carries
    /// most of the idempotence weight.
    function testFuzz_normalizeIsIdempotent(bytes calldata raw) public {
        if (!Names.isValid(raw)) {
            vm.expectRevert();
            registry.normalize(string(raw));
            return;
        }
        string memory once = registry.normalize(string(raw));
        assertEq(registry.normalize(once), once);
    }

    function testFuzz_normalizeIsIdempotent_validShaped(uint256 seed, uint256 caseMask)
        public
        view
    {
        bytes memory raw = _mixedCase(Names.fromSeed(seed), caseMask);
        string memory once = registry.normalize(string(raw));
        assertEq(registry.normalize(once), once);
    }

    /// The contract agrees with an independent reference model on every byte string: it accepts
    /// exactly the valid ones, returns their ASCII lowercase, and rejects the rest with exactly
    /// the error (selector and arguments) the model predicts.
    function testFuzz_normalizeMatchesReference(bytes calldata raw) public view {
        bool valid = Names.isValid(raw);
        try registry.normalize(string(raw)) returns (string memory out) {
            assertTrue(valid, "accepted an invalid name");
            assertEq(bytes(out), Names.lower(raw));
        } catch (bytes memory err) {
            assertFalse(valid, "rejected a valid name");
            assertEq(err, Names.expectedError(raw), "wrong revert reason");
        }
    }

    /// Same check over inputs that are valid far more often than random bytes are.
    function testFuzz_normalizeMatchesReference_validShaped(uint256 seed, uint256 caseMask)
        public
        view
    {
        bytes memory raw = _mixedCase(Names.fromSeed(seed), caseMask);
        assertEq(bytes(registry.normalize(string(raw))), Names.lower(raw));
    }

    function _mixedCase(string memory name, uint256 caseMask) internal pure returns (bytes memory) {
        bytes memory raw = bytes(name);
        for (uint256 i; i < raw.length; ++i) {
            if ((caseMask >> i) & 1 == 1 && raw[i] >= "a" && raw[i] <= "z") {
                raw[i] = bytes1(uint8(raw[i]) - 32);
            }
        }
        return raw;
    }

    function testFuzz_registerSetsOwner(uint256 seed, address caller) public {
        vm.assume(caller != address(0));
        string memory name = Names.fromSeed(seed);

        bytes32 node = _register(registry, caller, name);

        assertEq(node, keccak256(bytes(name)));
        assertEq(registry.owner(node), caller);
    }

    function testFuzz_caseVariantIsTaken(uint256 seed) public {
        string memory name = Names.fromSeed(seed);
        bytes32 node = _register(registry, alice, name);

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(PaytagRegistry.NameTaken.selector, node));
        registry.register(Names.upper(name), SECRET);
    }

    function testFuzz_distinctNamesGetDistinctNodes(uint256 seedA, uint256 seedB) public {
        string memory a = Names.fromSeed(seedA);
        string memory b = Names.fromSeed(seedB);
        vm.assume(keccak256(bytes(a)) != keccak256(bytes(b)));

        bytes32 nodeA = _register(registry, alice, a);
        bytes32 nodeB = _register(registry, bob, b);

        assertTrue(nodeA != nodeB);
        assertEq(registry.owner(nodeA), alice);
        assertEq(registry.owner(nodeB), bob);
    }

    function testFuzz_transferOnlyByOwner(uint256 seed, address stranger, address to) public {
        vm.assume(stranger != alice && to != address(0));
        bytes32 node = _register(registry, alice, Names.fromSeed(seed));

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(PaytagRegistry.NotOwner.selector, node, stranger));
        registry.transfer(node, to);

        vm.prank(alice);
        registry.transfer(node, to);
        assertEq(registry.owner(node), to);
    }
}

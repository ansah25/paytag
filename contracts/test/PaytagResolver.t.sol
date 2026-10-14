// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PaytagRegistry} from "../src/PaytagRegistry.sol";
import {PaytagResolver} from "../src/PaytagResolver.sol";
import {Names} from "./utils/Names.sol";
import {Test} from "forge-std/Test.sol";

contract PaytagResolverTest is Test {
    PaytagRegistry registry;
    PaytagResolver resolver;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    uint256 constant ETH = 60;
    uint256 constant BTC = 0;
    uint256 constant SOL = 501;
    uint256 constant BASE = 0x80000000 | 8453;

    bytes32 node;

    event RecordSet(bytes32 indexed node, uint256 indexed coinType, bytes addr);
    event ReverseSet(address indexed account, bytes32 indexed node);

    function setUp() public {
        registry = new PaytagRegistry();
        resolver = new PaytagResolver(registry);

        vm.prank(alice);
        node = registry.register("derrick");
    }

    function _eth(address a) internal pure returns (bytes memory) {
        return abi.encodePacked(a);
    }

    /// What `addr` should return after `setRecord(coinType, value)`: ETH stores an `address`, so
    /// the 20-zero-byte record is indistinguishable from unset and reads back empty.
    function _expected(uint256 coinType, bytes memory value) internal pure returns (bytes memory) {
        if (coinType == ETH && value.length == 20 && bytes20(value) == bytes20(0)) return "";
        return value;
    }

    // ---------------------------------------------------------------- constructor

    function test_constructor_setsRegistry() public view {
        assertEq(address(resolver.registry()), address(registry));
        assertEq(resolver.COIN_TYPE_ETH(), 60);
    }

    // ---------------------------------------------------------------- setRecord / addr

    function test_setRecord_storesEth() public {
        vm.prank(alice);
        resolver.setRecord(node, ETH, _eth(alice));

        assertEq(resolver.addr(node, ETH), _eth(alice));
    }

    function test_setRecord_storesNonEvmOpaqueBytes() public {
        bytes memory btc = hex"0014751e76e8199196d454941c45d1b3a323f1433bd6"; // P2WPKH script
        bytes memory sol = abi.encodePacked(keccak256("solana-pubkey")); // 32 bytes

        vm.startPrank(alice);
        resolver.setRecord(node, BTC, btc);
        resolver.setRecord(node, SOL, sol);
        resolver.setRecord(node, BASE, _eth(bob));
        vm.stopPrank();

        assertEq(resolver.addr(node, BTC), btc);
        assertEq(resolver.addr(node, SOL), sol);
        assertEq(resolver.addr(node, BASE), _eth(bob));
    }

    function test_setRecord_emitsEvent() public {
        vm.expectEmit(address(resolver));
        emit RecordSet(node, ETH, _eth(alice));

        vm.prank(alice);
        resolver.setRecord(node, ETH, _eth(alice));
    }

    function test_setRecord_overwrites() public {
        vm.startPrank(alice);
        resolver.setRecord(node, SOL, hex"01");
        resolver.setRecord(node, SOL, hex"0202");
        vm.stopPrank();

        assertEq(resolver.addr(node, SOL), hex"0202");
    }

    function test_setRecord_emptyClears() public {
        vm.startPrank(alice);
        resolver.setRecord(node, ETH, _eth(alice));
        resolver.setRecord(node, ETH, "");
        vm.stopPrank();

        assertEq(resolver.addr(node, ETH).length, 0);
    }

    function test_setRecord_zeroEthAddressReadsAsUnset() public {
        vm.startPrank(alice);
        resolver.setRecord(node, ETH, _eth(alice));
        resolver.setRecord(node, ETH, _eth(address(0)));
        vm.stopPrank();

        assertEq(resolver.addr(node, ETH).length, 0);
    }

    function test_setRecord_zeroEthAddressDarkensReverse() public {
        vm.startPrank(alice);
        resolver.setRecord(node, ETH, _eth(alice));
        resolver.setReverse(node);
        resolver.setRecord(node, ETH, _eth(address(0)));
        vm.stopPrank();

        assertEq(resolver.reverse(alice), bytes32(0));
    }

    function test_setRecord_ethClearEmitsEmptyValue() public {
        vm.prank(alice);
        resolver.setRecord(node, ETH, _eth(alice));

        vm.expectEmit(address(resolver));
        emit RecordSet(node, ETH, "");

        vm.prank(alice);
        resolver.setRecord(node, ETH, "");
    }

    function test_setRecord_coinTypesAreIndependent() public {
        vm.startPrank(alice);
        resolver.setRecord(node, ETH, _eth(alice));
        resolver.setRecord(node, SOL, hex"aa");
        resolver.setRecord(node, SOL, "");
        vm.stopPrank();

        assertEq(resolver.addr(node, ETH), _eth(alice));
    }

    function test_setRecord_revertsForNonOwner() public {
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(PaytagResolver.NotOwner.selector, node, bob));
        resolver.setRecord(node, ETH, _eth(bob));
    }

    function test_setRecord_revertsForUnregisteredNode() public {
        bytes32 other = keccak256("nobody");

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(PaytagResolver.NotOwner.selector, other, alice));
        resolver.setRecord(other, ETH, _eth(alice));
    }

    function test_setRecord_revertsForZeroCallerOnUnregistered() public {
        bytes32 other = keccak256("nobody");

        vm.prank(address(0));
        vm.expectRevert(abi.encodeWithSelector(PaytagResolver.NotOwner.selector, other, address(0)));
        resolver.setRecord(other, SOL, hex"01");
    }

    function test_setRecord_revertsOnShortEth() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(PaytagResolver.InvalidEthAddress.selector, 19));
        resolver.setRecord(node, ETH, new bytes(19));
    }

    function test_setRecord_revertsOnLongEth() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(PaytagResolver.InvalidEthAddress.selector, 32));
        resolver.setRecord(node, ETH, abi.encode(alice)); // abi.encode pads to 32 bytes
    }

    function test_setRecord_lengthRuleOnlyAppliesToEth() public {
        vm.prank(alice);
        resolver.setRecord(node, BASE, abi.encode(alice));

        assertEq(resolver.addr(node, BASE).length, 32);
    }

    function test_setRecord_previousOwnerLosesAccessAfterTransfer() public {
        vm.prank(alice);
        registry.transfer(node, bob);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(PaytagResolver.NotOwner.selector, node, alice));
        resolver.setRecord(node, ETH, _eth(alice));

        vm.prank(bob);
        resolver.setRecord(node, ETH, _eth(bob));
        assertEq(resolver.addr(node, ETH), _eth(bob));
    }

    function test_setRecord_recordsSurviveTransfer() public {
        vm.prank(alice);
        resolver.setRecord(node, SOL, hex"abcd");
        vm.prank(alice);
        registry.transfer(node, bob);

        assertEq(resolver.addr(node, SOL), hex"abcd");
    }

    function test_addr_unsetIsEmpty() public view {
        assertEq(resolver.addr(node, ETH).length, 0);
        assertEq(resolver.addr(keccak256("nobody"), SOL).length, 0);
    }

    // ---------------------------------------------------------------- reverse

    function test_setReverse_roundTrips() public {
        vm.startPrank(alice);
        resolver.setRecord(node, ETH, _eth(alice));
        resolver.setReverse(node);
        vm.stopPrank();

        assertEq(resolver.reverse(alice), node);
    }

    function test_setReverse_emitsEvent() public {
        vm.prank(alice);
        resolver.setRecord(node, ETH, _eth(alice));

        vm.expectEmit(address(resolver));
        emit ReverseSet(alice, node);

        vm.prank(alice);
        resolver.setReverse(node);
    }

    function test_setReverse_nonOwnerCanClaimIfForwardPointsAtThem() public {
        // Alice owns the name but points its ETH record at Bob; Bob may claim it in reverse.
        vm.prank(alice);
        resolver.setRecord(node, ETH, _eth(bob));

        vm.prank(bob);
        resolver.setReverse(node);

        assertEq(resolver.reverse(bob), node);
    }

    function test_setReverse_revertsWithoutEthRecord() public {
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(PaytagResolver.ReverseMismatch.selector, node, alice)
        );
        resolver.setReverse(node);
    }

    function test_setReverse_revertsWhenEthRecordIsSomeoneElse() public {
        vm.prank(alice);
        resolver.setRecord(node, ETH, _eth(bob));

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(PaytagResolver.ReverseMismatch.selector, node, alice)
        );
        resolver.setReverse(node);
    }

    function test_setReverse_revertsForUnregisteredNode() public {
        bytes32 other = keccak256("nobody");

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(PaytagResolver.ReverseMismatch.selector, other, alice)
        );
        resolver.setReverse(other);
    }

    function test_setReverse_zeroClears() public {
        vm.startPrank(alice);
        resolver.setRecord(node, ETH, _eth(alice));
        resolver.setReverse(node);

        vm.expectEmit(address(resolver));
        emit ReverseSet(alice, bytes32(0));
        resolver.setReverse(bytes32(0));
        vm.stopPrank();

        assertEq(resolver.reverse(alice), bytes32(0));
    }

    function test_setReverse_zeroWorksWithNoPriorEntry() public {
        vm.prank(bob);
        resolver.setReverse(bytes32(0));

        assertEq(resolver.reverse(bob), bytes32(0));
    }

    function test_setReverse_switchesBetweenNames() public {
        vm.startPrank(alice);
        bytes32 second = registry.register("derrick_2");
        resolver.setRecord(node, ETH, _eth(alice));
        resolver.setRecord(second, ETH, _eth(alice));
        resolver.setReverse(node);
        resolver.setReverse(second);
        vm.stopPrank();

        assertEq(resolver.reverse(alice), second);
    }

    function test_reverse_unsetIsZero() public view {
        assertEq(resolver.reverse(alice), bytes32(0));
    }

    function test_reverse_goesDarkWhenForwardRecordChanges() public {
        vm.startPrank(alice);
        resolver.setRecord(node, ETH, _eth(alice));
        resolver.setReverse(node);
        resolver.setRecord(node, ETH, _eth(bob));
        vm.stopPrank();

        assertEq(resolver.reverse(alice), bytes32(0));
    }

    function test_reverse_goesDarkWhenForwardRecordCleared() public {
        vm.startPrank(alice);
        resolver.setRecord(node, ETH, _eth(alice));
        resolver.setReverse(node);
        resolver.setRecord(node, ETH, "");
        vm.stopPrank();

        assertEq(resolver.reverse(alice), bytes32(0));
    }

    function test_reverse_newOwnerRepointingRecordDarkensOldReverse() public {
        vm.startPrank(alice);
        resolver.setRecord(node, ETH, _eth(alice));
        resolver.setReverse(node);
        registry.transfer(node, bob);
        vm.stopPrank();

        // Transfer alone leaves the forward record pointing at Alice, so her reverse still holds.
        assertEq(resolver.reverse(alice), node);

        vm.prank(bob);
        resolver.setRecord(node, ETH, _eth(bob));
        assertEq(resolver.reverse(alice), bytes32(0));
    }

    function test_reverse_reappearsIfForwardRecordRestored() public {
        // Documented behavior: the stored claim persists; only its visibility is gated on the
        // forward record. Restoring the record restores the reverse lookup.
        vm.startPrank(alice);
        resolver.setRecord(node, ETH, _eth(alice));
        resolver.setReverse(node);
        resolver.setRecord(node, ETH, _eth(bob));
        resolver.setRecord(node, ETH, _eth(alice));
        vm.stopPrank();

        assertEq(resolver.reverse(alice), node);
    }

    // ---------------------------------------------------------------- fuzz

    /// Register any accepted byte string, set a record, read it back. Rejected strings must be
    /// rejected by register too.
    function testFuzz_registerThenResolve(
        bytes calldata raw,
        address caller,
        uint256 coinType,
        bytes calldata value
    ) public {
        vm.assume(caller != address(0));
        if (coinType == ETH) value = value.length >= 20 ? value[:20] : value[:0];

        bool valid = Names.isValid(raw);
        vm.prank(caller);
        try registry.register(string(raw)) returns (bytes32 n) {
            assertTrue(valid, "registered an invalid name");
            assertEq(n, keccak256(Names.lower(raw)));

            vm.prank(caller);
            resolver.setRecord(n, coinType, value);
            assertEq(resolver.addr(n, coinType), _expected(coinType, value));
        } catch (bytes memory err) {
            bytes4 sel = bytes4(err);
            if (sel == PaytagRegistry.NameTaken.selector) {
                assertEq(registry.owner(keccak256(Names.lower(raw))), alice); // only "derrick"
            } else {
                assertFalse(valid, "rejected a valid name");
            }
        }
    }

    function testFuzz_registerThenResolve_validShaped(
        uint256 seed,
        address caller,
        uint256 coinType,
        bytes calldata value
    ) public {
        vm.assume(caller != address(0));
        string memory name = Names.fromSeed(seed);
        vm.assume(keccak256(bytes(name)) != node);
        if (coinType == ETH) value = value.length >= 20 ? value[:20] : value[:0];

        vm.startPrank(caller);
        bytes32 n = registry.register(name);
        resolver.setRecord(n, coinType, value);
        vm.stopPrank();

        assertEq(resolver.addr(n, coinType), _expected(coinType, value));
    }

    function testFuzz_ethRecordRejectsWrongLength(bytes calldata value) public {
        vm.assume(value.length != 0 && value.length != 20);

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(PaytagResolver.InvalidEthAddress.selector, value.length)
        );
        resolver.setRecord(node, ETH, value);
    }

    function testFuzz_setRecordOnlyByOwner(address stranger, uint256 coinType) public {
        vm.assume(stranger != alice);

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(PaytagResolver.NotOwner.selector, node, stranger));
        resolver.setRecord(node, coinType, "");
    }

    function testFuzz_reverseRequiresForwardMatch(address claimant, address target) public {
        vm.prank(alice);
        resolver.setRecord(node, ETH, _eth(target));

        vm.prank(claimant);
        if (claimant == target) {
            resolver.setReverse(node);
            assertEq(resolver.reverse(claimant), node);
        } else {
            vm.expectRevert(
                abi.encodeWithSelector(PaytagResolver.ReverseMismatch.selector, node, claimant)
            );
            resolver.setReverse(node);
        }
    }
}

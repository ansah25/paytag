// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PaytagRegistry} from "../../src/PaytagRegistry.sol";
import {PaytagResolver} from "../../src/PaytagResolver.sol";
import {Names} from "../utils/Names.sol";
import {CommonBase} from "forge-std/Base.sol";
import {StdCheats} from "forge-std/StdCheats.sol";
import {StdUtils} from "forge-std/StdUtils.sol";

/// @notice Drives random sequences of register / transfer / setRecord / setReverse across a fixed
///         set of actors and keeps a full ghost model of ownership, records and reverse claims.
///
///         Every action predicts its own outcome. A call the model says must succeed (owner
///         caller, valid input) that reverts is a liveness violation; a call the model says must
///         revert that succeeds is a safety violation. Both are counted and asserted zero, so
///         neither "everything reverts" nor "nothing is checked" can pass.
contract Handler is CommonBase, StdCheats, StdUtils {
    PaytagRegistry public immutable registry;
    PaytagResolver public immutable resolver;

    uint256 internal constant ETH = 60;

    struct RecordKey {
        bytes32 node;
        uint256 coinType;
    }

    address[] internal _actors;

    // Ghost model.
    string[] internal _names; // normalized, in registration order
    bytes32[] internal _nodes;
    RecordKey[] internal _recordKeys; // every (node, coinType) ever written, non-ETH
    mapping(bytes32 node => address owner) public ghostOwner;
    mapping(bytes32 node => bool registered) public ghostRegistered;
    mapping(bytes32 node => address eth) public ghostEth;
    mapping(bytes32 node => mapping(uint256 coinType => bytes value)) internal _ghostRecord;
    mapping(bytes32 node => mapping(uint256 coinType => bool seen)) internal _recordSeen;
    mapping(address account => bytes32 node) public ghostClaim;

    // Violation counters: any non-zero value fails an invariant.
    uint256 public duplicateRegistrations; // a name or case variant registered twice
    uint256 public missedRegistrations; // a fresh, valid, unreserved name that failed
    uint256 public reservedRegistrations; // a reserved name that registered
    uint256 public unauthorizedWrites; // a non-owner write that succeeded
    uint256 public authorizedReverts; // an owner write with valid input that reverted
    uint256 public reverseViolations; // setReverse outcome disagreed with the forward record

    // Per-run call counters, logged by the invariant suite's afterInvariant.
    mapping(bytes32 action => uint256 count) public calls;

    constructor(PaytagRegistry registry_, PaytagResolver resolver_) {
        registry = registry_;
        resolver = resolver_;
        for (uint256 i; i < 5; ++i) {
            _actors.push(makeAddr(string.concat("actor", vm.toString(i))));
        }
    }

    // ------------------------------------------------------------------ actions

    /// Registers a name from a wide space (mostly fresh), a crowded one (mostly taken, often as
    /// a case variant), or the reserved list (always rejected), chosen by `mode`.
    function register(uint256 actorSeed, uint256 nameSeed, uint8 mode) external {
        address actor = _actor(actorSeed);
        string memory name;
        if (mode % 3 == 0) {
            name = Names.fromSeed(nameSeed);
        } else if (mode % 3 == 1) {
            name = Names.crowded(nameSeed);
        } else {
            string[] memory reserved = Names.reserved();
            name = reserved[nameSeed % reserved.length];
            if (nameSeed & 1 == 1) name = Names.upper(name);
        }
        bytes memory lowered = Names.lower(bytes(name));
        bytes32 expected = keccak256(lowered);
        bool isReserved = Names.isReserved(lowered);

        vm.prank(actor);
        try registry.register(name) returns (bytes32 node) {
            if (isReserved) ++reservedRegistrations;
            if (ghostRegistered[node] || node != expected) ++duplicateRegistrations;
            ghostRegistered[node] = true;
            ghostOwner[node] = actor;
            _names.push(string(lowered));
            _nodes.push(node);
            ++calls["register"];
        } catch {
            if (!isReserved && !ghostRegistered[expected]) ++missedRegistrations;
            ++calls["register:rejected"];
        }
    }

    function transfer(uint256 nodeSeed, uint256 callerSeed, uint256 toSeed, bool asOwner) external {
        if (_nodes.length == 0) return;
        bytes32 node = _node(nodeSeed);
        address owner = ghostOwner[node];
        address caller = asOwner ? owner : _actor(callerSeed);
        address to = _actor(toSeed);

        vm.prank(caller);
        try registry.transfer(node, to) {
            if (caller != owner) ++unauthorizedWrites;
            ghostOwner[node] = to;
            ++calls["transfer"];
        } catch {
            if (caller == owner) ++authorizedReverts;
            ++calls["transfer:rejected"];
        }
    }

    /// Points a name's ETH record at one of the actors (or clears it).
    function setEthRecord(uint256 nodeSeed, uint256 targetSeed, bool asOwner, bool clear) external {
        if (_nodes.length == 0) return;
        bytes32 node = _node(nodeSeed);
        address owner = ghostOwner[node];
        address caller = asOwner ? owner : _actor(targetSeed / 7);
        address target = clear ? address(0) : _actor(targetSeed);
        bytes memory value = clear ? bytes("") : abi.encodePacked(target);

        vm.prank(caller);
        try resolver.setRecord(node, ETH, value) {
            if (caller != owner) ++unauthorizedWrites;
            ghostEth[node] = target;
            ++calls["setEthRecord"];
        } catch {
            if (caller == owner) ++authorizedReverts;
            ++calls["setEthRecord:rejected"];
        }
    }

    /// Writes an opaque non-ETH record. A small coin-type set keeps overwrites frequent.
    function setOtherRecord(
        uint256 nodeSeed,
        uint256 callerSeed,
        uint8 coinSeed,
        bool asOwner,
        bytes calldata value
    ) external {
        if (_nodes.length == 0) return;
        bytes32 node = _node(nodeSeed);
        address owner = ghostOwner[node];
        address caller = asOwner ? owner : _actor(callerSeed);
        uint256 coinType = _otherCoinType(coinSeed);

        vm.prank(caller);
        try resolver.setRecord(node, coinType, value) {
            if (caller != owner) ++unauthorizedWrites;
            _ghostRecord[node][coinType] = value;
            if (!_recordSeen[node][coinType]) {
                _recordSeen[node][coinType] = true;
                _recordKeys.push(RecordKey(node, coinType));
            }
            ++calls["setOtherRecord"];
        } catch {
            if (caller == owner) ++authorizedReverts;
            ++calls["setOtherRecord:rejected"];
        }
    }

    function setReverse(uint256 actorSeed, uint256 nodeSeed, bool clear) external {
        address actor = _actor(actorSeed);
        bytes32 node = clear || _nodes.length == 0 ? bytes32(0) : _node(nodeSeed);
        bool shouldSucceed = node == bytes32(0) || ghostEth[node] == actor;

        vm.prank(actor);
        try resolver.setReverse(node) {
            if (!shouldSucceed) ++reverseViolations;
            ghostClaim[actor] = node;
            ++calls["setReverse"];
        } catch {
            if (shouldSucceed) ++reverseViolations;
            ++calls["setReverse:rejected"];
        }
    }

    // ------------------------------------------------------------------ views for invariants

    function actors() external view returns (address[] memory) {
        return _actors;
    }

    function nodeCount() external view returns (uint256) {
        return _nodes.length;
    }

    function nodeAt(uint256 i) external view returns (bytes32) {
        return _nodes[i];
    }

    function nameAt(uint256 i) external view returns (string memory) {
        return _names[i];
    }

    function recordKeyCount() external view returns (uint256) {
        return _recordKeys.length;
    }

    function recordAt(uint256 i)
        external
        view
        returns (bytes32 node, uint256 coinType, bytes memory value)
    {
        RecordKey memory k = _recordKeys[i];
        return (k.node, k.coinType, _ghostRecord[k.node][k.coinType]);
    }

    /// What `reverse(account)` must return under the model.
    function expectedReverse(address account) external view returns (bytes32) {
        bytes32 claim = ghostClaim[account];
        return claim != bytes32(0) && ghostEth[claim] == account ? claim : bytes32(0);
    }

    // ------------------------------------------------------------------ helpers

    function _actor(uint256 seed) internal view returns (address) {
        return _actors[seed % _actors.length];
    }

    function _node(uint256 seed) internal view returns (bytes32) {
        return _nodes[seed % _nodes.length];
    }

    function _otherCoinType(uint8 seed) internal pure returns (uint256) {
        uint256 pick = seed % 3;
        if (pick == 0) return 0; // BTC
        if (pick == 1) return 501; // SOL
        return 0x80000000 | 8453; // Base (ENSIP-11)
    }
}

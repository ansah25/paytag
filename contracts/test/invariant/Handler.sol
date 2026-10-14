// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PaytagRegistry} from "../../src/PaytagRegistry.sol";
import {PaytagResolver} from "../../src/PaytagResolver.sol";
import {Names} from "../utils/Names.sol";
import {CommonBase} from "forge-std/Base.sol";
import {StdCheats} from "forge-std/StdCheats.sol";
import {StdUtils} from "forge-std/StdUtils.sol";

/// @notice Drives random sequences of register / transfer / setRecord / setReverse across a fixed
///         set of actors and keeps a ghost model the invariants compare against.
contract Handler is CommonBase, StdCheats, StdUtils {
    PaytagRegistry public immutable registry;
    PaytagResolver public immutable resolver;

    uint256 internal constant ETH = 60;

    address[] internal _actors;

    // Ghost model.
    string[] internal _names; // normalized, in registration order
    bytes32[] internal _nodes;
    mapping(bytes32 node => address owner) public ghostOwner;
    mapping(bytes32 node => bool registered) public ghostRegistered;

    // Violation counters: any non-zero value fails an invariant.
    uint256 public duplicateRegistrations; // a name or case variant registered twice
    uint256 public missedRegistrations; // a fresh valid name that failed to register
    uint256 public unauthorizedWrites; // a non-owner write that did not revert

    // Call counters, so a run that never exercised a path is visible in the summary.
    mapping(bytes32 action => uint256 count) public calls;

    constructor(PaytagRegistry registry_, PaytagResolver resolver_) {
        registry = registry_;
        resolver = resolver_;
        for (uint256 i; i < 5; ++i) {
            _actors.push(makeAddr(string.concat("actor", vm.toString(i))));
        }
    }

    // ------------------------------------------------------------------ actions

    /// Registers a name from either a wide space (mostly fresh) or a crowded one (mostly taken,
    /// often as a case variant), so both the success and the collision paths stay busy.
    function register(uint256 actorSeed, uint256 nameSeed, bool crowded) external {
        address actor = _actor(actorSeed);
        string memory name = crowded ? Names.crowded(nameSeed) : Names.fromSeed(nameSeed);
        bytes32 expected = keccak256(Names.lower(bytes(name)));

        vm.prank(actor);
        try registry.register(name) returns (bytes32 node) {
            if (ghostRegistered[node] || node != expected) ++duplicateRegistrations;
            ghostRegistered[node] = true;
            ghostOwner[node] = actor;
            _names.push(string(Names.lower(bytes(name))));
            _nodes.push(node);
            ++calls["register"];
        } catch {
            if (!ghostRegistered[expected]) ++missedRegistrations;
            ++calls["register:taken"];
        }
    }

    function transfer(uint256 nodeSeed, uint256 callerSeed, uint256 toSeed) external {
        if (_nodes.length == 0) return;
        bytes32 node = _node(nodeSeed);
        address caller = _actor(callerSeed);
        address to = _actor(toSeed);

        vm.prank(caller);
        try registry.transfer(node, to) {
            if (caller != ghostOwner[node]) ++unauthorizedWrites;
            ghostOwner[node] = to;
            ++calls["transfer"];
        } catch {
            ++calls["transfer:rejected"];
        }
    }

    /// Points a name's ETH record at one of the actors (or clears it), usually as the owner.
    function setEthRecord(uint256 nodeSeed, uint256 targetSeed, bool asOwner, bool clear) external {
        if (_nodes.length == 0) return;
        bytes32 node = _node(nodeSeed);
        address caller = asOwner
            ? ghostOwner[node]
            : _actors[(targetSeed % _actors.length + 1) % _actors.length];
        bytes memory value = clear ? bytes("") : abi.encodePacked(_actor(targetSeed));

        vm.prank(caller);
        try resolver.setRecord(node, ETH, value) {
            if (caller != ghostOwner[node]) ++unauthorizedWrites;
            ++calls["setEthRecord"];
        } catch {
            ++calls["setEthRecord:rejected"];
        }
    }

    function setOtherRecord(uint256 nodeSeed, uint256 coinType, bytes calldata value) external {
        if (_nodes.length == 0) return;
        if (coinType == ETH) coinType = 501;
        bytes32 node = _node(nodeSeed);

        vm.prank(ghostOwner[node]);
        resolver.setRecord(node, coinType, value);
        ++calls["setOtherRecord"];
    }

    function setReverse(uint256 actorSeed, uint256 nodeSeed, bool clear) external {
        address actor = _actor(actorSeed);
        bytes32 node = clear || _nodes.length == 0 ? bytes32(0) : _node(nodeSeed);

        vm.prank(actor);
        try resolver.setReverse(node) {
            ++calls["setReverse"];
        } catch {
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

    // ------------------------------------------------------------------ helpers

    function _actor(uint256 seed) internal view returns (address) {
        return _actors[seed % _actors.length];
    }

    function _node(uint256 seed) internal view returns (bytes32) {
        return _nodes[seed % _nodes.length];
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PaytagRegistry} from "../../src/PaytagRegistry.sol";
import {Test} from "forge-std/Test.sol";

/// @notice Shared helpers for the two-step (commit-reveal) registration.
abstract contract PaytagTest is Test {
    bytes32 internal constant SECRET = keccak256("paytag test secret");

    /// Commits to (name, who, SECRET) from `who`.
    function _commit(PaytagRegistry r, address who, string memory name) internal {
        bytes32 commitment = r.makeCommitment(name, who, SECRET);
        vm.prank(who);
        r.commit(commitment);
    }

    /// Commits and waits until the commitment is revealable, without revealing.
    function _commitAndWait(PaytagRegistry r, address who, string memory name) internal {
        _commit(r, who, name);
        vm.warp(block.timestamp + r.MIN_COMMITMENT_AGE());
    }

    /// The full registration: commit, wait the minimum age, reveal. Reverts like `register`.
    function _register(PaytagRegistry r, address who, string memory name)
        internal
        returns (bytes32 node)
    {
        _commitAndWait(r, who, name);
        vm.prank(who);
        node = r.register(name, SECRET);
    }
}

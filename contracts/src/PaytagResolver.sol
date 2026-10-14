// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PaytagRegistry} from "./PaytagRegistry.sol";

/// @title PaytagResolver
/// @notice Multi-chain address records and reverse resolution for Paytag names.
/// @dev Records are keyed by coin type exactly as ENSIP-9 / SLIP-44 does it, so non-EVM chains
///      slot in without a custom scheme:
///        - 60          Ethereum (20-byte address, enforced on-chain)
///        - 0           Bitcoin  (opaque bytes, encoded by the SDK)
///        - 501         Solana   (opaque bytes, encoded by the SDK)
///        - 0x80000000 | chainId for other EVM chains (ENSIP-11), e.g. Base = 2147492101
///      Base is the canonical registry; other chains are records, never parallel deployments.
///
///      Reverse resolution is forward-verified: an address can only claim a node whose ETH
///      record points back at it, and `reverse` re-checks that on every read. A reverse entry
///      therefore goes dark (returns zero) the moment the forward record changes, which keeps
///      `reverse(addr(node)) == node` true whenever reverse returns non-zero.
///
///      Storage: ETH records live in a dedicated `address` mapping rather than as `bytes`, so the
///      reverse check is one SLOAD with no memory decode. The zero address is used as "unset",
///      so writing it is rejected: clearing has exactly one encoding (empty bytes) and every
///      `RecordSet` payload equals what `addr` returns afterwards.
///
///      Indexers: reverse validity is not derivable from `ReverseSet` alone. A coin-60
///      `RecordSet` silently darkens any reverse claim pointing at the old address, so compute
///      `reverse(a) = claim[a]` only while `eth[claim[a]] == a`.
contract PaytagResolver {
    uint256 public constant COIN_TYPE_ETH = 60;

    PaytagRegistry public immutable registry;

    mapping(bytes32 node => address eth) private _ethRecords;
    mapping(bytes32 node => mapping(uint256 coinType => bytes addr)) private _records;
    mapping(address account => bytes32 node) private _reverse;

    event RecordSet(bytes32 indexed node, uint256 indexed coinType, bytes addr);
    event ReverseSet(address indexed account, bytes32 indexed node);

    error NotOwner(bytes32 node, address caller);
    error InvalidEthAddress(uint256 length);
    error ZeroEthAddress();
    error ReverseMismatch(bytes32 node, address account);

    constructor(PaytagRegistry registry_) {
        registry = registry_;
    }

    /// @notice Sets the `coinType` record for `node`. Empty `value` clears it.
    function setRecord(bytes32 node, uint256 coinType, bytes calldata value) external {
        address nodeOwner = registry.owner(node);
        if (nodeOwner == address(0) || nodeOwner != msg.sender) revert NotOwner(node, msg.sender);
        if (coinType == COIN_TYPE_ETH) {
            if (value.length != 0 && value.length != 20) revert InvalidEthAddress(value.length);
            // casting to 'bytes20' is safe because length is exactly 20, or 0 which pads to zero
            // (the clear case)
            // forge-lint: disable-next-line(unsafe-typecast)
            address eth = address(bytes20(value));
            if (value.length == 20 && eth == address(0)) revert ZeroEthAddress();
            _ethRecords[node] = eth;
        } else {
            _records[node][coinType] = value;
        }
        emit RecordSet(node, coinType, value);
    }

    /// @notice Raw record bytes for `node` on `coinType`, or empty if unset.
    function addr(bytes32 node, uint256 coinType) external view returns (bytes memory) {
        if (coinType == COIN_TYPE_ETH) {
            address eth = _ethRecords[node];
            return eth == address(0) ? bytes("") : abi.encodePacked(eth);
        }
        return _records[node][coinType];
    }

    /// @notice Points the caller's reverse record at `node`. Requires `node`'s ETH record to be
    ///         the caller. Pass `bytes32(0)` to clear.
    function setReverse(bytes32 node) external {
        if (node != bytes32(0) && _ethRecords[node] != msg.sender) {
            revert ReverseMismatch(node, msg.sender);
        }

        _reverse[msg.sender] = node;
        emit ReverseSet(msg.sender, node);
    }

    /// @notice Node `account` has claimed, or zero if unset or no longer forward-verified.
    function reverse(address account) external view returns (bytes32) {
        bytes32 node = _reverse[account];
        if (node == bytes32(0) || _ethRecords[node] != account) return bytes32(0);
        return node;
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title PaytagRegistry
/// @notice Canonical ownership registry for Paytag names. One flat namespace (`@derrick`, not
///         `derrick.paytag`), so a node is simply `keccak256(normalize(name))`.
/// @dev Immutable and admin-free: no owner, no pause, no upgrade path. Registration is
///      first-come, free and permanent. Front-running and squatting are accepted trade-offs for
///      this deployment and are documented in the README.
///
///      Name policy (mirrors the off-chain API's username rules so both layers agree):
///        - 3 to 20 bytes after normalization
///        - allowed characters: a-z, 0-9, underscore
///        - ASCII A-Z is lowercased; every other character reverts. Nothing is silently dropped
///          or substituted, so normalization is idempotent and two distinct normalized names can
///          never hash to the same node except by a keccak256 collision.
///
///      Homoglyph policy: any byte >= 0x80 reverts with `NonAsciiName`. Restricting to ASCII
///      eliminates Unicode confusables (Cyrillic "а" vs Latin "a", zero-width joiners, etc.)
///      outright. The remaining ASCII look-alikes (`0`/`o`, `1`/`l`) are an accepted risk: they
///      are visually distinct in every monospace font and the frontend displays names in one.
contract PaytagRegistry {
    uint256 public constant MIN_LENGTH = 3;
    uint256 public constant MAX_LENGTH = 20;

    mapping(bytes32 node => address owner) private _owners;

    event NameRegistered(bytes32 indexed node, string name, address indexed owner);
    event Transfer(bytes32 indexed node, address indexed from, address indexed to);

    error InvalidLength(uint256 length);
    error InvalidCharacter(uint256 index, bytes1 char);
    error NonAsciiName(uint256 index);
    error NameTaken(bytes32 node);
    error NotOwner(bytes32 node, address caller);
    error ZeroAddress();

    /// @notice Registers `name` to the caller.
    /// @return node The node the normalized name hashes to.
    function register(string calldata name) external returns (bytes32 node) {
        bytes memory normalized = bytes(name); // calldata -> fresh memory copy
        _normalizeInPlace(normalized);
        node = keccak256(normalized);
        if (_owners[node] != address(0)) revert NameTaken(node);

        _owners[node] = msg.sender;
        emit NameRegistered(node, string(normalized), msg.sender);
        emit Transfer(node, address(0), msg.sender);
    }

    /// @notice Transfers ownership of `node` to `to`. Records on the resolver are left in place;
    ///         the new owner can overwrite them.
    function transfer(bytes32 node, address to) external {
        address current = _owners[node];
        // `current == address(0)` covers unregistered nodes even if msg.sender were zero.
        if (current == address(0) || current != msg.sender) revert NotOwner(node, msg.sender);
        if (to == address(0)) revert ZeroAddress();

        _owners[node] = to;
        emit Transfer(node, current, to);
    }

    /// @notice Owner of `node`, or `address(0)` if unregistered.
    function owner(bytes32 node) external view returns (address) {
        return _owners[node];
    }

    /// @notice Node for `name` after normalization. Reverts on invalid names.
    function nodeOf(string calldata name) external pure returns (bytes32) {
        bytes memory b = bytes(name);
        _normalizeInPlace(b);
        return keccak256(b);
    }

    /// @notice Validates `name` and lowercases ASCII A-Z. Reverts on anything else outside
    ///         `[a-z0-9_]` or outside the length bounds. Idempotent.
    function normalize(string calldata name) external pure returns (string memory) {
        bytes memory b = bytes(name);
        _normalizeInPlace(b);
        return string(b);
    }

    /// @dev Mutates `b`. Only ever called on a fresh copy of calldata. The unsigned-wraparound
    ///      range checks (`c - 0x61 < 26`) test `a <= c <= z` with one comparison.
    function _normalizeInPlace(bytes memory b) private pure {
        uint256 len = b.length;
        if (len < MIN_LENGTH || len > MAX_LENGTH) revert InvalidLength(len);

        unchecked {
            for (uint256 i; i < len; ++i) {
                uint8 c = uint8(b[i]);
                if (c >= 0x80) revert NonAsciiName(i);

                if (uint8(c - 0x41) < 26) {
                    b[i] = bytes1(c + 32); // A-Z -> a-z
                } else if (!(uint8(c - 0x61) < 26 || uint8(c - 0x30) < 10 || c == 0x5f)) {
                    revert InvalidCharacter(i, bytes1(c));
                }
            }
        }
    }
}

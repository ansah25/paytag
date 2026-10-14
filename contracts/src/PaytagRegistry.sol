// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title PaytagRegistry
/// @notice Canonical ownership registry for Paytag names. One flat namespace (`@derrick`, not
///         `derrick.paytag`), so a node is simply `keccak256(normalize(name))`.
/// @dev Immutable and admin-free: no owner, no pause, no upgrade path. Registration is
///      first-come, free and permanent. Front-running and squatting are accepted trade-offs for
///      this deployment and are documented in the README.
///
///      Name policy (same character set, length bounds and reserved list as the off-chain API,
///      so a name valid on one layer is valid on the other; the API additionally trims
///      surrounding whitespace, which the contract rejects):
///        - 3 to 20 bytes after normalization
///        - allowed characters: a-z, 0-9, underscore
///        - not on the reserved list (`isReserved`): route names and project/staff names that
///          nobody, including the deployer, can ever own. The list is fixed at deploy time
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
    error ReservedName(bytes32 node);
    error NotOwner(bytes32 node, address caller);
    error ZeroAddress();

    /// @notice Registers `name` to the caller.
    /// @return node The node the normalized name hashes to.
    function register(string calldata name) external returns (bytes32 node) {
        bytes memory normalized = bytes(name); // calldata -> fresh memory copy
        _normalizeInPlace(normalized);
        node = keccak256(normalized);
        if (isReserved(node)) revert ReservedName(node);
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

    /// @notice Whether `node` is permanently unregistrable. Hashes of the API's reserved
    ///         usernames (`RESERVED_USERNAMES` in `src/services/userService.ts`); a backend test
    ///         fails if the two lists drift apart.
    function isReserved(bytes32 node) public pure returns (bool) {
        return (
            node == 0x9d3a8228e39c6c01df81a4ecac2e66f8fdfde403ad613d0e0a0065dad64af93d // about
                || node == 0xf23ec0bb4210edd5cba85afd05127efcd2fc6a781bfed49188da1081670b22d8 // admin
                || node == 0x495c780bd8fc34c004bd5d2a1aff5e8b935fed6a72777bebedc4a94c84a2ded4 // api
                || node == 0xd6f028ca0e8edb4a8c9757ca4fdccab25fa1e0317da1188108f7d2dee14902fb // app
                || node == 0xb9208574d39bc6b85a528191d39d983f3a0bc58ef7129343fde819f64f7268cd // auth
                || node == 0x25ab313675136c9bce6a3dfbd97460804f2a6ddf6d3f53ddda1562fabfe4b98b // available
                || node == 0xb8b758361d5e84380ef1e632f89d8e76a8677dbc3f4b93a4f9d75d2a6048f312 // claim
                || node == 0xdb843bfc3c9143a07f4c239c2a56ff616e552e0ff5a2baf75409a5415a2333c1 // dashboard
                || node == 0x6bf9054545420e9e9f4aa4f353a32c7d0d52c11dbcdda56c53be8375cafeebb1 // docs
                || node == 0x0825203969ee8c01895e26a522db220e9541acc7b27e3cb4a1a9317cb0c30bfb // help
                || node == 0x09248d9d6b6efac2143c36870f66661d2f09473b9b12ac14b4c8e16afbb32426 // home
                || node == 0xd3173e4f9de6bcc7dc5e4bfb68d4cc55019199a6350a384ad6a2e9a62c50ee26 // login
                || node == 0xab758a1ea1f320725571aea7973c5b9ba5fb1467d746de4e1513e00c1b2b624b // logout
                || node == 0xadc756803e4eb4ccfb136b73d5f72e3dc0d452d30ae1f4bc82af394c73ce7115 // pay
                || node == 0x1142ffc878f1944d1e2ac2fb95e42e4b90e6b7c912bc118000256a54f3e0ee97 // paytag
                || node == 0xbc3ae4aa92cf6c6fcb2b96d04979a3e41c27daa380f807f10cd06e610f58823e // privacy
                || node == 0x3c0c3a2537aaf75b853bbf2b595e872d3db0359b7e792ebd8907fb017c3b71a2 // public
                || node == 0xdd007bd789f73e08c2714644c55b11c7d202931d717def434e3c9caa12a9f583 // register
                || node == 0x02412dc2a4a0554946f855b8a477bb5d50aeb5d097ddd55c2f7b4dda077bf63a // resolve
                || node == 0xd6c66cad06fe14fdb6ce9297d80d32f24d7428996d0045cbf90cc345c677ba16 // root
                || node == 0xc78fb7b2e3c9c2e712beb3f0810da51cfd22c24f931002cf7b8fe9ec042de50c // send
                || node == 0x0eda6c6c60c41ce8e43cbe693c41224c11fc917f93765e8a2c43ac23874d7a19 // settings
                || node == 0xe8cbf6f5355275fa7dbbe50d82378d2e2d7e9ee4516f2c21db71ab75cea02dd8 // signin
                || node == 0xcb489c5d75748aae0d3aab3622fa460f1072fe17bff252f4190272345704e8fa // signup
                || node == 0x05ed8e412f03a3e829aaa34f3b5d303588af0b61c223dec800945749682d4f73 // support
                || node == 0x9ff867f6592aa9d6d039e7aad6bd71f1659720cbc4dd9eae1554f6eab490098b // terms
                || node == 0x7300b177d466ae31945c6eada9bcd83418289e1689b052653264eb55a1da568a // welcome
                || node == 0x3177317affd6342ed2401ccea23053d41b86d0914b5b1bee0faa1efcb7221a61 // www
        );
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

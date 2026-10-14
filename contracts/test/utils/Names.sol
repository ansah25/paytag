// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Test-side helpers for name generation and an independent reference model of the
///         registry's normalization rules, written without sharing code with the contract.
library Names {
    bytes internal constant ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789_";

    /// @notice Reference model: is `raw` accepted by `normalize`?
    function isValid(bytes memory raw) internal pure returns (bool) {
        if (raw.length < 3 || raw.length > 20) return false;
        for (uint256 i; i < raw.length; ++i) {
            uint8 c = uint8(raw[i]);
            bool isLower = c >= 0x61 && c <= 0x7a;
            bool isUpper = c >= 0x41 && c <= 0x5a;
            bool digit = c >= 0x30 && c <= 0x39;
            if (!(isLower || isUpper || digit || c == 0x5f)) return false;
        }
        return true;
    }

    /// @notice Reference model: ASCII lowercase of `raw`. Only meaningful when `isValid(raw)`.
    function lower(bytes memory raw) internal pure returns (bytes memory out) {
        out = new bytes(raw.length);
        for (uint256 i; i < raw.length; ++i) {
            uint8 c = uint8(raw[i]);
            out[i] = (c >= 0x41 && c <= 0x5a) ? bytes1(c + 32) : raw[i];
        }
    }

    /// @notice Deterministic valid lowercase name of length 3..20 derived from `seed`.
    function fromSeed(uint256 seed) internal pure returns (string memory) {
        uint256 len = 3 + (seed % 18);
        bytes memory out = new bytes(len);
        for (uint256 i; i < len; ++i) {
            seed = uint256(keccak256(abi.encode(seed, i)));
            out[i] = ALPHABET[seed % ALPHABET.length];
        }
        return string(out);
    }

    /// @notice Name from a tiny alphabet ("a", "b", "_") at length 3, so repeats and case
    ///         variants show up constantly. `seed` bits also flip letters to uppercase.
    function crowded(uint256 seed) internal pure returns (string memory) {
        bytes memory chars = "ab_";
        bytes memory out = new bytes(3);
        for (uint256 i; i < 3; ++i) {
            bytes1 c = chars[(seed >> (i * 2)) % 3];
            if (c != "_" && (seed >> (8 + i)) & 1 == 1) c = bytes1(uint8(c) - 32);
            out[i] = c;
        }
        return string(out);
    }

    /// @notice Uppercases every ASCII letter in `name`.
    function upper(string memory name) internal pure returns (string memory) {
        bytes memory b = bytes(name);
        bytes memory out = new bytes(b.length);
        for (uint256 i; i < b.length; ++i) {
            uint8 c = uint8(b[i]);
            out[i] = (c >= 0x61 && c <= 0x7a) ? bytes1(c - 32) : b[i];
        }
        return string(out);
    }
}

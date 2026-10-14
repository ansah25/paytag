// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PaytagRegistry} from "../../src/PaytagRegistry.sol";

/// @notice Test-side helpers for name generation and an independent reference model of the
///         registry's rules, written without sharing logic with the contract (only its error
///         selectors are imported).
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

    /// @notice Reference model: the revert data `normalize` must produce for an invalid `raw`
    ///         (length first, then the first offending byte). Empty when `raw` is valid.
    function expectedError(bytes memory raw) internal pure returns (bytes memory) {
        if (raw.length < 3 || raw.length > 20) {
            return abi.encodeWithSelector(PaytagRegistry.InvalidLength.selector, raw.length);
        }
        for (uint256 i; i < raw.length; ++i) {
            uint8 c = uint8(raw[i]);
            if (c >= 0x80) return abi.encodeWithSelector(PaytagRegistry.NonAsciiName.selector, i);
            bool ok = (c >= 0x61 && c <= 0x7a) || (c >= 0x41 && c <= 0x5a)
                || (c >= 0x30 && c <= 0x39) || c == 0x5f;
            if (!ok) {
                return abi.encodeWithSelector(PaytagRegistry.InvalidCharacter.selector, i, raw[i]);
            }
        }
        return "";
    }

    /// @notice The API's reserved usernames, written out independently of the contract's hash
    ///         list (`RESERVED_USERNAMES` in `src/services/userService.ts`).
    function reserved() internal pure returns (string[] memory r) {
        r = new string[](28);
        r[0] = "about";
        r[1] = "admin";
        r[2] = "api";
        r[3] = "app";
        r[4] = "auth";
        r[5] = "available";
        r[6] = "claim";
        r[7] = "dashboard";
        r[8] = "docs";
        r[9] = "help";
        r[10] = "home";
        r[11] = "login";
        r[12] = "logout";
        r[13] = "pay";
        r[14] = "paytag";
        r[15] = "privacy";
        r[16] = "public";
        r[17] = "register";
        r[18] = "resolve";
        r[19] = "root";
        r[20] = "send";
        r[21] = "settings";
        r[22] = "signin";
        r[23] = "signup";
        r[24] = "support";
        r[25] = "terms";
        r[26] = "welcome";
        r[27] = "www";
    }

    /// @notice Whether the already-lowercased `name` is reserved.
    function isReserved(bytes memory name) internal pure returns (bool) {
        string[] memory r = reserved();
        bytes32 h = keccak256(name);
        for (uint256 i; i < r.length; ++i) {
            if (keccak256(bytes(r[i])) == h) return true;
        }
        return false;
    }

    /// @notice Reference model: ASCII lowercase of `raw`. Only meaningful when `isValid(raw)`.
    function lower(bytes memory raw) internal pure returns (bytes memory out) {
        out = new bytes(raw.length);
        for (uint256 i; i < raw.length; ++i) {
            uint8 c = uint8(raw[i]);
            out[i] = (c >= 0x41 && c <= 0x5a) ? bytes1(c + 32) : raw[i];
        }
    }

    /// @notice Deterministic valid, registrable lowercase name of length 3..20 derived from
    ///         `seed`. A reserved result gets its last byte replaced with "_" (no reserved name
    ///         contains one), so callers never trip `ReservedName` by accident.
    function fromSeed(uint256 seed) internal pure returns (string memory) {
        uint256 len = 3 + (seed % 18);
        bytes memory out = new bytes(len);
        for (uint256 i; i < len; ++i) {
            seed = uint256(keccak256(abi.encode(seed, i)));
            out[i] = ALPHABET[seed % ALPHABET.length];
        }
        if (isReserved(out)) out[len - 1] = "_";
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

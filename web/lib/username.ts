// Off-chain username rules, matching the API (src/services/userService.ts) and the on-chain
// registry's character set. Only ASCII is transformed: String#trim strips Unicode whitespace and
// String#toLowerCase folds some non-ASCII characters into ASCII (the Kelvin sign U+212A becomes
// "k"), so either would let input through that the API and the registry reject.

export const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;

/** Trim ASCII whitespace, drop one leading "@", lowercase ASCII A–Z. Anything else is left for the pattern to reject. */
export const normalizeUsername = (value: string): string =>
  value
    .replace(/^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$/g, '')
    .replace(/^@/, '')
    .replace(/[A-Z]/g, (c) => c.toLowerCase());

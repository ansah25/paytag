// Off-chain username rules, matching the API (src/services/userService.ts) and the on-chain
// registry's character set. Only ASCII is transformed: String#trim strips Unicode whitespace and
// String#toLowerCase folds some non-ASCII characters into ASCII (the Kelvin sign U+212A becomes
// "k"), so either would let input through that the API and the registry reject.

export const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;

const lowerAscii = (value: string) => value.replace(/[A-Z]/g, (c) => c.toLowerCase());

/**
 * Trim ASCII whitespace, drop one leading "@", lowercase ASCII A–Z. Anything else is left for the
 * pattern to reject. (The API itself doesn't strip "@"; clients do before calling it.)
 */
export const normalizeUsername = (value: string): string =>
  lowerAscii(value.replace(/^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$/g, '').replace(/^@/, ''));

/**
 * What a name input keeps as the user types or pastes: ASCII whitespace removed anywhere, one
 * leading "@" dropped, ASCII A–Z lowercased. Non-ASCII stays visible, so the field shows exactly
 * what will be rejected instead of silently folding it into a different name.
 */
export const sanitizeNameInput = (value: string): string =>
  lowerAscii(value.replace(/^@/, '').replace(/[ \t\n\r\f\v]/g, ''));

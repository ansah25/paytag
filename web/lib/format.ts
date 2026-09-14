/** `0x9a1b3c…4e2f` — for chips and inline mentions. */
export const shortAddress = (address: string, head = 6, tail = 4): string =>
  address.length <= head + tail + 1 ? address : `${address.slice(0, head)}…${address.slice(-tail)}`;

/** "$184.00", "$1,234", "<$0.01". */
export const formatUsd = (value: number): string => {
  if (value > 0 && value < 0.01) return '<$0.01';
  if (value >= 1000) return `$${Math.round(value).toLocaleString('en-US')}`;
  return `$${value.toFixed(2)}`;
};

/** Small token amounts without exponent notation: 0.000412 → "0.00041". */
export const formatTokenAmount = (value: number, significantDigits = 2): string =>
  value.toLocaleString('en-US', { maximumSignificantDigits: significantDigits, useGrouping: false });

/**
 * Split an address for head/tail emphasis: the first `head` and last `tail`
 * characters are what people actually compare when checking an address.
 */
export const splitAddress = (
  address: string,
  head = 6,
  tail = 4,
): { head: string; mid: string; tail: string } =>
  address.length <= head + tail
    ? { head: address, mid: '', tail: '' }
    : { head: address.slice(0, head), mid: address.slice(head, -tail), tail: address.slice(-tail) };

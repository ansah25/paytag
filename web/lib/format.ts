/** `0x9a1b3c…4e2f` — for chips and inline mentions. */
export const shortAddress = (address: string, head = 6, tail = 4): string =>
  address.length <= head + tail + 1 ? address : `${address.slice(0, head)}…${address.slice(-tail)}`;

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

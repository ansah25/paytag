import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ONCHAIN_API, OnchainReadError, POINTING_LIMIT, noteWrite, onchainReads, resetWrites, visiblePointing } from './reads';

const ME = '0x6aD631F215393f9635231de985081B1ccDDC7C11';
const DEPLOYER = '0x3dbc9c0bef8b7bfbcf0a7cc4041b3962b126f865';
const node = (b: string) => `0x${b.repeat(32)}`;

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

describe('onchainReads', () => {
  beforeEach(() => resetWrites());
  afterEach(() => vi.unstubAllGlobals());

  it('reads the API’s /onchain endpoints', async () => {
    const fetchMock = vi.fn(() => json({ account: ME, names: [{ name: 'derrick', node: node('a'), owner: DEPLOYER }] }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(onchainReads.pointingAt(ME)).resolves.toEqual([{ name: 'derrick', node: node('a'), owner: DEPLOYER }]);
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe(`${ONCHAIN_API}/pointing?account=${ME}`);
  });

  it('after a write, asks for at least that block', async () => {
    const fetchMock = vi.fn(() => json({ owner: ME, names: [] }));
    vi.stubGlobal('fetch', fetchMock);
    noteWrite(100n);
    noteWrite(90n); // an older receipt never lowers it
    await onchainReads.names(ME);
    await onchainReads.reverse(ME);
    const urls = fetchMock.mock.calls.map((c) => String((c as unknown[])[0]));
    expect(urls).toEqual([`${ONCHAIN_API}/names?owner=${ME}&minBlock=100`, `${ONCHAIN_API}/reverse/${ME}?minBlock=100`]);
  });

  it('turns an error response into an OnchainReadError with the API’s code', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json({ error: 'behind', code: 'ONCHAIN_BEHIND' }, 503)));
    const err = await onchainReads.reverse(ME).catch((e) => e);
    expect(err).toBeInstanceOf(OnchainReadError);
    expect(err).toMatchObject({ code: 'ONCHAIN_BEHIND', status: 503 });
  });
});

describe('visiblePointing', () => {
  const many = Array.from({ length: POINTING_LIMIT + 5 }, (_, i) => ({
    name: `n${String(i).padStart(3, '0')}`,
    node: node((i % 9).toString() + 'a') as `0x${string}`,
    owner: DEPLOYER,
  }));

  it('caps the list', () => {
    expect(visiblePointing(many, null)).toHaveLength(POINTING_LIMIT);
  });

  it('always keeps the current primary name, first, even past the cap', () => {
    const last = many[many.length - 1].name;
    const shown = visiblePointing(many, last);
    expect(shown).toHaveLength(POINTING_LIMIT);
    expect(shown[0].name).toBe(last);
  });
});

describe('aborts', () => {
  afterEach(() => vi.unstubAllGlobals());

  // The body read rejects after the caller aborted (e.g. the wallet switched accounts mid-read).
  const abortedBody = (controller: AbortController) =>
    vi.fn().mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: () => {
        controller.abort();
        return Promise.reject(new DOMException('The operation was aborted.', 'AbortError'));
      },
    }));

  it('surfaces an abort mid-body as AbortError, not a read error', async () => {
    const c1 = new AbortController();
    vi.stubGlobal('fetch', abortedBody(c1));
    await expect(onchainReads.pointingAt(ME, c1.signal)).rejects.toMatchObject({ name: 'AbortError' });
    const c2 = new AbortController();
    vi.stubGlobal('fetch', abortedBody(c2));
    await expect(onchainReads.reverse(ME, c2.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});

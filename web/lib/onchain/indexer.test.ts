import { afterEach, describe, expect, it, vi } from 'vitest';
import { IndexerError, namesPointingAt, pointingNames } from './indexer';

const ME = '0x6aD631F215393f9635231de985081B1ccDDC7C11';
const DEPLOYER = '0x3dbc9c0bef8b7bfbcf0a7cc4041b3962b126f865';
const node = (b: string) => `0x${b.repeat(32)}`;

const name = (n: string, b: string, owner: string, lastTransferOrdinal = '100') => ({
  node: node(b),
  name: n,
  owner,
  lastTransferOrdinal,
});

describe('pointingNames', () => {
  it('lists names owned by others whose record is current, sorted by name', () => {
    const records = [
      { node: node('22'), updatedOrdinal: '200' },
      { node: node('11'), updatedOrdinal: '100' }, // same ordinal as the transfer: still current
    ];
    const names = [name('zed', '22', DEPLOYER), name('derrick', '11', DEPLOYER)];
    expect(pointingNames(records, names, ME)).toEqual([
      { name: 'derrick', node: node('11'), owner: DEPLOYER },
      { name: 'zed', node: node('22'), owner: DEPLOYER },
    ]);
  });

  it('leaves out names the account owns (they have their own card), any case', () => {
    const records = [{ node: node('11'), updatedOrdinal: '200' }];
    expect(pointingNames(records, [name('mine', '11', ME.toLowerCase())], ME)).toEqual([]);
  });

  it('leaves out records set by a previous owner, which /reverse ignores', () => {
    const records = [{ node: node('11'), updatedOrdinal: '99' }];
    expect(pointingNames(records, [name('old', '11', DEPLOYER, '100')], ME)).toEqual([]);
  });

  it('skips records with no matching name or malformed ordinals', () => {
    const records = [
      { node: node('33'), updatedOrdinal: '200' },
      { node: node('11'), updatedOrdinal: 'oops' },
    ];
    expect(pointingNames(records, [name('bad', '11', DEPLOYER)], ME)).toEqual([]);
  });
});

describe('namesPointingAt', () => {
  afterEach(() => vi.unstubAllGlobals());

  const respond = (body: unknown, status = 200) =>
    Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

  it('queries records by the lowercased address, then names by node', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => respond({ data: { recordss: { items: [{ node: node('11'), updatedOrdinal: '200' }] } } }))
      .mockImplementationOnce(() => respond({ data: { namess: { items: [name('derrick', '11', DEPLOYER)] } } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(namesPointingAt(ME)).resolves.toEqual([{ name: 'derrick', node: node('11'), owner: DEPLOYER }]);
    const first = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(first.variables).toEqual({ value: ME.toLowerCase() });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).variables).toEqual({ nodes: [node('11')] });
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/graphql$/);
  });

  it('skips the names query when nothing points at the address', async () => {
    const fetchMock = vi.fn().mockImplementation(() => respond({ data: { recordss: { items: [] } } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(namesPointingAt(ME)).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws an IndexerError on GraphQL errors or a malformed body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => respond({ errors: [{ message: 'bad field' }] })));
    await expect(namesPointingAt(ME)).rejects.toBeInstanceOf(IndexerError);
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => respond('not json', 503)));
    await expect(namesPointingAt(ME)).rejects.toBeInstanceOf(IndexerError);
  });
});

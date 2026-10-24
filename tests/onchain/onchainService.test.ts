import '../setup';
import request from 'supertest';
import { type Hex, getAddress } from 'viem';
import type { FakeDb } from '../helpers/onchainFakes';

jest.mock('../../src/config/supabase', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { FakeDb: Db } = jest.requireActual('../helpers/onchainFakes');
  const fakeDb = new Db();
  return { supabase: fakeDb.client(), fakeDb };
});

import { env } from '../../src/config/env';
import { createApp } from '../../src/app';
import { setChainClientForTests } from '../../src/onchain/client';
import { normalizeName } from '../../src/onchain/names';
import { BASE_COIN_TYPE } from '../../src/onchain/state';
import * as svc from '../../src/services/onchainService';
import { catchUp, forgetRegistrations } from '../../src/services/onchainEventsService';
import { FakeChain, timestampOf } from '../helpers/onchainFakes';

const db: FakeDb = jest.requireMock('../../src/config/supabase').fakeDb;
const chain = new FakeChain();

const ALICE = '0x3dbc9c0bef8b7bfbcf0a7cc4041b3962b126f865' as Hex;
const BOB = '0x00000000000000000000000000000000000000b0' as Hex;
const SOL_KEY = '0x321cfa5add185e8893a5fd88013ec4d7e122ded46354cadff50d956395e75b60' as Hex;
const SOL = '4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T';
const SEED = 48_167_394;
const nodeOf = (name: string) => (normalizeName(name) as { node: Hex }).node;
const DERRICK = nodeOf('derrick');

beforeAll(async () => {
  const url = await chain.start();
  setChainClientForTests([url]);
  env.BLOCKSCOUT_API_URL = url;
});
afterAll(async () => {
  setChainClientForTests(null);
  await chain.stop();
});
beforeEach(() => {
  chain.reset();
  db.reset();
  svc.clearOnchainCaches();
  forgetRegistrations();
  env.ONCHAIN_MAX_CHUNKS_PER_REQUEST = 10;
  env.ONCHAIN_LOG_CHUNK_BLOCKS = 200;
  env.ONCHAIN_CONFIRMATIONS = 10;
});

const derrickWithRecords = () => {
  chain.register(DERRICK, 'derrick', ALICE, 48_200_000n);
  chain.setRecord(DERRICK, 60n, ALICE, 48_200_001n);
  chain.setRecord(DERRICK, 501n, SOL_KEY, 48_200_002n);
};

describe('resolveOnchain', () => {
  it('reads state directly in one multicall and answers in the indexer shape', async () => {
    derrickWithRecords();
    const body = await svc.resolveOnchain('@Derrick');
    expect(body).toEqual({
      username: 'derrick',
      node: DERRICK,
      owner: getAddress(ALICE),
      registeredAt: timestampOf(48_200_000n),
      epoch: 0,
      recordsReset: false,
      addresses: { ethereum: getAddress(ALICE), solana: SOL },
      records: [
        { coinType: '60', value: ALICE, address: getAddress(ALICE) },
        { coinType: '501', value: SOL_KEY, address: SOL },
      ],
      source: 'onchain',
    });
    expect(chain.count('eth_call')).toBe(1); // owner, epoch, 4 records and the block: one round trip
  });

  it('reads the Base record too', async () => {
    derrickWithRecords();
    chain.setRecord(DERRICK, BASE_COIN_TYPE, BOB, 48_200_003n);
    const body = await svc.resolveOnchain('derrick');
    expect(body.records.map((r) => r.coinType)).toEqual(['60', '501', BASE_COIN_TYPE.toString()]);
  });

  it('serves repeats from the 30s cache, and minBlock past the cached read re-reads', async () => {
    derrickWithRecords();
    await svc.resolveOnchain('derrick');
    await svc.resolveOnchain('derrick');
    expect(chain.count('eth_call')).toBe(1);

    chain.setRecord(DERRICK, 501n, '0x', chain.head + 1n);
    chain.head += 1n;
    const fresh = await svc.resolveOnchain('derrick', { minBlock: chain.head });
    expect(fresh.addresses.solana).toBeUndefined();
    expect(chain.count('eth_call')).toBe(2);
  });

  it('refuses with ONCHAIN_BEHIND when the RPC stays behind minBlock', async () => {
    derrickWithRecords();
    chain.multicallBlock = chain.head - 5n;
    await expect(svc.resolveOnchain('derrick', { minBlock: chain.head })).rejects.toMatchObject({
      status: 503,
      errorCode: 'ONCHAIN_BEHIND',
    });
    expect(chain.count('eth_call')).toBe(2); // one retry
  });

  it('404s an unregistered name, and caches that too', async () => {
    await expect(svc.resolveOnchain('nobody')).rejects.toMatchObject({ status: 404, errorCode: 'USER_NOT_FOUND' });
    await expect(svc.resolveOnchain('nobody')).rejects.toMatchObject({ errorCode: 'USER_NOT_FOUND' });
    expect(chain.count('eth_call')).toBe(1);
    expect(chain.blockscoutCalls).toBe(0); // a made-up name never triggers a sync
  });

  it('rejects an invalid name without a request', async () => {
    await expect(svc.resolveOnchain('a!')).rejects.toMatchObject({ status: 400, errorCode: 'INVALID_USERNAME' });
    expect(chain.count('http')).toBe(0);
  });

  it('a transfer starts a new epoch with no records', async () => {
    derrickWithRecords();
    chain.transfer(DERRICK, BOB, 48_300_000n);
    const body = await svc.resolveOnchain('derrick');
    expect(body).toMatchObject({ owner: getAddress(BOB), epoch: 1, recordsReset: true, records: [], addresses: {} });
  });

  it('an RPC failure is a 503 ONCHAIN_UNAVAILABLE', async () => {
    chain.rpcDown = true;
    await expect(svc.resolveOnchain('derrick')).rejects.toMatchObject({ status: 503, errorCode: 'ONCHAIN_UNAVAILABLE' });
  });

  it('finds a registration newer than the table in the fresh tail (inside the reorg margin)', async () => {
    chain.register(DERRICK, 'derrick', ALICE, chain.head - 2n);
    chain.blockscoutDown = true;
    db.state.last_synced_block = Number(chain.head) - 10; // already current
    const body = await svc.resolveOnchain('derrick');
    expect(body.registeredAt).toBe(timestampOf(chain.head - 2n));
  });
});

describe('availableOnchain', () => {
  it('answers free, taken (with free suggestions), reserved and invalid in one read', async () => {
    chain.register(DERRICK, 'derrick', ALICE, 48_200_000n);
    chain.register(nodeOf('derrick_'), 'derrick_', BOB, 48_200_001n);
    await expect(svc.availableOnchain('newname')).resolves.toEqual({ available: true, suggestions: [] });
    await expect(svc.availableOnchain('Derrick')).resolves.toEqual({
      available: false,
      reason: 'TAKEN',
      suggestions: ['derrick1', 'derrick_pay', 'derrick2'],
    });
    await expect(svc.availableOnchain('admin')).resolves.toMatchObject({ available: false, reason: 'RESERVED' });
    await expect(svc.availableOnchain('ab')).resolves.toEqual({ available: false, reason: 'INVALID_FORMAT', suggestions: [] });
    expect(chain.count('eth_call')).toBe(3); // invalid needs none
  });
});

describe('reverseOnchain', () => {
  it('returns the claimed name while the claim is live, else null', async () => {
    derrickWithRecords();
    chain.reverse.set(ALICE, DERRICK);
    await expect(svc.reverseOnchain(getAddress(ALICE))).resolves.toEqual({ address: getAddress(ALICE), username: 'derrick' });

    chain.setRecord(DERRICK, 60n, BOB, chain.head + 1n);
    chain.head += 1n;
    await expect(svc.reverseOnchain(ALICE, { minBlock: chain.head })).resolves.toEqual({ address: getAddress(ALICE), username: null });
  });
});

describe('namesByOwner', () => {
  it('lists names held now, re-checked against live state, in the indexer shape', async () => {
    derrickWithRecords();
    chain.register(nodeOf('alpha'), 'alpha', ALICE, 48_200_010n);
    chain.register(nodeOf('gone'), 'gone', ALICE, 48_200_020n);
    chain.transfer(nodeOf('gone'), BOB, 48_200_030n);
    // Registered just now: only in the fresh tail, not the table.
    chain.register(nodeOf('fresh'), 'fresh', ALICE, chain.head - 1n);

    await expect(svc.namesByOwner(getAddress(ALICE))).resolves.toEqual({
      owner: getAddress(ALICE),
      names: [
        { name: 'alpha', node: nodeOf('alpha'), registeredAt: timestampOf(48_200_010n) },
        { name: 'derrick', node: DERRICK, registeredAt: timestampOf(48_200_000n) },
        { name: 'fresh', node: nodeOf('fresh'), registeredAt: timestampOf(chain.head - 1n) },
      ],
    });
    await expect(svc.namesByOwner(BOB)).resolves.toMatchObject({ names: [{ name: 'gone' }] });
  });

  it('a busy lease skips the sync and still serves what is stored', async () => {
    derrickWithRecords();
    await catchUp();
    db.state.lease_token = 'someone-else';
    db.state.lease_until = Date.now() + 60_000;
    // Past the cursor: not stored, but the fresh tail still finds it.
    chain.register(nodeOf('later'), 'later', ALICE, chain.head - 5n);
    const blockscoutBefore = chain.blockscoutCalls;
    const res = await svc.namesByOwner(ALICE);
    expect(chain.blockscoutCalls).toBe(blockscoutBefore); // didn't sync
    expect(res.names.map((n) => n.name)).toEqual(['derrick', 'later']);
  });
});

describe('namesPointingAt', () => {
  it('names whose live ETH record is the account, excluding ones it owns', async () => {
    chain.register(DERRICK, 'derrick', ALICE, 48_200_000n);
    chain.setRecord(DERRICK, 60n, BOB, 48_200_001n);
    chain.register(nodeOf('mine'), 'mine', BOB, 48_200_002n);
    chain.setRecord(nodeOf('mine'), 60n, BOB, 48_200_003n);
    chain.register(nodeOf('moved'), 'moved', ALICE, 48_200_004n);
    chain.setRecord(nodeOf('moved'), 60n, BOB, 48_200_005n);
    chain.setRecord(nodeOf('moved'), 60n, ALICE, 48_200_006n); // no longer points at BOB

    await expect(svc.namesPointingAt(BOB)).resolves.toEqual({
      account: getAddress(BOB),
      names: [{ name: 'derrick', node: DERRICK, owner: getAddress(ALICE) }],
    });
  });
});

describe('the lazy sync', () => {
  it('starts from the seeded deploy block, never genesis', async () => {
    chain.blockscoutDown = true;
    chain.head = BigInt(SEED) + 1_000n;
    await catchUp();
    expect(chain.getLogsRanges[0]![0]).toBe(BigInt(SEED) + 1n);
  });

  it('stops ONCHAIN_CONFIRMATIONS short of the head', async () => {
    derrickWithRecords();
    await expect(catchUp()).resolves.toMatchObject({ status: 'advanced', via: 'blockscout' });
    expect(db.state.last_synced_block).toBe(Number(chain.head) - 10);
    expect(db.events.size).toBe(4);
  });

  it('never passes what Blockscout has indexed', async () => {
    chain.blockscoutHead = 48_500_000n;
    chain.blockscoutDown = false;
    env.ONCHAIN_MAX_CHUNKS_PER_REQUEST = 1;
    await catchUp();
    // Blockscout covered up to its head, then the RPC path one chunk further.
    expect(db.state.last_synced_block).toBe(48_500_000 + 200);
  });

  it('falls back to 200-block RPC chunks, capped per request, persisting progress', async () => {
    chain.blockscoutDown = true;
    chain.head = BigInt(SEED) + 5_000n;
    await catchUp();
    expect(db.state.last_synced_block).toBe(SEED + 2_000); // 10 chunks
    expect(chain.getLogsRanges.every(([a, b]) => b - a + 1n <= 200n)).toBe(true);
    await catchUp();
    expect(db.state.last_synced_block).toBe(SEED + 4_000); // the next request continues
  });

  it('re-syncing a range inserts nothing twice', async () => {
    derrickWithRecords();
    await catchUp();
    db.state.last_synced_block = SEED; // as if the cursor hadn't moved
    await catchUp();
    expect(db.events.size).toBe(4);
  });

  it('a second concurrent sync skips instead of duplicating work', async () => {
    derrickWithRecords();
    const [a, b] = await Promise.all([catchUp(), catchUp()]);
    expect([a.status, b.status].sort()).toEqual(['advanced', 'busy']);
    expect(db.state.lease_token).toBeNull(); // released
  });

  it('a failed sync still serves the list from the table and the tail', async () => {
    derrickWithRecords();
    await catchUp();
    chain.blockscoutDown = true;
    chain.getLogsLimit = 0n; // every eth_getLogs fails: no sync, no tail
    await expect(svc.namesByOwner(ALICE)).resolves.toMatchObject({ names: [{ name: 'derrick' }] });
    chain.getLogsLimit = 200n;
  });
});

describe('getOnchainOwner (account linking)', () => {
  it('owner, none, and unavailable on failure or past the budget', async () => {
    chain.register(DERRICK, 'derrick', ALICE, 48_200_000n);
    await expect(svc.getOnchainOwner('derrick', { timeoutMs: 1_000 })).resolves.toEqual({ kind: 'owner', owner: ALICE });
    await expect(svc.getOnchainOwner('nobody', { timeoutMs: 1_000 })).resolves.toEqual({ kind: 'none' });
    chain.delayMs = 300;
    await expect(svc.getOnchainOwner('derrick', { timeoutMs: 50 })).resolves.toEqual({ kind: 'unavailable' });
    chain.delayMs = 0;
    chain.rpcDown = true;
    await expect(svc.getOnchainOwner('derrick', { timeoutMs: 1_000 })).resolves.toEqual({ kind: 'unavailable' });
  });
});

describe('routes', () => {
  const app = createApp();

  it('serve the indexer paths under /onchain with the same shapes', async () => {
    derrickWithRecords();
    const res = await request(app).get('/onchain/resolve/derrick');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ username: 'derrick', source: 'onchain', registeredAt: timestampOf(48_200_000n) });
    expect(res.headers['access-control-allow-origin']).toBe('*');

    expect((await request(app).get('/onchain/available/ab')).body).toEqual({ available: false, reason: 'INVALID_FORMAT', suggestions: [] });
    expect((await request(app).get(`/onchain/names?owner=${ALICE}`)).body.names).toHaveLength(1);
    expect((await request(app).get(`/onchain/pointing?account=${ALICE}`)).body).toEqual({ account: getAddress(ALICE), names: [] });
    expect((await request(app).get(`/onchain/reverse/${ALICE}`)).body).toEqual({ address: getAddress(ALICE), username: null });
  });

  it('validate input at the boundary', async () => {
    expect((await request(app).get('/onchain/names?owner=0x123')).status).toBe(400);
    expect((await request(app).get(`/onchain/resolve/derrick?minBlock=-1`)).status).toBe(400);
    expect((await request(app).get('/onchain/reverse/nope')).status).toBe(400);
  });

  it('report an RPC outage as 503 in the error shape', async () => {
    chain.rpcDown = true;
    const res = await request(app).get('/onchain/resolve/derrick');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ code: 'ONCHAIN_UNAVAILABLE' });
  });
});

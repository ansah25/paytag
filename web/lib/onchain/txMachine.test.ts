import { describe, expect, it } from 'vitest';
import type { Hash } from 'viem';
import { IDLE, isBusy, txReducer, type TxAction, type TxState } from './txMachine';

const HASH = '0xabc' as Hash;
const err = { kind: 'revert' as const, message: 'nope' };
const run = (actions: TxAction[], from: TxState = IDLE) => actions.reduce(txReducer, from);

const toPending: TxAction[] = [{ type: 'start' }, { type: 'simulated' }, { type: 'submitted', hash: HASH }];

describe('txReducer', () => {
  it('walks the happy path to indexed', () => {
    const s = run([...toPending, { type: 'mined', blockNumber: 7n }, { type: 'indexed' }]);
    expect(s).toEqual({ status: 'indexed', hash: HASH, blockNumber: 7n });
  });

  it('fails from simulating and signing without a hash', () => {
    expect(run([{ type: 'start' }, { type: 'fail', error: err }])).toEqual({ status: 'failed', error: err, stage: 'simulating' });
    expect(run([{ type: 'start' }, { type: 'simulated' }, { type: 'fail', error: err }])).toEqual({
      status: 'failed',
      error: err,
      stage: 'signing',
    });
  });

  it('fails from pending and confirmed keeping the hash', () => {
    expect(run([...toPending, { type: 'fail', error: err }])).toEqual({ status: 'failed', error: err, stage: 'pending', hash: HASH });
    expect(run([...toPending, { type: 'mined', blockNumber: 1n }, { type: 'fail', error: err }])).toEqual({
      status: 'failed',
      error: err,
      stage: 'confirmed',
      hash: HASH,
    });
  });

  it('ignores out-of-order events', () => {
    expect(run([{ type: 'simulated' }])).toEqual(IDLE);
    expect(run([{ type: 'start' }, { type: 'submitted', hash: HASH }])).toEqual({ status: 'simulating' });
    expect(run([{ type: 'start' }, { type: 'mined', blockNumber: 1n }])).toEqual({ status: 'simulating' });
    expect(run([{ type: 'indexed' }])).toEqual(IDLE);
    expect(run([{ type: 'fail', error: err }])).toEqual(IDLE);
  });

  it('cannot restart while in flight, but can after failure or completion', () => {
    const pending = run(toPending);
    expect(txReducer(pending, { type: 'start' })).toBe(pending);
    expect(run([{ type: 'start' }, { type: 'fail', error: err }, { type: 'start' }])).toEqual({ status: 'simulating' });
    expect(txReducer({ status: 'indexed', hash: HASH, blockNumber: 1n }, { type: 'start' })).toEqual({ status: 'simulating' });
  });

  it('reset always returns to idle', () => {
    expect(txReducer({ status: 'pending', hash: HASH }, { type: 'reset' })).toEqual(IDLE);
  });

  it('isBusy covers exactly the in-flight states', () => {
    expect(isBusy({ status: 'simulating' })).toBe(true);
    expect(isBusy({ status: 'signing' })).toBe(true);
    expect(isBusy({ status: 'pending', hash: HASH })).toBe(true);
    expect(isBusy(IDLE)).toBe(false);
    expect(isBusy({ status: 'confirmed', hash: HASH, blockNumber: 1n })).toBe(false);
    expect(isBusy({ status: 'failed', error: err, stage: 'signing' })).toBe(false);
  });
});

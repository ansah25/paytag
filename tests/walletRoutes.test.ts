import './setup';
import request from 'supertest';

// Route-level contract: address mutations return the owner's updated
// resolution, so clients never re-read a possibly cached /resolve.
// Tokens are checked against the account's session version; this suite has no database.
jest.mock('../src/services/authService', () => {
  const actual = jest.requireActual('../src/services/authService');
  return { ...actual, getSessionVersion: jest.fn().mockResolvedValue(0) };
});
jest.mock('../src/services/walletService', () => {
  const actual = jest.requireActual('../src/services/walletService');
  return {
    ...actual,
    addAddress: jest.fn(),
    removeAddress: jest.fn(),
    resolveForWallet: jest.fn(),
  };
});
jest.mock('../src/services/verificationService', () => {
  const actual = jest.requireActual('../src/services/verificationService');
  return { ...actual, verifyAddress: jest.fn() };
});

import { createApp } from '../src/app';
import { signSessionToken } from '../src/services/authService';
import * as walletService from '../src/services/walletService';
import * as verificationService from '../src/services/verificationService';
import { NotFoundError } from '../src/utils/errors';

const WALLET = '0xabc0000000000000000000000000000000000001';
const token = signSessionToken(WALLET, 0);
const app = createApp();

const wallet = walletService as jest.Mocked<typeof walletService>;
const verification = verificationService as jest.Mocked<typeof verificationService>;

const resolution: walletService.Resolution = {
  username: 'derrick',
  addresses: { ethereum: WALLET, solana: '4Nd1mYz7K8jM2QpRzWxV3Y5tF7gH9JkLm2NoP4Qr5SsT' },
  verified: { ethereum: true },
  displayName: null,
  bio: null,
  avatarUrl: null,
  onchain: { status: 'linked' },
};

beforeEach(() => {
  jest.clearAllMocks();
  wallet.resolveForWallet.mockResolvedValue(resolution);
});

describe('address mutation responses', () => {
  it('POST /add-address returns the saved entry and the updated resolution', async () => {
    wallet.addAddress.mockResolvedValue({ chain: 'solana', address: resolution.addresses.solana! });

    const res = await request(app)
      .post('/add-address')
      .set('Authorization', `Bearer ${token}`)
      .send({ chain: 'solana', address: resolution.addresses.solana });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ chain: 'solana', address: resolution.addresses.solana, resolution });
    expect(wallet.resolveForWallet).toHaveBeenCalledWith(WALLET);
  });

  it('DELETE /address/:chain returns the updated resolution', async () => {
    wallet.removeAddress.mockResolvedValue({ chain: 'bitcoin' });

    const res = await request(app).delete('/address/bitcoin').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ chain: 'bitcoin', removed: true, resolution });
  });

  it('DELETE /address/:chain passes a not-found through without a resolution', async () => {
    wallet.removeAddress.mockRejectedValue(
      new NotFoundError('No address mapped for this chain', 'ADDRESS_NOT_FOUND'),
    );

    const res = await request(app).delete('/address/bitcoin').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body.resolution).toBeUndefined();
    expect(wallet.resolveForWallet).not.toHaveBeenCalled();
  });

  it('POST /verify-address returns the verification and the updated resolution', async () => {
    verification.verifyAddress.mockResolvedValue({
      chain: 'ethereum',
      verified: true,
      verifiedAt: '2026-09-14T00:00:00.000Z',
    });

    const res = await request(app)
      .post('/verify-address')
      .set('Authorization', `Bearer ${token}`)
      .send({ chain: 'ethereum', signature: '0xsig' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      chain: 'ethereum',
      verified: true,
      verifiedAt: '2026-09-14T00:00:00.000Z',
      resolution,
    });
  });

  it('still requires a token', async () => {
    const res = await request(app).delete('/address/bitcoin');
    expect(res.status).toBe(401);
    expect(wallet.removeAddress).not.toHaveBeenCalled();
  });
});

describe('public reads', () => {
  it('rejects a malformed wallet on /available before doing any work', async () => {
    const res = await request(app).get('/available/alice?wallet=nope');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('rate-limits /resolve and /available per client', async () => {
    const res = await request(app).get('/available/alice?wallet=nope');
    expect(res.headers['ratelimit-limit']).toBe('120');
  });
});

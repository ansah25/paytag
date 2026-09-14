import './setup';
import request from 'supertest';

// Express 4 parses query strings with qs by default; qs has open DoS
// advisories. The app switches to Node's querystring ("simple"), which never
// builds nested objects or arrays from bracket syntax.
jest.mock('../src/services/authService', () => {
  const actual = jest.requireActual('../src/services/authService');
  return { ...actual, createNonce: jest.fn() };
});

import { createApp } from '../src/app';
import * as authService from '../src/services/authService';

const auth = authService as jest.Mocked<typeof authService>;
const app = createApp();
const WALLET = '0xabc0000000000000000000000000000000000001';

beforeEach(() => {
  jest.clearAllMocks();
  auth.createNonce.mockResolvedValue('nonce-123');
});

describe('query string parsing', () => {
  it('uses the simple query parser', () => {
    expect(app.get('query parser')).toBe('simple');
  });

  it('does not build nested objects from bracket syntax', () => {
    const parse = app.get('query parser fn') as (qs: string) => Record<string, unknown>;
    expect(parse('a[b]=1&c=2')).toEqual({ 'a[b]': '1', c: '2' });
  });

  it('still reads flat params like ?wallet= on /auth/nonce', async () => {
    const res = await request(app).get(`/auth/nonce?wallet=${WALLET}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ nonce: 'nonce-123' });
    expect(auth.createNonce).toHaveBeenCalledWith(WALLET);
  });

  it('rejects bracket syntax instead of treating it as the wallet param', async () => {
    const res = await request(app).get(`/auth/nonce?wallet[x]=${WALLET}`);
    expect(res.status).toBe(400);
    expect(auth.createNonce).not.toHaveBeenCalled();
  });
});

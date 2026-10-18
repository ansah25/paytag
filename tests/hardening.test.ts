import './setup';
import request from 'supertest';
import { createApp } from '../src/app';
import { normalizeUsername } from '../src/services/userService';
import { updateProfileBodySchema } from '../src/controllers/userController';

// Input caps, the auth rate limit and body-parser errors, through the real app. None of these
// requests reach the database: they're refused by validation or the parser first.
const app = createApp();

describe('normalizeUsername', () => {
  it('trims ASCII whitespace and lowercases A-Z', () => {
    expect(normalizeUsername(' \t Derrick \n')).toBe('derrick');
    expect(normalizeUsername('   ')).toBe('');
  });

  it('runs in linear time on a long whitespace run (was quadratic: 20k spaces took ~0.7s)', () => {
    const hostile = 'a' + ' '.repeat(100_000) + 'a';
    const started = Date.now();
    normalizeUsername(hostile);
    expect(Date.now() - started).toBeLessThan(50);
  });
});

describe('input caps', () => {
  const long = 'a' + ' '.repeat(5_000) + 'a';

  it('refuses over-long usernames before doing any work', async () => {
    for (const path of [`/resolve/${encodeURIComponent(long)}`, `/available/${encodeURIComponent(long)}`]) {
      const res = await request(app).get(path);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    }
  });

  it('refuses over-long auth fields', async () => {
    expect((await request(app).get(`/auth/nonce?wallet=${'a'.repeat(101)}`)).status).toBe(400);
    const res = await request(app)
      .post('/auth/verify')
      .send({ wallet: '0x' + '1'.repeat(40), signature: '0x' + 'a'.repeat(300) });
    expect(res.status).toBe(400);
    const badNonce = await request(app)
      .post('/auth/verify')
      .send({ wallet: '0x' + '1'.repeat(40), signature: '0xab', nonce: 'not-hex' });
    expect(badNonce.status).toBe(400);
  });
});

describe('sign-in protocol', () => {
  it('tells a client that sends no nonce to reload (CLIENT_OUTDATED)', async () => {
    const res = await request(app)
      .post('/auth/verify')
      .send({ wallet: '0x6aD631F215393f9635231de985081B1ccDDC7C11', signature: '0x' + 'ab'.repeat(65) });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('CLIENT_OUTDATED');
    expect(res.body.error).toMatch(/Reload the page/);
  });

  it('rejects a nonce that is not 80 hex characters at validation', async () => {
    const res = await request(app)
      .post('/auth/verify')
      .send({ wallet: '0x6aD631F215393f9635231de985081B1ccDDC7C11', signature: '0xab', nonce: 'ab'.repeat(16) });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });
});

describe('auth rate limit', () => {
  it('puts /auth/nonce, /auth/verify and /register on the auth budget', async () => {
    for (const req of [
      request(app).get('/auth/nonce?wallet=bad'),
      request(app).post('/auth/verify').send({}),
      request(app).post('/register').send({}),
    ]) {
      const res = await req;
      expect(res.headers['ratelimit-limit']).toBe('20');
    }
  });
});

describe('body parser errors', () => {
  it('answers malformed JSON with 400 INVALID_JSON', async () => {
    const res = await request(app).post('/auth/verify').set('Content-Type', 'application/json').send('{bad');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_JSON');
  });

  it('answers other client-side body errors with their 4xx and a fixed message', async () => {
    const res = await request(app)
      .post('/auth/verify')
      .set('Content-Type', 'application/json')
      .set('Content-Encoding', 'compress')
      .send('{}');
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(res.body).toEqual({ error: 'Unsupported or malformed request body', code: 'BAD_REQUEST_BODY' });
  });

  it('answers a malformed %-escape in the URL with 400, not 500', async () => {
    const res = await request(app).get('/resolve/%E0%A4%A');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MALFORMED_URL');
  });

  it('answers an over-limit body with 413', async () => {
    const res = await request(app)
      .post('/auth/verify')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ pad: 'x'.repeat(200_000) }));
    expect(res.status).toBe(413);
    expect(res.body.code).toBe('PAYLOAD_TOO_LARGE');
  });
});

describe('profile text', () => {
  const parse = (displayName: string) => updateProfileBodySchema.safeParse({ displayName });

  it.each([
    ['RLO override', '\u202Ekcirred'],
    ['LRI isolate', 'a\u2066b'],
    ['RLM mark', 'a\u200Fb'],
    ['Arabic letter mark', 'a\u061Cb'],
    ['zero-width space', 'der\u200Brick'],
    ['word joiner', 'a\u2060b'],
    ['BOM (mid-text; trim already strips it at the ends)', 'der\uFEFFrick'],
    ['line separator', 'a\u2028b'],
    ['paragraph separator', 'a\u2029b'],
    ['soft hyphen', 'der\u00ADrick'],
    ['combining grapheme joiner', 'a\u034Fb'],
    ['Hangul filler', '\u3164derrick'],
    ['halfwidth Hangul filler', 'a\uFFA0b'],
    ['braille blank', 'a\u2800b'],
    ['Mongolian vowel separator', 'a\u180Eb'],
    ['ZWNJ', 'a\u200Cb'],
    ['invisible plus', 'a\u2064b'],
    ['tag character', 'a\u{E0041}b'],
  ])('rejects %s', (_label, value) => {
    expect(parse(value).success).toBe(false);
  });

  it('keeps emoji ZWJ sequences and ordinary Unicode', () => {
    expect(parse('Derrick 👨\u200D👩\u200D👧').success).toBe(true);
    expect(parse('Dérrick Ànsah').success).toBe(true);
    expect(parse('Love \u2764\uFE0F').success).toBe(true); // variation selector 16
  });
});

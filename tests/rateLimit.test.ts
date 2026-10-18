import './setup';
import express from 'express';
import request from 'supertest';
import { RateLimiter, clientKey, rateLimit } from '../src/middleware/rateLimit';

const clock = () => {
  let t = 0;
  return { now: () => t, advance: (ms: number) => (t += ms) };
};

describe('RateLimiter', () => {
  it('allows a burst of perMinute, then refills over time', () => {
    const c = clock();
    const limiter = new RateLimiter(2, c.now);
    expect(limiter.check('a').allowed).toBe(true);
    expect(limiter.check('a').allowed).toBe(true);
    expect(limiter.check('a')).toMatchObject({ allowed: false, remaining: 0, retryAfter: 30 });
    expect(limiter.check('b').allowed).toBe(true);
    c.advance(30_000);
    expect(limiter.check('a').allowed).toBe(true);
  });
});

describe('rateLimit middleware', () => {
  const build = () => {
    const app = express();
    app.use(rateLimit(new RateLimiter(1, clock().now)));
    app.get('*', (_req, res) => {
      res.json({ ok: true });
    });
    return app;
  };

  it("limits per Fly-Client-IP and answers 429 in the API's shape", async () => {
    const app = build();
    const first = await request(app).get('/resolve/x').set('Fly-Client-IP', '1.1.1.1');
    expect(first.status).toBe(200);
    expect(first.headers['ratelimit-limit']).toBe('1');
    const denied = await request(app).get('/resolve/x').set('Fly-Client-IP', '1.1.1.1');
    expect(denied.status).toBe(429);
    expect(denied.headers['retry-after']).toBe('60');
    expect(denied.body).toEqual({ error: expect.any(String), code: 'RATE_LIMITED' });
    expect((await request(app).get('/resolve/x').set('Fly-Client-IP', '2.2.2.2')).status).toBe(200);
  });

  it('shares one bucket across an IPv6 /64', async () => {
    const app = build();
    await request(app).get('/x').set('Fly-Client-IP', '2001:db8:1:2::a');
    expect((await request(app).get('/x').set('Fly-Client-IP', '2001:db8:1:2::b')).status).toBe(429);
  });
});

describe('clientKey', () => {
  it('keys IPv6 on the /64, so rotating within it shares one bucket', () => {
    expect(clientKey('2001:db8:1:2:aaaa::1')).toBe('2001:db8:1:2::/64');
    expect(clientKey('2001:0db8:0001:0002:ffff:ffff:ffff:ffff')).toBe('2001:db8:1:2::/64');
    expect(clientKey('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(clientKey('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
    expect(clientKey('2001:db8:1:3::1')).not.toBe(clientKey('2001:db8:1:2::1'));
  });

  it('leaves IPv4 alone and unwraps IPv4-mapped IPv6', () => {
    expect(clientKey('203.0.113.7')).toBe('203.0.113.7');
    expect(clientKey('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(clientKey('unknown')).toBe('unknown');
  });
});

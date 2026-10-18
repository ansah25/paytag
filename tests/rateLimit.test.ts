import './setup';
import express from 'express';
import request from 'supertest';
import { RateLimiter, rateLimit } from '../src/middleware/rateLimit';

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
});

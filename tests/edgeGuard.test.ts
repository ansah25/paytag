import './setup';
import express from 'express';
import request from 'supertest';
import { EDGE_HEADER, edgeGuard, hasEdgeSecret } from '../src/middleware/edgeGuard';
import { RateLimiter, rateLimit } from '../src/middleware/rateLimit';

// /ping reads the sync cursor from Postgres; no database here.
jest.mock('../src/services/onchainEventsService', () => ({
  ...jest.requireActual('../src/services/onchainEventsService'),
  syncedBlock: jest.fn(async () => 49_000_000n),
}));

const SECRET = 'edge-secret-0123456789abcdef0123456789';

const build = (secret: string | undefined) => {
  const app = express();
  app.use(edgeGuard(secret));
  app.get('*', (_req, res) => {
    res.json({ ok: true });
  });
  return app;
};

describe('edgeGuard', () => {
  it('refuses requests that bypassed Cloudflare', async () => {
    const res = await request(build(SECRET)).get('/resolve/derrick');
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: expect.any(String), code: 'DIRECT_ACCESS' });
    expect((await request(build(SECRET)).get('/resolve/derrick').set(EDGE_HEADER, 'wrong')).status).toBe(403);
  });

  it('lets requests through with the edge secret', async () => {
    expect((await request(build(SECRET)).get('/resolve/derrick').set(EDGE_HEADER, SECRET)).status).toBe(200);
  });

  it("keeps /health open for Fly's checks", async () => {
    expect((await request(build(SECRET)).get('/health')).status).toBe(200);
  });

  it('does nothing without a configured secret', async () => {
    expect((await request(build(undefined)).get('/resolve/derrick')).status).toBe(200);
  });

  it('compares the whole secret', () => {
    expect(hasEdgeSecret(SECRET, SECRET)).toBe(true);
    expect(hasEdgeSecret(SECRET.slice(0, -1), SECRET)).toBe(false);
    expect(hasEdgeSecret(undefined, SECRET)).toBe(false);
    expect(hasEdgeSecret('', SECRET)).toBe(false);
  });
});

describe('rateLimit behind the edge', () => {
  const limited = (viaEdge: boolean) => {
    const app = express();
    app.use(rateLimit(new RateLimiter(1, () => 0), { viaEdge }));
    app.get('*', (_req, res) => {
      res.json({ ok: true });
    });
    return app;
  };
  // Two visitors arriving through the same Cloudflare edge server.
  const visit = (app: express.Express, visitor: string) =>
    request(app).get('/x').set('Fly-Client-IP', '162.158.1.1').set('CF-Connecting-IP', visitor);

  it('keys on CF-Connecting-IP, so visitors sharing an edge server get their own budget', async () => {
    const app = limited(true);
    expect((await visit(app, '203.0.113.1')).status).toBe(200);
    expect((await visit(app, '203.0.113.2')).status).toBe(200);
    expect((await visit(app, '203.0.113.1')).status).toBe(429);
  });

  it('keys IPv6 visitors on their /64', async () => {
    const app = limited(true);
    await visit(app, '2001:db8:1:2::a');
    expect((await visit(app, '2001:db8:1:2::b')).status).toBe(429);
  });

  it('ignores CF-Connecting-IP when not behind the edge (it would be client-supplied)', async () => {
    const app = limited(false);
    expect((await visit(app, '203.0.113.1')).status).toBe(200);
    expect((await visit(app, '203.0.113.2')).status).toBe(429);
  });
});

describe('createApp with EDGE_SECRET (real wiring)', () => {
  let app: express.Express;
  // Whatever the shell running the tests had; put back afterwards.
  const saved = { secret: process.env.EDGE_SECRET, limit: process.env.PUBLIC_RATE_LIMIT_PER_MIN };
  beforeAll(() => {
    process.env.EDGE_SECRET = SECRET;
    process.env.PUBLIC_RATE_LIMIT_PER_MIN = '1';
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      app = require('../src/app').createApp();
    });
    // Assigning undefined would store the string "undefined", which fails env validation.
    const restore = (key: string, value: string | undefined) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    };
    restore('EDGE_SECRET', saved.secret);
    restore('PUBLIC_RATE_LIMIT_PER_MIN', saved.limit);
  });
  const viaEdge = (path: string, visitor: string) =>
    request(app).get(path).set(EDGE_HEADER, SECRET).set('Fly-Client-IP', '162.158.1.1').set('CF-Connecting-IP', visitor);

  it('refuses direct requests with a CORS-readable body, but keeps /health open', async () => {
    const direct = await request(app).get('/resolve/derrick').set('Origin', 'https://example.com');
    expect(direct.status).toBe(403);
    expect(direct.body.code).toBe('DIRECT_ACCESS');
    expect(direct.headers['access-control-allow-origin']).toBeDefined();
    expect((await request(app).get('/health')).status).toBe(200);
  });

  it('serves /ping through the edge', async () => {
    expect((await viaEdge('/ping', '203.0.113.9')).status).toBe(200);
  });

  it('rate-limits per visitor behind a shared edge server', async () => {
    // Validation rejects the malformed wallet after the limiter, so no database is needed.
    const path = '/available/alice?wallet=nope';
    expect((await viaEdge(path, '203.0.113.1')).status).toBe(400);
    expect((await viaEdge(path, '203.0.113.2')).status).toBe(400);
    expect((await viaEdge(path, '203.0.113.1')).status).toBe(429);
  });

  it('leaves the environment as it found it', () => {
    expect(process.env.EDGE_SECRET).toBe(saved.secret);
    expect(process.env.PUBLIC_RATE_LIMIT_PER_MIN).toBe(saved.limit);
  });
});

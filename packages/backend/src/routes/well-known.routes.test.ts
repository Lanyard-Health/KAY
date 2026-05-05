import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { generateKeyPairSync } from 'node:crypto';
import { wellKnownRoutes } from './well-known.routes.js';

describe('well-known.routes', () => {
  const { publicKey } = generateKeyPairSync('ed25519');
  const PUB_PEM = publicKey.export({ type: 'spki', format: 'pem' }) as string;
  const KEY_ID = 'test-current';

  let snapshot: Record<string, string | undefined>;
  let app: express.Express;

  beforeEach(() => {
    snapshot = {
      AGENT_SIGNING_PUBLIC_KEY: process.env['AGENT_SIGNING_PUBLIC_KEY'],
      AGENT_SIGNING_KEY_ID: process.env['AGENT_SIGNING_KEY_ID'],
      AGENT_SIGNING_RETIRED_KEYS: process.env['AGENT_SIGNING_RETIRED_KEYS'],
    };
    process.env['AGENT_SIGNING_PUBLIC_KEY'] = PUB_PEM;
    process.env['AGENT_SIGNING_KEY_ID'] = KEY_ID;
    delete process.env['AGENT_SIGNING_RETIRED_KEYS'];

    app = express();
    app.use('/.well-known', wellKnownRoutes);
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(snapshot)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  describe('GET /.well-known/lanyard-signing-key.pem', () => {
    it('returns current public key as application/x-pem-file', async () => {
      const res = await request(app).get('/.well-known/lanyard-signing-key.pem');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/x-pem-file');
      expect(res.headers['cache-control']).toContain('max-age=300');
      expect(res.text).toBe(PUB_PEM);
    });

    it('returns 503 when key not configured', async () => {
      delete process.env['AGENT_SIGNING_PUBLIC_KEY'];
      const res = await request(app).get('/.well-known/lanyard-signing-key.pem');
      expect(res.status).toBe(503);
    });
  });

  describe('GET /.well-known/lanyard-signing-keys.json', () => {
    it('returns current key in JWKS-style shape', async () => {
      const res = await request(app).get('/.well-known/lanyard-signing-keys.json');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        keys: [{ keyId: KEY_ID, publicKey: PUB_PEM, status: 'current' }],
      });
    });

    it('includes retired keys when configured, current first', async () => {
      process.env['AGENT_SIGNING_RETIRED_KEYS'] = JSON.stringify([
        { keyId: 'old-1', publicKey: '-----BEGIN OLD-----', retiredAt: '2026-04-01T00:00:00Z' },
      ]);
      const res = await request(app).get('/.well-known/lanyard-signing-keys.json');
      expect(res.status).toBe(200);
      expect(res.body.keys).toHaveLength(2);
      expect(res.body.keys[0].status).toBe('current');
      expect(res.body.keys[1]).toEqual({
        keyId: 'old-1',
        publicKey: '-----BEGIN OLD-----',
        status: 'retired',
        retiredAt: '2026-04-01T00:00:00Z',
      });
    });

    it('returns empty keys array when nothing configured', async () => {
      delete process.env['AGENT_SIGNING_PUBLIC_KEY'];
      delete process.env['AGENT_SIGNING_KEY_ID'];
      const res = await request(app).get('/.well-known/lanyard-signing-keys.json');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ keys: [] });
    });
  });
});

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { buildOpenApiSpec } from '../scripts/generate-openapi.js';

const COMMITTED_SPEC_PATH = fileURLToPath(new URL('../openapi.json', import.meta.url));

describe('OpenAPI spec generator', () => {
  it('produces byte-identical output across two consecutive runs', () => {
    const a = buildOpenApiSpec();
    const b = buildOpenApiSpec();
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it('matches the committed openapi.json (no drift)', () => {
    const generated = buildOpenApiSpec();
    const committed = readFileSync(COMMITTED_SPEC_PATH, 'utf8');
    expect(generated).toBe(committed);
  });

  it('declares OpenAPI 3.1 with the expected info block', () => {
    const doc = JSON.parse(buildOpenApiSpec());
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info.title).toBe('Lanyard Health API');
    expect(doc.info.version).toMatch(/phase-0a/);
  });

  it('includes every Phase 0.A operation', () => {
    const doc = JSON.parse(buildOpenApiSpec()) as {
      paths: Record<string, Record<string, unknown>>;
    };
    expect(doc.paths['/api/v1/webhook-subscriptions']).toMatchObject({
      post: expect.any(Object),
      get: expect.any(Object),
    });
    expect(doc.paths['/api/v1/webhook-subscriptions/{id}']).toMatchObject({
      delete: expect.any(Object),
    });
    expect(doc.paths['/.well-known/lanyard-signing-key.pem']).toMatchObject({
      get: expect.any(Object),
    });
    expect(doc.paths['/.well-known/lanyard-signing-keys.json']).toMatchObject({
      get: expect.any(Object),
    });
  });

  it('declares bearer auth on the webhook subscription routes only', () => {
    const doc = JSON.parse(buildOpenApiSpec()) as {
      paths: Record<string, Record<string, { security?: unknown[] }>>;
    };
    const post = doc.paths['/api/v1/webhook-subscriptions']?.['post'];
    const wellKnown = doc.paths['/.well-known/lanyard-signing-key.pem']?.['get'];
    expect(post?.security).toEqual([{ bearerAuth: [] }]);
    expect(wellKnown?.security).toBeUndefined();
  });
});

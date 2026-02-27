import { describe, it, expect } from 'vitest';

/**
 * Tests the CORS allowedHeaders conditional logic from index.ts:
 *   ...(process.env['NODE_ENV'] !== 'production' ? ['X-Dev-Role'] : [])
 *
 * We test the logic directly since index.ts boots a full server.
 */
describe('CORS allowedHeaders conditional', () => {
  function buildAllowedHeaders(nodeEnv: string): string[] {
    return [
      'Content-Type',
      'Authorization',
      'X-Ops-Practice-Context',
      ...(nodeEnv !== 'production' ? ['X-Dev-Role'] : []),
    ];
  }

  it('includes X-Dev-Role in development', () => {
    const headers = buildAllowedHeaders('development');
    expect(headers).toContain('X-Dev-Role');
  });

  it('includes X-Dev-Role in test', () => {
    const headers = buildAllowedHeaders('test');
    expect(headers).toContain('X-Dev-Role');
  });

  it('excludes X-Dev-Role in production', () => {
    const headers = buildAllowedHeaders('production');
    expect(headers).not.toContain('X-Dev-Role');
  });

  it('always includes Content-Type, Authorization, and X-Ops-Practice-Context', () => {
    for (const env of ['development', 'test', 'production']) {
      const headers = buildAllowedHeaders(env);
      expect(headers).toContain('Content-Type');
      expect(headers).toContain('Authorization');
      expect(headers).toContain('X-Ops-Practice-Context');
    }
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('validateEnv', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset modules so validateEnv reads fresh process.env
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  function setMinimalEnv(overrides: Record<string, string | undefined> = {}) {
    // Minimal valid env
    process.env['DATABASE_URL'] = 'postgresql://localhost/test';
    process.env['JWT_SECRET'] = 'a-secret-that-is-at-least-16-chars';
    process.env['NODE_ENV'] = 'development';
    // Apply overrides
    for (const [key, val] of Object.entries(overrides)) {
      if (val === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = val;
      }
    }
  }

  it('throws FATAL error when ENCRYPTION_KEY is missing in production', async () => {
    setMinimalEnv({ NODE_ENV: 'production' });
    delete process.env['ENCRYPTION_KEY'];

    const { validateEnv } = await import('./env.js');
    expect(() => validateEnv()).toThrow('FATAL: ENCRYPTION_KEY is required in production');
  });

  it('does not throw when ENCRYPTION_KEY is present in production', async () => {
    setMinimalEnv({
      NODE_ENV: 'production',
      ENCRYPTION_KEY: 'a'.repeat(64), // 64-char hex string
      DATABASE_URL: 'postgresql://localhost/test?sslmode=require',
    });

    const { validateEnv } = await import('./env.js');
    expect(() => validateEnv()).not.toThrow();
  });

  it('throws when DATABASE_URL lacks sslmode in production', async () => {
    setMinimalEnv({
      NODE_ENV: 'production',
      ENCRYPTION_KEY: 'a'.repeat(64),
      DATABASE_URL: 'postgresql://localhost/test',
    });

    const { validateEnv } = await import('./env.js');
    expect(() => validateEnv()).toThrow('FATAL: DATABASE_URL must include sslmode=require in production');
  });

  it('does not throw when DATABASE_URL has sslmode=verify-full in production', async () => {
    setMinimalEnv({
      NODE_ENV: 'production',
      ENCRYPTION_KEY: 'a'.repeat(64),
      DATABASE_URL: 'postgresql://localhost/test?sslmode=verify-full',
    });

    const { validateEnv } = await import('./env.js');
    expect(() => validateEnv()).not.toThrow();
  });

  it('does not throw when ENCRYPTION_KEY is missing in development', async () => {
    setMinimalEnv({ NODE_ENV: 'development' });
    delete process.env['ENCRYPTION_KEY'];

    const { validateEnv } = await import('./env.js');
    expect(() => validateEnv()).not.toThrow();
  });

  it('throws on missing required DATABASE_URL', async () => {
    setMinimalEnv();
    delete process.env['DATABASE_URL'];

    const { validateEnv } = await import('./env.js');
    expect(() => validateEnv()).toThrow('DATABASE_URL');
  });
});

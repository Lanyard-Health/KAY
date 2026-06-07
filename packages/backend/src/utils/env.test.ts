import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { validateEnv, devBypassEnabled } from './env.js';
import { logger } from './logger.js';

const CAQH_REQUIRED = ['CAQH_API_URL', 'CAQH_ORG_ID', 'CAQH_USERNAME', 'CAQH_PASSWORD'] as const;
const CAQH_OPTIONAL = ['CAQH_PRODUCT', 'CAQH_SYNC_SCHEDULE'] as const;

const SAVED: Record<string, string | undefined> = {};

function snapshot(keys: readonly string[]) {
  for (const k of keys) SAVED[k] = process.env[k];
}

function restore(keys: readonly string[]) {
  for (const k of keys) {
    if (SAVED[k] === undefined) delete process.env[k];
    else process.env[k] = SAVED[k];
  }
}

const TRACKED = [
  'NODE_ENV',
  'DATABASE_URL',
  ...CAQH_REQUIRED,
  ...CAQH_OPTIONAL,
];

describe('validateEnv — CAQH startup assertion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    snapshot(TRACKED);
    process.env['DATABASE_URL'] = 'postgresql://test';
    for (const k of [...CAQH_REQUIRED, ...CAQH_OPTIONAL]) delete process.env[k];
  });

  afterEach(() => {
    restore(TRACKED);
  });

  describe('production', () => {
    beforeEach(() => {
      process.env['NODE_ENV'] = 'production';
    });

    it('throws when any required CAQH var is missing', () => {
      process.env['CAQH_API_URL'] = 'https://proview.caqh.org';
      process.env['CAQH_ORG_ID'] = '1873';
      process.env['CAQH_USERNAME'] = 'user';
      // CAQH_PASSWORD intentionally missing

      expect(() => validateEnv()).toThrow(/CAQH integration env vars.*required.*production.*CAQH_PASSWORD/);
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('CAQH_PASSWORD'));
    });

    it('throws and lists every missing required var', () => {
      // None of the 4 set
      expect(() => validateEnv()).toThrow(/CAQH_API_URL.*CAQH_ORG_ID.*CAQH_USERNAME.*CAQH_PASSWORD/);
    });

    it('boots cleanly when all required CAQH vars are set', () => {
      process.env['CAQH_API_URL'] = 'https://proview.caqh.org';
      process.env['CAQH_ORG_ID'] = '1873';
      process.env['CAQH_USERNAME'] = 'user';
      process.env['CAQH_PASSWORD'] = 'pass';

      expect(() => validateEnv()).not.toThrow();
      expect(logger.error).not.toHaveBeenCalledWith(expect.stringContaining('CAQH'));
    });

    it('does NOT require CAQH_PRODUCT or CAQH_SYNC_SCHEDULE (they have defaults at point of use)', () => {
      process.env['CAQH_API_URL'] = 'https://proview.caqh.org';
      process.env['CAQH_ORG_ID'] = '1873';
      process.env['CAQH_USERNAME'] = 'user';
      process.env['CAQH_PASSWORD'] = 'pass';
      // CAQH_PRODUCT and CAQH_SYNC_SCHEDULE intentionally omitted

      expect(() => validateEnv()).not.toThrow();
    });
  });

  describe('development', () => {
    beforeEach(() => {
      process.env['NODE_ENV'] = 'development';
    });

    it('does NOT throw when required CAQH vars are missing', () => {
      expect(() => validateEnv()).not.toThrow();
    });

    it('logs a warning naming the missing vars', () => {
      validateEnv();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringMatching(/CAQH integration env vars missing.*CAQH_API_URL.*CAQH_ORG_ID.*CAQH_USERNAME.*CAQH_PASSWORD/)
      );
    });

    it('does not warn when all required CAQH vars are set', () => {
      process.env['CAQH_API_URL'] = 'https://proview-demo.nonprod.caqh.org';
      process.env['CAQH_ORG_ID'] = '6279';
      process.env['CAQH_USERNAME'] = 'demouser';
      process.env['CAQH_PASSWORD'] = 'demopass';

      validateEnv();
      const caqhWarnings = (logger.warn as ReturnType<typeof vi.fn>).mock.calls.filter((c) =>
        typeof c[0] === 'string' && c[0].includes('CAQH integration env vars missing')
      );
      expect(caqhWarnings).toHaveLength(0);
    });
  });

  describe('test environment', () => {
    beforeEach(() => {
      process.env['NODE_ENV'] = 'test';
    });

    it('does NOT throw when required CAQH vars are missing (mirrors dev behavior)', () => {
      expect(() => validateEnv()).not.toThrow();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('CAQH integration env vars missing')
      );
    });
  });
});

describe('validateEnv — CAQH_ROSTER_MODE default', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    snapshot(['NODE_ENV', 'DATABASE_URL', 'CAQH_ROSTER_MODE', ...CAQH_REQUIRED]);
    process.env['NODE_ENV'] = 'development';
    process.env['DATABASE_URL'] = 'postgresql://test';
    for (const k of CAQH_REQUIRED) delete process.env[k];
    delete process.env['CAQH_ROSTER_MODE'];
  });

  afterEach(() => {
    restore(['NODE_ENV', 'DATABASE_URL', 'CAQH_ROSTER_MODE', ...CAQH_REQUIRED]);
  });

  it('defaults CAQH_ROSTER_MODE to "individual" when env var is not set', () => {
    const env = validateEnv();
    expect(env.CAQH_ROSTER_MODE).toBe('individual');
  });

  it('honors CAQH_ROSTER_MODE=batch as the explicit rollback path', () => {
    process.env['CAQH_ROSTER_MODE'] = 'batch';
    const env = validateEnv();
    expect(env.CAQH_ROSTER_MODE).toBe('batch');
  });

  it('honors CAQH_ROSTER_MODE=individual when set explicitly', () => {
    process.env['CAQH_ROSTER_MODE'] = 'individual';
    const env = validateEnv();
    expect(env.CAQH_ROSTER_MODE).toBe('individual');
  });

  it('rejects unknown CAQH_ROSTER_MODE values at startup', () => {
    process.env['CAQH_ROSTER_MODE'] = 'asynchronous';
    expect(() => validateEnv()).toThrow(/CAQH_ROSTER_MODE/);
  });
});

describe('DEV_AUTH_BYPASS — fail-closed behavior', () => {
  const DEV_KEYS = ['NODE_ENV', 'DATABASE_URL', 'DEV_AUTH_BYPASS', ...CAQH_REQUIRED] as const;

  beforeEach(() => {
    vi.clearAllMocks();
    snapshot(DEV_KEYS);
    process.env['DATABASE_URL'] = 'postgresql://test';
    // CAQH vars present so we don't trip the CAQH guard during these tests
    process.env['CAQH_API_URL'] = 'https://proview-demo.nonprod.caqh.org';
    process.env['CAQH_ORG_ID'] = '6279';
    process.env['CAQH_USERNAME'] = 'demouser';
    process.env['CAQH_PASSWORD'] = 'demopass';
  });

  afterEach(() => {
    restore(DEV_KEYS);
  });

  describe('devBypassEnabled() helper', () => {
    it('returns true when DEV_AUTH_BYPASS=true and NODE_ENV=development', () => {
      process.env['DEV_AUTH_BYPASS'] = 'true';
      process.env['NODE_ENV'] = 'development';
      expect(devBypassEnabled()).toBe(true);
    });

    it('returns false when DEV_AUTH_BYPASS=true and NODE_ENV=production', () => {
      process.env['DEV_AUTH_BYPASS'] = 'true';
      process.env['NODE_ENV'] = 'production';
      expect(devBypassEnabled()).toBe(false);
    });

    it('returns false when DEV_AUTH_BYPASS=true and NODE_ENV is unset (the critical fail-closed case)', () => {
      process.env['DEV_AUTH_BYPASS'] = 'true';
      delete process.env['NODE_ENV'];
      expect(devBypassEnabled()).toBe(false);
    });

    it('returns false when DEV_AUTH_BYPASS=true and NODE_ENV is a typo (e.g. "Production" or "dev")', () => {
      process.env['DEV_AUTH_BYPASS'] = 'true';
      process.env['NODE_ENV'] = 'Production'; // wrong case
      expect(devBypassEnabled()).toBe(false);

      process.env['NODE_ENV'] = 'dev'; // not the literal 'development'
      expect(devBypassEnabled()).toBe(false);

      process.env['NODE_ENV'] = 'staging'; // not on the allowlist
      expect(devBypassEnabled()).toBe(false);
    });

    it('returns true when DEV_AUTH_BYPASS=true and NODE_ENV=test (test runners)', () => {
      process.env['DEV_AUTH_BYPASS'] = 'true';
      process.env['NODE_ENV'] = 'test';
      expect(devBypassEnabled()).toBe(true);
    });

    it('returns false when DEV_AUTH_BYPASS is unset', () => {
      delete process.env['DEV_AUTH_BYPASS'];
      process.env['NODE_ENV'] = 'development';
      expect(devBypassEnabled()).toBe(false);
    });

    it('returns false when DEV_AUTH_BYPASS=1 (must be the literal string "true")', () => {
      process.env['DEV_AUTH_BYPASS'] = '1';
      process.env['NODE_ENV'] = 'development';
      expect(devBypassEnabled()).toBe(false);
    });
  });

  describe('validateEnv() boot-time guard', () => {
    it('throws when DEV_AUTH_BYPASS=true and NODE_ENV=production', () => {
      process.env['DEV_AUTH_BYPASS'] = 'true';
      process.env['NODE_ENV'] = 'production';
      // CAQH vars set to production values so CAQH guard doesn't fire first
      process.env['CAQH_API_URL'] = 'https://proview.caqh.org';
      process.env['CAQH_ORG_ID'] = '1873';
      process.env['CAQH_USERNAME'] = 'user';
      process.env['CAQH_PASSWORD'] = 'pass';
      expect(() => validateEnv()).toThrow(/DEV_AUTH_BYPASS=true is not allowed when NODE_ENV=production/);
    });

    it('does NOT throw when DEV_AUTH_BYPASS=true and NODE_ENV=development', () => {
      process.env['DEV_AUTH_BYPASS'] = 'true';
      process.env['NODE_ENV'] = 'development';
      expect(() => validateEnv()).not.toThrow();
    });

    it('does NOT throw when DEV_AUTH_BYPASS is unset and NODE_ENV=production', () => {
      delete process.env['DEV_AUTH_BYPASS'];
      process.env['NODE_ENV'] = 'production';
      // CAQH vars set to production values so CAQH guard doesn't fire
      process.env['CAQH_API_URL'] = 'https://proview.caqh.org';
      process.env['CAQH_ORG_ID'] = '1873';
      process.env['CAQH_USERNAME'] = 'user';
      process.env['CAQH_PASSWORD'] = 'pass';
      expect(() => validateEnv()).not.toThrow();
    });
  });
});

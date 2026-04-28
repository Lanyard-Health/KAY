import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { validateEnv } from './env.js';
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

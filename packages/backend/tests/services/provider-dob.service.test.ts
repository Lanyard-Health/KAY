import { describe, it, expect, afterEach } from 'vitest';
import {
  dobWrite,
  providerDob,
  providerDobDate,
  providerDobIso,
  hasDob,
  withDob,
} from '../../src/services/provider-dob.service.js';

const KEY = process.env['ENCRYPTION_KEY'];

afterEach(() => {
  if (KEY) process.env['ENCRYPTION_KEY'] = KEY;
});

describe('dobWrite', () => {
  it('leaves the column alone for undefined', () => {
    expect(dobWrite(undefined)).toEqual({});
  });

  it('clears the encrypted column for null', () => {
    expect(dobWrite(null)).toEqual({ dateOfBirthEncrypted: null });
  });

  it('encrypts a YYYY-MM-DD string', () => {
    const out = dobWrite('1980-05-01');
    expect(out.dateOfBirthEncrypted).toMatch(/^[0-9a-f]{32}:[0-9a-f]{32}:[0-9a-f]+$/);
  });

  // Phase 4: the plaintext half is gone. A write must never touch the legacy
  // column again — including never nulling it, so deploying Phase 4 on its own
  // stays reversible and only the deliberate --clear-plaintext run removes data.
  it('never emits the plaintext column', () => {
    for (const input of ['1980-05-01', null, undefined, 'not-a-date'] as const) {
      expect(dobWrite(input)).not.toHaveProperty('dateOfBirth');
    }
  });

  it('takes the UTC date from a Date, not the local one', () => {
    // 23:30 UTC — a local-timezone projection west of UTC would roll back a day
    const out = dobWrite(new Date('1980-05-01T23:30:00.000Z'));
    expect(providerDob({ dateOfBirthEncrypted: out.dateOfBirthEncrypted })).toBe('1980-05-01');
  });

  it('produces a different ciphertext each call (random IV)', () => {
    expect(dobWrite('1980-05-01').dateOfBirthEncrypted).not.toBe(
      dobWrite('1980-05-01').dateOfBirthEncrypted
    );
  });

  it('treats an unparseable date as absent rather than throwing', () => {
    expect(dobWrite('not-a-date')).toEqual({ dateOfBirthEncrypted: null });
  });

  it('throws without ENCRYPTION_KEY instead of writing plaintext', () => {
    delete process.env['ENCRYPTION_KEY'];
    expect(() => dobWrite('1980-05-01')).toThrow(/ENCRYPTION_KEY is required/);
  });
});

describe('providerDob', () => {
  it('round-trips through the encrypted column', () => {
    const { dateOfBirthEncrypted } = dobWrite('1962-11-30');
    expect(providerDob({ dateOfBirthEncrypted })).toBe('1962-11-30');
  });

  it('prefers ciphertext over legacy plaintext', () => {
    const { dateOfBirthEncrypted } = dobWrite('1962-11-30');
    const row = { dateOfBirthEncrypted, dateOfBirth: new Date('1999-01-01T00:00:00.000Z') };
    expect(providerDob(row)).toBe('1962-11-30');
  });

  it('falls back to legacy plaintext when the column is empty', () => {
    expect(providerDob({ dateOfBirth: new Date('1975-03-09T00:00:00.000Z') })).toBe('1975-03-09');
  });

  it('returns null, not a throw, when the column holds plaintext', () => {
    expect(providerDob({ dateOfBirthEncrypted: '1980-05-01' })).toBeNull();
  });

  it('returns null, not a throw, on a corrupt ciphertext', () => {
    const { dateOfBirthEncrypted } = dobWrite('1980-05-01');
    const corrupt = `${dateOfBirthEncrypted!.slice(0, -2)}ff`;
    expect(providerDob({ dateOfBirthEncrypted: corrupt })).toBeNull();
  });

  it('returns null when the row has neither column', () => {
    expect(providerDob({})).toBeNull();
  });
});

describe('providerDobDate / providerDobIso', () => {
  it('returns UTC midnight', () => {
    const { dateOfBirthEncrypted } = dobWrite('1980-05-01');
    expect(providerDobDate({ dateOfBirthEncrypted })?.toISOString()).toBe('1980-05-01T00:00:00.000Z');
    expect(providerDobIso({ dateOfBirthEncrypted })).toBe('1980-05-01T00:00:00.000Z');
  });

  it('matches what Prisma serializes today for the same date', () => {
    const legacy = new Date('1980-05-01T00:00:00.000Z');
    expect(providerDobIso({ dateOfBirth: legacy })).toBe(JSON.parse(JSON.stringify(legacy)));
  });

  it('returns null when absent', () => {
    expect(providerDobDate({})).toBeNull();
    expect(providerDobIso({})).toBeNull();
  });
});

describe('hasDob', () => {
  it('is true for either column without decrypting', () => {
    delete process.env['ENCRYPTION_KEY'];
    expect(hasDob({ dateOfBirthEncrypted: 'anything' })).toBe(true);
    expect(hasDob({ dateOfBirth: new Date() })).toBe(true);
  });

  it('is false when both are absent', () => {
    expect(hasDob({})).toBe(false);
    expect(hasDob({ dateOfBirthEncrypted: null, dateOfBirth: null })).toBe(false);
  });
});

describe('withDob', () => {
  it('always strips the ciphertext column', () => {
    const { dateOfBirthEncrypted } = dobWrite('1980-05-01');
    const row = { id: 'p1', dateOfBirthEncrypted, dateOfBirth: new Date('1980-05-01T00:00:00.000Z') };
    expect(withDob(row, { include: true })).not.toHaveProperty('dateOfBirthEncrypted');
    expect(withDob(row, { include: false })).not.toHaveProperty('dateOfBirthEncrypted');
  });

  it('omits dateOfBirth entirely when not included', () => {
    const { dateOfBirthEncrypted } = dobWrite('1980-05-01');
    expect(withDob({ id: 'p1', dateOfBirthEncrypted }, { include: false })).toEqual({ id: 'p1' });
  });

  it('re-adds dateOfBirth as an ISO string when included', () => {
    const { dateOfBirthEncrypted } = dobWrite('1980-05-01');
    expect(withDob({ id: 'p1', dateOfBirthEncrypted }, { include: true })).toEqual({
      id: 'p1',
      dateOfBirth: '1980-05-01T00:00:00.000Z',
    });
  });
});

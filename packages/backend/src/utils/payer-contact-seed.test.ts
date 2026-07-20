import { describe, it, expect } from 'vitest';
import { normalizePayerName, planContactSeeds } from './payer-contact-seed.js';

describe('normalizePayerName', () => {
  it('lowercases, strips punctuation, collapses whitespace', () => {
    expect(normalizePayerName('Aetna Better Health, Inc.')).toBe('aetna better health');
    expect(normalizePayerName('MOLINA   HEALTHCARE-OF TEXAS')).toBe('molina healthcare of texas');
  });
  it('strips trailing corporate suffixes only', () => {
    expect(normalizePayerName('Cigna Corp')).toBe('cigna');
    expect(normalizePayerName('Company Health Plan')).toBe('company health plan'); // suffix only when trailing
  });
});

describe('planContactSeeds', () => {
  const payers = [
    { id: 'p1', name: 'Aetna Better Health, Inc.', phone: null },
    { id: 'p2', name: 'Molina Healthcare of Texas', phone: '(800) 555-0111' },
    { id: 'p3', name: 'Unmatched Payer', phone: null },
    { id: 'p4', name: 'Already Seeded', phone: '(800) 555-0999' },
  ];
  const contacts = [
    { trackName: 'Aetna Better Health', contactType: 'Provider Services', phone: '(800) 555-0100', email: null, hours: null, notes: null },
    { trackName: 'Aetna Better Health', contactType: 'Credentialing', phone: '(800) 555-0142', email: 'cred@aetna.com', hours: 'M-F 8-5 CT', notes: null },
  ];

  it('matches by exact normalized name only, preferring the Credentialing contact', () => {
    const plan = planContactSeeds(payers, contacts, new Set());
    const aetna = plan.find((r) => r.payerId === 'p1')!;
    expect(aetna.source).toBe('payer_contact');
    expect(aetna.phone).toBe('(800) 555-0142'); // Credentialing beats Provider Services
    expect(aetna.email).toBe('cred@aetna.com');
  });

  it('falls back to Payer.phone when no contact matches', () => {
    const plan = planContactSeeds(payers, contacts, new Set());
    const molina = plan.find((r) => r.payerId === 'p2')!;
    expect(molina.source).toBe('payer_phone');
    expect(molina.phone).toBe('(800) 555-0111');
  });

  it('produces no row when there is no data (rows exist only where data exists)', () => {
    const plan = planContactSeeds(payers, contacts, new Set());
    expect(plan.find((r) => r.payerId === 'p3')).toBeUndefined();
  });

  it('is idempotent — skips payers that already have a row', () => {
    const plan = planContactSeeds(payers, contacts, new Set(['p4']));
    expect(plan.find((r) => r.payerId === 'p4')).toBeUndefined();
  });

  it('never fuzzy-matches (a wrong number on click-to-call is worse than the empty state)', () => {
    const near = [{ id: 'p9', name: 'Aetna Better Health of Ohio', phone: null }];
    const plan = planContactSeeds(near, contacts, new Set());
    expect(plan).toHaveLength(0);
  });
});

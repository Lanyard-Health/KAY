import { describe, it, expect } from 'vitest';
import { STATUS_META, etaCaption, attentionCopy } from './statusMeta';

describe('STATUS_META', () => {
  it('uses the Kay-approved human labels, never enums', () => {
    expect(STATUS_META.submitted.label).toBe('Submitted to payer');
    expect(STATUS_META.pending_review.label).toBe('Payer reviewing');
    expect(STATUS_META.terminated.label).toBe('No longer active');
  });
  it('uses the DESIGN.md dashboard hexes (teal submitted, AA green approved)', () => {
    expect(STATUS_META.submitted.dotHex).toBe('#0E7490');
    expect(STATUS_META.approved.dotHex).toBe('#15803D');
    expect(STATUS_META.not_started.hollow).toBe(true);
  });
});

describe('etaCaption', () => {
  it('renders the window when on file', () => {
    expect(etaCaption(21, 30, 60)).toBe('Day 21 · typically 30–60 days');
  });
  it('is honest when no window is on file', () => {
    expect(etaCaption(9, null, null)).toBe('Day 9 · no typical timeline on file');
  });
  it('returns null without a day count', () => {
    expect(etaCaption(null, 30, 60)).toBeNull();
  });
});

describe('attentionCopy (the we-are-on-it rule: every item has a plan line)', () => {
  const base = { enrollmentId: 'e', providerName: 'Devon Marsh', payerName: 'Cigna', lastFollowUpDate: '2026-06-28T12:00:00Z', nextFollowUpDate: '2026-07-08T12:00:00Z' };
  it('delayed item: headline says running long; plan has follow-up + check-in', () => {
    const { headline, plan } = attentionCopy({ ...base, kind: 'delayed' });
    expect(headline).toBe('Devon Marsh — Cigna is running longer than usual.');
    expect(plan).toContain('followed up with Cigna on Jun 28');
    expect(plan).toContain('Next check-in: Jul 8');
  });
  it('denied item: resubmission plan line', () => {
    const { headline, plan } = attentionCopy({ ...base, kind: 'denied' });
    expect(headline).toBe('Devon Marsh — Cigna was denied.');
    expect(plan).toContain('preparing the resubmission');
  });
  it('never renders an empty plan even with no follow-up dates', () => {
    const { plan } = attentionCopy({ ...base, kind: 'delayed', lastFollowUpDate: null, nextFollowUpDate: null });
    expect(plan.length).toBeGreaterThan(10);
  });
});

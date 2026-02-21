import { describe, it, expect } from 'vitest';
import { buildExceptionSystemPrompt, buildExceptionUserMessage } from './prompt.js';

describe('buildExceptionSystemPrompt', () => {
  it('includes all 9 exception categories', () => {
    const prompt = buildExceptionSystemPrompt();

    const categories = [
      'missing_document', 'invalid_data', 'expired_credential',
      'duplicate_submission', 'portal_error', 'captcha_blocked',
      'payer_system_outage', 'unknown_denial', 'timeout_stall',
    ];

    for (const cat of categories) {
      expect(prompt).toContain(cat);
    }
  });

  it('includes JSON output format', () => {
    const prompt = buildExceptionSystemPrompt();
    expect(prompt).toContain('"category"');
    expect(prompt).toContain('"severity"');
    expect(prompt).toContain('"rootCause"');
    expect(prompt).toContain('"autoRemediable"');
    expect(prompt).toContain('"steps"');
  });
});

describe('buildExceptionUserMessage', () => {
  it('includes issue text', () => {
    const msg = buildExceptionUserMessage({
      issue: 'Enrollment denied by Aetna',
      providerCredentials: {},
      payerRequirements: {},
    });

    expect(msg).toContain('Enrollment denied by Aetna');
  });

  it('includes denial reason and code when present', () => {
    const msg = buildExceptionUserMessage({
      issue: 'Denial',
      denialReason: 'Missing malpractice certificate',
      denialCode: 'DOC-001',
      providerCredentials: {},
      payerRequirements: {},
    });

    expect(msg).toContain('Missing malpractice certificate');
    expect(msg).toContain('DOC-001');
  });

  it('includes provider credentials and payer requirements', () => {
    const msg = buildExceptionUserMessage({
      issue: 'Denial',
      providerCredentials: { npi: '123', licenses: ['CA'] },
      payerRequirements: { requiredFields: ['npi', 'medical_license'] },
    });

    expect(msg).toContain('"npi"');
    expect(msg).toContain('"medical_license"');
  });

  it('includes task error when present', () => {
    const msg = buildExceptionUserMessage({
      issue: 'Task failed',
      providerCredentials: {},
      payerRequirements: {},
      taskError: { message: 'Connection timeout' },
    });

    expect(msg).toContain('Connection timeout');
  });
});

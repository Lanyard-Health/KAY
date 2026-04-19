import { describe, it, expect } from 'vitest';
import { resolveRecipe, type RecipeField } from './recipe-resolver.js';
import type { CredentialingPacket } from '../credentialing-packet.service.js';

function packet(overrides: Partial<any> = {}): CredentialingPacket {
  const base = {
    provider: {
      id: 'p1',
      npi: '1234567893',
      firstName: 'Pat',
      lastName: 'O\'Brien',
      email: 'pat@example.com',
      phone: '5551234567',
      dateOfBirth: '1985-07-15T00:00:00.000Z',
      licenses: [
        { licenseNumber: 'MD123', state: 'OH', expirationDate: '2027-03-01T00:00:00.000Z' },
      ],
      educations: [{ degree: 'MD' }],
      boardCertifications: [],
      providerIdentifiers: [],
      banking: [],
      demographics: { gender: 'F' },
      practice: { name: 'Demo Practice', groupNpi: '9876543210' },
    },
    practice: { id: 'pr1', name: 'Demo Practice', groupNpi: '9876543210' },
    practicePayer: null,
    primaryLocation: null,
    sensitive: {
      ssn: null,
      taxIdPersonal: null,
      taxIdGroup: null,
      bankingAccountNumber: null,
      bankingRoutingNumber: null,
    },
    meta: {
      builtAt: new Date().toISOString(),
      decrypted: false,
      payerId: null,
      practicePayerId: null,
    },
  };
  return { ...base, ...overrides } as any as CredentialingPacket;
}

function field(partial: Partial<RecipeField> & { fieldKey: string; mappings: any[] }): RecipeField {
  return {
    id: partial.fieldKey,
    fieldLabel: partial.fieldLabel ?? partial.fieldKey,
    fieldType: partial.fieldType ?? 'text',
    required: partial.required ?? false,
    validationRegex: partial.validationRegex ?? null,
    ...partial,
  } as RecipeField;
}

describe('resolveRecipe', () => {
  it('resolves a simple provider field by path', () => {
    const result = resolveRecipe(
      [field({
        fieldKey: 'npi',
        mappings: [{ sourceKind: 'provider', sourcePath: 'npi' }],
      })],
      packet()
    );
    expect(result.values['npi']).toBe('1234567893');
    expect(result.missingRequired).toHaveLength(0);
  });

  it('walks array-index paths like licenses[0].state', () => {
    const result = resolveRecipe(
      [field({
        fieldKey: 'primary_license_state',
        mappings: [{ sourceKind: 'license', sourcePath: '[0].state' }],
      })],
      packet()
    );
    expect(result.values['primary_license_state']).toBe('OH');
  });

  it('reports required field as missing when path resolves to null', () => {
    const result = resolveRecipe(
      [field({
        fieldKey: 'middle_initial',
        required: true,
        mappings: [{ sourceKind: 'provider', sourcePath: 'middleName' }],
      })],
      packet()
    );
    expect(result.values['middle_initial']).toBeUndefined();
    expect(result.missingRequired.map((f) => f.fieldKey)).toEqual(['middle_initial']);
  });

  it('falls back to fallbackValue when source is null', () => {
    const result = resolveRecipe(
      [field({
        fieldKey: 'specialty',
        mappings: [
          { sourceKind: 'provider', sourcePath: 'specialty', fallbackValue: 'Psychiatry' },
        ],
      })],
      packet()
    );
    expect(result.values['specialty']).toBe('Psychiatry');
    expect(result.fields[0]?.fromFallback).toBe(true);
  });

  it('constant sourceKind uses sourcePath as the literal value', () => {
    const result = resolveRecipe(
      [field({
        fieldKey: 'agree_to_terms',
        mappings: [{ sourceKind: 'constant', sourcePath: 'true' }],
      })],
      packet()
    );
    expect(result.values['agree_to_terms']).toBe('true');
  });

  it('picks highest-priority mapping that resolves', () => {
    const result = resolveRecipe(
      [field({
        fieldKey: 'group_npi',
        mappings: [
          // Lower priority: practice.groupNpi (would resolve)
          { sourceKind: 'practice', sourcePath: 'groupNpi', priority: 1 },
          // Higher priority: practicePayer.groupNpi (resolves to null — practicePayer is null)
          { sourceKind: 'practicePayer', sourcePath: 'groupNpi', priority: 5 },
        ],
      })],
      packet()
    );
    // Highest priority was null; next wins
    expect(result.values['group_npi']).toBe('9876543210');
  });

  it('prefers practicePayer override when both are set', () => {
    const result = resolveRecipe(
      [field({
        fieldKey: 'group_npi',
        mappings: [
          { sourceKind: 'practice', sourcePath: 'groupNpi', priority: 1 },
          { sourceKind: 'practicePayer', sourcePath: 'groupNpi', priority: 5 },
        ],
      })],
      packet({
        practicePayer: {
          id: 'pp1',
          groupNpi: 'OVERRIDE123',
        } as any,
      })
    );
    expect(result.values['group_npi']).toBe('OVERRIDE123');
  });

  it('applies date transform', () => {
    const result = resolveRecipe(
      [field({
        fieldKey: 'dob',
        mappings: [
          {
            sourceKind: 'provider',
            sourcePath: 'dateOfBirth',
            transform: { fn: 'date', format: 'MM/DD/YYYY' },
          },
        ],
      })],
      packet()
    );
    expect(result.values['dob']).toBe('07/15/1985');
  });

  it('applies digits and ssnFormat transforms', () => {
    const result1 = resolveRecipe(
      [field({
        fieldKey: 'phone_digits',
        mappings: [
          {
            sourceKind: 'provider',
            sourcePath: 'phone',
            transform: { fn: 'digits' },
          },
        ],
      })],
      packet({ provider: { ...packet().provider, phone: '(555) 123-4567' } })
    );
    expect(result1.values['phone_digits']).toBe('5551234567');

    const result2 = resolveRecipe(
      [field({
        fieldKey: 'ssn',
        mappings: [
          {
            sourceKind: 'constant',
            sourcePath: '123456789',
            transform: { fn: 'ssnFormat' },
          },
        ],
      })],
      packet()
    );
    expect(result2.values['ssn']).toBe('123-45-6789');
  });

  it('applies phoneFormat transform', () => {
    const result = resolveRecipe(
      [field({
        fieldKey: 'phone',
        mappings: [
          {
            sourceKind: 'provider',
            sourcePath: 'phone',
            transform: { fn: 'phoneFormat' },
          },
        ],
      })],
      packet()
    );
    expect(result.values['phone']).toBe('(555) 123-4567');
  });

  it('applies mask transform for display of sensitive values', () => {
    const result = resolveRecipe(
      [field({
        fieldKey: 'tax_id_masked',
        mappings: [
          {
            sourceKind: 'constant',
            sourcePath: '987654321',
            transform: { fn: 'mask', keep: 'last4' },
          },
        ],
      })],
      packet()
    );
    expect(result.values['tax_id_masked']).toBe('*****4321');
  });

  it('flags values that fail validationRegex', () => {
    const result = resolveRecipe(
      [field({
        fieldKey: 'npi',
        validationRegex: '^\\d{10}$',
        mappings: [{ sourceKind: 'provider', sourcePath: 'npi' }],
      })],
      packet({ provider: { ...packet().provider, npi: 'NOT-10-DIGITS' } })
    );
    expect(result.invalid.map((f) => f.fieldKey)).toEqual(['npi']);
  });

  it('distinguishes missingRequired from missingOptional', () => {
    const result = resolveRecipe(
      [
        field({
          fieldKey: 'required_gone',
          required: true,
          mappings: [{ sourceKind: 'provider', sourcePath: 'nope' }],
        }),
        field({
          fieldKey: 'optional_gone',
          required: false,
          mappings: [{ sourceKind: 'provider', sourcePath: 'nope' }],
        }),
      ],
      packet()
    );
    expect(result.missingRequired.map((f) => f.fieldKey)).toEqual(['required_gone']);
    expect(result.missingOptional.map((f) => f.fieldKey)).toEqual(['optional_gone']);
  });

  it('empty recipe returns empty result cleanly', () => {
    const result = resolveRecipe([], packet());
    expect(result.fields).toHaveLength(0);
    expect(result.values).toEqual({});
    expect(result.missingRequired).toHaveLength(0);
  });

  it('coerces non-string primitives (numbers, booleans) to strings', () => {
    const result = resolveRecipe(
      [
        field({
          fieldKey: 'dob_year',
          mappings: [{ sourceKind: 'constant', sourcePath: '2024' }],
        }),
      ],
      packet()
    );
    expect(result.values['dob_year']).toBe('2024');
  });
});

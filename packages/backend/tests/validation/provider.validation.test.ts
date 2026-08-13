import { describe, it, expect } from 'vitest';
import {
  npiSchema,
  phoneSchema,
  genderSchema,
  providerTypeSchema,
  providerStatusSchema,
  createProviderSchema,
  updateProviderSchema,
} from '@credential-management/shared';

describe('Provider Validation Schemas', () => {
  describe('npiSchema', () => {
    it('accepts exactly 10 digits', () => {
      expect(npiSchema.parse('1234567890')).toBe('1234567890');
    });

    it('rejects fewer than 10 digits', () => {
      expect(() => npiSchema.parse('123456789')).toThrow();
    });

    it('rejects more than 10 digits', () => {
      expect(() => npiSchema.parse('12345678901')).toThrow();
    });

    it('rejects non-digit characters', () => {
      expect(() => npiSchema.parse('12345abcde')).toThrow();
    });

    it('rejects empty string', () => {
      expect(() => npiSchema.parse('')).toThrow();
    });
  });

  describe('phoneSchema', () => {
    it('accepts (555) 123-4567', () => {
      expect(() => phoneSchema.parse('(555) 123-4567')).not.toThrow();
    });

    it('accepts 555-123-4567', () => {
      expect(() => phoneSchema.parse('555-123-4567')).not.toThrow();
    });

    it('accepts 5551234567', () => {
      expect(() => phoneSchema.parse('5551234567')).not.toThrow();
    });

    it('accepts +1 555-123-4567', () => {
      expect(() => phoneSchema.parse('+1 555-123-4567')).not.toThrow();
    });

    it('accepts 555.123.4567', () => {
      expect(() => phoneSchema.parse('555.123.4567')).not.toThrow();
    });

    it('rejects too few digits', () => {
      expect(() => phoneSchema.parse('555-123')).toThrow();
    });

    it('rejects letters', () => {
      expect(() => phoneSchema.parse('555-abc-defg')).toThrow();
    });
  });

  describe('genderSchema', () => {
    it.each(['male', 'female', 'other', 'prefer_not_to_say'])('accepts "%s"', (val) => {
      expect(genderSchema.parse(val)).toBe(val);
    });

    it('rejects invalid gender', () => {
      expect(() => genderSchema.parse('unknown')).toThrow();
    });
  });

  describe('providerTypeSchema', () => {
    it.each(['psychiatrist', 'psychologist', 'lcsw', 'lpc', 'lmft', 'pmhnp', 'other'])(
      'accepts "%s"',
      (val) => {
        expect(providerTypeSchema.parse(val)).toBe(val);
      }
    );

    it('rejects invalid type', () => {
      expect(() => providerTypeSchema.parse('dentist')).toThrow();
    });
  });

  describe('createProviderSchema', () => {
    const validInput = {
      npi: '1234567890',
      firstName: 'Jane',
      lastName: 'Doe',
      dateOfBirth: '1985-06-15',
      gender: 'female',
      email: 'jane@example.com',
      phone: '(555) 123-4567',
      providerType: 'psychiatrist',
    };

    it('accepts valid complete input', () => {
      const result = createProviderSchema.parse(validInput);
      expect(result.npi).toBe('1234567890');
      expect(result.firstName).toBe('Jane');
    });

    it('requires firstName', () => {
      const { firstName, ...rest } = validInput;
      expect(() => createProviderSchema.parse(rest)).toThrow();
    });

    it('requires lastName', () => {
      const { lastName, ...rest } = validInput;
      expect(() => createProviderSchema.parse(rest)).toThrow();
    });

    // Optional by design, not an oversight: staff add providers from the NPI
    // registry, which does not publish a date of birth. CAQH readiness is what
    // requires one. This asserted the opposite and had been failing since that
    // decision shipped.
    it('allows a provider with no dateOfBirth', () => {
      const { dateOfBirth, ...rest } = validInput;
      expect(() => createProviderSchema.parse(rest)).not.toThrow();
    });

    it('validates date format YYYY-MM-DD', () => {
      expect(() =>
        createProviderSchema.parse({ ...validInput, dateOfBirth: '06/15/1985' })
      ).toThrow();
    });

    it('accepts valid date format', () => {
      const result = createProviderSchema.parse(validInput);
      expect(result.dateOfBirth).toBe('1985-06-15');
    });

    it('accepts optional fields when missing', () => {
      const result = createProviderSchema.parse(validInput);
      expect(result.middleName).toBeUndefined();
      expect(result.suffix).toBeUndefined();
      expect(result.taxonomy).toBeUndefined();
    });

    it('accepts optional arrays', () => {
      const result = createProviderSchema.parse({
        ...validInput,
        specialties: ['General Psychiatry'],
        languages: ['English', 'Spanish'],
      });
      expect(result.specialties).toEqual(['General Psychiatry']);
      expect(result.languages).toEqual(['English', 'Spanish']);
    });

    it('rejects invalid email', () => {
      expect(() =>
        createProviderSchema.parse({ ...validInput, email: 'not-an-email' })
      ).toThrow();
    });
  });

  describe('updateProviderSchema', () => {
    it('allows partial updates', () => {
      const result = updateProviderSchema.parse({ firstName: 'Updated' });
      expect(result.firstName).toBe('Updated');
    });

    it('allows status field', () => {
      const result = updateProviderSchema.parse({ status: 'inactive' });
      expect(result.status).toBe('inactive');
    });

    it('rejects invalid status', () => {
      expect(() => updateProviderSchema.parse({ status: 'deleted' })).toThrow();
    });

    it('accepts empty object (no changes)', () => {
      const result = updateProviderSchema.parse({});
      expect(result).toBeDefined();
    });
  });

  describe('providerStatusSchema', () => {
    it.each(['active', 'inactive', 'pending'])('accepts "%s"', (val) => {
      expect(providerStatusSchema.parse(val)).toBe(val);
    });

    it('rejects invalid status', () => {
      expect(() => providerStatusSchema.parse('deleted')).toThrow();
    });
  });
});

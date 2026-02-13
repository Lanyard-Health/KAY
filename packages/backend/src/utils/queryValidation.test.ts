import { describe, it, expect } from 'vitest';
import {
  paginationSchema,
  providerListQuerySchema,
  limitOffsetSchema,
  parseQuery,
} from './queryValidation.js';

describe('queryValidation', () => {
  describe('paginationSchema', () => {
    it('applies defaults (page=1, pageSize=20)', () => {
      const result = paginationSchema.parse({});
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(20);
    });

    it('coerces string values to numbers', () => {
      const result = paginationSchema.parse({ page: '3', pageSize: '10' });
      expect(result.page).toBe(3);
      expect(result.pageSize).toBe(10);
    });

    it('enforces minimum page of 1', () => {
      expect(() => paginationSchema.parse({ page: '0' })).toThrow();
    });

    it('enforces maximum pageSize of 100', () => {
      expect(() => paginationSchema.parse({ pageSize: '101' })).toThrow();
    });

    it('enforces minimum pageSize of 1', () => {
      expect(() => paginationSchema.parse({ pageSize: '0' })).toThrow();
    });
  });

  describe('providerListQuerySchema', () => {
    it('includes search as optional string', () => {
      const result = providerListQuerySchema.parse({ search: 'Jane' });
      expect(result.search).toBe('Jane');
    });

    it('includes status as optional string', () => {
      const result = providerListQuerySchema.parse({ status: 'active' });
      expect(result.status).toBe('active');
    });

    it('works without optional fields', () => {
      const result = providerListQuerySchema.parse({});
      expect(result.search).toBeUndefined();
      expect(result.status).toBeUndefined();
      expect(result.page).toBe(1);
    });
  });

  describe('limitOffsetSchema', () => {
    it('applies defaults (limit=20, offset=0)', () => {
      const result = limitOffsetSchema.parse({});
      expect(result.limit).toBe(20);
      expect(result.offset).toBe(0);
    });

    it('coerces string values to numbers', () => {
      const result = limitOffsetSchema.parse({ limit: '50', offset: '10' });
      expect(result.limit).toBe(50);
      expect(result.offset).toBe(10);
    });

    it('enforces minimum limit of 1', () => {
      expect(() => limitOffsetSchema.parse({ limit: '0' })).toThrow();
    });

    it('enforces maximum limit of 100', () => {
      expect(() => limitOffsetSchema.parse({ limit: '101' })).toThrow();
    });

    it('enforces minimum offset of 0', () => {
      expect(() => limitOffsetSchema.parse({ offset: '-1' })).toThrow();
    });
  });

  describe('parseQuery()', () => {
    it('parses with schema and returns typed result', () => {
      const result = parseQuery({ page: '2', pageSize: '50' }, paginationSchema);
      expect(result.page).toBe(2);
      expect(result.pageSize).toBe(50);
    });
  });
});

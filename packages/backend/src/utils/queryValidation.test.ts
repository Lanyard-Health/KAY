import { describe, it, expect } from 'vitest';
import {
  paginationSchema,
  providerListQuerySchema,
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

  describe('parseQuery()', () => {
    it('parses with schema and returns typed result', () => {
      const result = parseQuery({ page: '2', pageSize: '50' }, paginationSchema);
      expect(result.page).toBe(2);
      expect(result.pageSize).toBe(50);
    });
  });
});

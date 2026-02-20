import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerAdapter,
  getAdapter,
  listAdapterTypes,
  clearAdapters,
} from './payer-adapter.js';
import type { PayerAdapter, SubmissionInput } from './payer-adapter.js';

const fakeAdapter: PayerAdapter = {
  adapterType: 'test_adapter',
  checkReadiness: async () => ({ ready: true, missingFields: [], warnings: [] }),
  submit: async () => ({ success: true, submissionId: 'sub-1' }),
};

describe('payer-adapter registry', () => {
  beforeEach(() => {
    clearAdapters();
  });

  it('registers and retrieves an adapter by type', () => {
    registerAdapter('test_adapter', fakeAdapter);
    expect(getAdapter('test_adapter')).toBe(fakeAdapter);
  });

  it('returns undefined for unknown adapter type', () => {
    expect(getAdapter('nonexistent')).toBeUndefined();
  });

  it('lists all registered adapter types', () => {
    registerAdapter('adapter_a', fakeAdapter);
    registerAdapter('adapter_b', { ...fakeAdapter, adapterType: 'adapter_b' });
    expect(listAdapterTypes()).toEqual(['adapter_a', 'adapter_b']);
  });

  it('overwrites an adapter when re-registering same type', () => {
    const adapter2: PayerAdapter = {
      ...fakeAdapter,
      adapterType: 'test_adapter',
      submit: async () => ({ success: false, error: 'replaced' }),
    };
    registerAdapter('test_adapter', fakeAdapter);
    registerAdapter('test_adapter', adapter2);
    expect(getAdapter('test_adapter')).toBe(adapter2);
  });

  it('clearAdapters removes all registered adapters', () => {
    registerAdapter('a', fakeAdapter);
    registerAdapter('b', fakeAdapter);
    clearAdapters();
    expect(listAdapterTypes()).toEqual([]);
  });
});

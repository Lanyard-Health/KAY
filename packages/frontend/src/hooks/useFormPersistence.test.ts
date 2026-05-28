import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFormPersistence } from './useFormPersistence';

describe('useFormPersistence', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('persists state to sessionStorage on change', () => {
    const { result } = renderHook(() =>
      useFormPersistence('test-key', { a: '', b: '' })
    );

    act(() => {
      result.current[1]({ a: 'hello', b: 'world' });
    });

    const raw = sessionStorage.getItem('form:test-key');
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.value).toEqual({ a: 'hello', b: 'world' });
    expect(typeof parsed.savedAt).toBe('number');
  });

  it('restores state from sessionStorage on mount', () => {
    sessionStorage.setItem(
      'form:test-key',
      JSON.stringify({ value: { a: 'restored', b: 'data' }, savedAt: Date.now() })
    );

    const { result } = renderHook(() =>
      useFormPersistence('test-key', { a: '', b: '' })
    );

    expect(result.current[0]).toEqual({ a: 'restored', b: 'data' });
  });

  it('excludes specified keys from sessionStorage but keeps them in React state', () => {
    const { result } = renderHook(() =>
      useFormPersistence(
        'signup',
        { email: '', password: '' },
        { exclude: ['password'] }
      )
    );

    act(() => {
      result.current[1]({ email: 'a@b.com', password: 'secret-123' });
    });

    // React state has the password
    expect(result.current[0].password).toBe('secret-123');

    // But sessionStorage does NOT
    const raw = sessionStorage.getItem('form:signup');
    expect(raw).toBeTruthy();
    expect(raw).not.toContain('secret-123');
    expect(raw).not.toContain('password');

    const parsed = JSON.parse(raw!);
    expect(parsed.value).toEqual({ email: 'a@b.com' });
    expect(parsed.value).not.toHaveProperty('password');
  });

  it('treats expired sessionStorage entries as missing', () => {
    sessionStorage.setItem(
      'form:test-key',
      JSON.stringify({
        value: { a: 'expired' },
        savedAt: Date.now() - 25 * 60 * 60 * 1000, // 25h ago, past default 24h TTL
      })
    );

    const { result } = renderHook(() =>
      useFormPersistence('test-key', { a: 'initial' })
    );

    expect(result.current[0]).toEqual({ a: 'initial' });
    // Expired data was wiped; the hook's mount effect then writes a fresh
    // envelope holding the initial value. So the slot is non-null but contains
    // the initial state, not the expired 'a: expired' string.
    const raw = sessionStorage.getItem('form:test-key');
    expect(raw).toBeTruthy();
    expect(raw).not.toContain('expired');
    expect(JSON.parse(raw!).value).toEqual({ a: 'initial' });
  });

  it('clear() removes the persisted value', () => {
    const { result } = renderHook(() =>
      useFormPersistence('test-key', { a: '' })
    );

    act(() => {
      result.current[1]({ a: 'something' });
    });
    expect(sessionStorage.getItem('form:test-key')).toBeTruthy();

    act(() => {
      result.current[2]();
    });
    expect(sessionStorage.getItem('form:test-key')).toBeNull();
  });

  it('respects custom ttlMs', () => {
    sessionStorage.setItem(
      'form:short-ttl',
      JSON.stringify({
        value: { a: 'old' },
        savedAt: Date.now() - 2000, // 2 seconds ago
      })
    );

    const { result } = renderHook(() =>
      useFormPersistence('short-ttl', { a: 'fresh' }, { ttlMs: 1000 })
    );

    // 2s ago > 1s TTL, so falls back to initial
    expect(result.current[0]).toEqual({ a: 'fresh' });
  });
});

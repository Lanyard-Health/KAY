import { describe, it, expect } from 'vitest';
import { brokenFunction } from '../lint-fail-test.js';

describe('CI bug monitor test', () => {
  it('intentionally fails to trigger Linear reporting', () => {
    expect(brokenFunction()).toBe('correct value');
  });
});

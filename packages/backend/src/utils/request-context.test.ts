import { describe, it, expect } from 'vitest';
import { runWithRequestContext, getRequestId } from './request-context.js';

describe('request-context', () => {
  it('returns undefined outside any request context', () => {
    expect(getRequestId()).toBeUndefined();
  });

  it('exposes the requestId inside the context, including across awaits', async () => {
    await runWithRequestContext({ requestId: 'req-abc' }, async () => {
      expect(getRequestId()).toBe('req-abc');
      await Promise.resolve();
      expect(getRequestId()).toBe('req-abc'); // survives the await boundary
    });
  });

  it('isolates concurrent contexts from each other', async () => {
    const seen: string[] = [];
    await Promise.all([
      runWithRequestContext({ requestId: 'A' }, async () => {
        await new Promise((r) => setTimeout(r, 5));
        seen.push(getRequestId()!);
      }),
      runWithRequestContext({ requestId: 'B' }, async () => {
        seen.push(getRequestId()!);
      }),
    ]);
    expect(seen.sort()).toEqual(['A', 'B']);
  });

  it('reverts to undefined after the context closes', () => {
    runWithRequestContext({ requestId: 'tmp' }, () => {
      expect(getRequestId()).toBe('tmp');
    });
    expect(getRequestId()).toBeUndefined();
  });
});

import { describe, it, expect } from 'vitest';
import { __test_scrubEvent as scrubEvent } from './sentry.js';

describe('sentry scrubEvent', () => {
  it('drops authorization / cookie / x-dev-role headers', () => {
    const event = {
      request: {
        headers: {
          authorization: 'Bearer secret',
          cookie: 'session=abc',
          'x-dev-role': 'admin',
          'user-agent': 'jest',
        },
      },
    } as any;
    scrubEvent(event);
    expect(event.request.headers.authorization).toBeUndefined();
    expect(event.request.headers.cookie).toBeUndefined();
    expect(event.request.headers['x-dev-role']).toBeUndefined();
    expect(event.request.headers['user-agent']).toBe('jest');
  });

  it('redacts sensitive keys in request.data', () => {
    const event = {
      request: {
        data: { password: 'p', ssn: '123-45-6789', name: 'Alice' },
      },
    } as any;
    scrubEvent(event);
    expect(event.request.data.password).toBe('[REDACTED]');
    expect(event.request.data.ssn).toBe('[REDACTED]');
    expect(event.request.data.name).toBe('Alice');
  });

  it('redacts 9-digit IDs and emails in error messages', () => {
    const event = {
      message: 'Failed for provider npi=1234567890 and alice@example.com',
      exception: {
        values: [{ value: 'Error: record 999888777 not found' }],
      },
    } as any;
    scrubEvent(event);
    expect(event.message).toContain('[REDACTED-ID]');
    expect(event.message).toContain('[REDACTED-EMAIL]');
    expect(event.exception.values[0].value).toContain('[REDACTED-ID]');
  });

  it('recursively scrubs nested extras and breadcrumbs', () => {
    const event = {
      extra: {
        context: {
          user: { taxId: '12-3456789', email: 'x@y.com' },
          items: [{ accountNumber: '111222333' }],
        },
      },
      breadcrumbs: [
        { message: 'POST /login with ssn=123-45-6789', data: { password: 'x' } },
      ],
    } as any;
    scrubEvent(event);
    expect(event.extra.context.user.taxId).toBe('[REDACTED]');
    expect(event.extra.context.user.email).toBe('[REDACTED-EMAIL]');
    expect(event.extra.context.items[0].accountNumber).toBe('[REDACTED]');
    expect(event.breadcrumbs[0].message).toContain('[REDACTED-SSN]');
    expect(event.breadcrumbs[0].data.password).toBe('[REDACTED]');
  });
});

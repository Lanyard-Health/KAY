/**
 * TEMPORARY debug route for verifying Sentry PII scrubbing in production.
 * Remove after verification. Gated by SENTRY_TEST_TOKEN env var.
 */
import { Router } from 'express';
import * as Sentry from '@sentry/node';

export const debugSentryRoutes = Router();

debugSentryRoutes.post('/sentry-pii-test', (req, res) => {
  const expected = process.env['SENTRY_TEST_TOKEN'];
  const provided = req.query['token'];
  if (!expected || provided !== expected) {
    return res.status(404).json({ error: 'Not found' });
  }

  Sentry.addBreadcrumb({
    message: 'User POST /login with ssn=123-45-6789 email=breadcrumb@example.com',
    data: { password: 'hunter2', taxId: '987654321' },
  });

  Sentry.setExtra('payload', {
    provider: { ssn: '123-45-6789', taxId: '987654321', email: 'extra@example.com' },
    banking: { accountNumber: '111222333', routingNumber: '444555666' },
  });

  throw new Error(
    'PII-scrubbing verification error: npi=1234567890, ssn=123-45-6789, contact alice@example.com'
  );
});

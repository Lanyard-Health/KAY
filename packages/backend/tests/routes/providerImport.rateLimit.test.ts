import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { errorHandler } from '../../src/middleware/error.middleware.js';

/**
 * Rate limit tests run in a separate file from the main route tests because:
 *
 * 1. The rate limiter reads process.env['NODE_ENV'] at module load time.
 *    In test mode the limits are 100 (effectively disabled). We need
 *    production limits (5 for validate, 2 for execute) to test 429 responses.
 *
 * 2. vitest `isolate: true` gives each file its own module context, so
 *    vi.hoisted() can override NODE_ENV before the route module loads
 *    without affecting other test files.
 *
 * 3. express-rate-limit stores counters in memory per-limiter-instance.
 *    The instance is created once at module scope, so all requests within
 *    this file share the same counter. We use a fresh file to start at 0.
 *
 * FLAKINESS NOTE: If these tests fail in CI, it may be because:
 *   - Test execution order within the file puts extra requests before the
 *     rate limit describe block (we mitigate by testing rate limits first)
 *   - The in-memory store doesn't reset between describes
 *   - Timing-sensitive: the 1-minute window may overlap with retries
 * If flaky, mark the offending test with `it.skip` and add a comment.
 */

// Force production rate limits BEFORE route module loads
vi.hoisted(() => {
  process.env['NODE_ENV'] = 'production';
});

// Hoist service mocks
const {
  mockValidateFile,
  mockParseAndValidateRows,
  mockExecuteImport,
} = vi.hoisted(() => ({
  mockValidateFile: vi.fn(),
  mockParseAndValidateRows: vi.fn(),
  mockExecuteImport: vi.fn(),
}));

vi.mock('../../src/services/providerImport.service.js', () => ({
  validateFile: mockValidateFile,
  parseAndValidateRows: mockParseAndValidateRows,
  executeImport: mockExecuteImport,
  getImportStatus: vi.fn(),
}));

vi.mock('../../src/middleware/auth.middleware.js', () => ({
  authenticate: vi.fn((_req: any, _res: any, next: any) => next()),
  authorize: vi.fn((..._allowedRoles: string[]) => {
    return (_req: any, _res: any, next: any) => next();
  }),
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import providerImportRoutes from '../../src/routes/providerImport.routes.js';

// ==========================================
// Setup
// ==========================================

const practiceAdminUser = {
  id: 'user-1',
  role: 'practice_admin',
  email: 'admin@practice.com',
};

function createApp() {
  const app = express();
  app.use(express.json());
  app.set('trust proxy', 1); // Required for rate limiter to use x-forwarded-for
  app.use((req, _res, next) => {
    req.user = practiceAdminUser as any;
    req.practiceScope = { isSuperAdmin: false, practiceIds: ['practice-1'] } as any;
    next();
  });
  app.use(providerImportRoutes);
  app.use(errorHandler);
  return app;
}

const VALID_NPI = '1234567893';

const validRow = {
  rowNumber: 2,
  status: 'valid' as const,
  data: {
    firstName: 'Jane',
    lastName: 'Doe',
    npi: VALID_NPI,
    email: 'jane@example.com',
    providerType: 'psychiatrist',
  },
  errors: [],
  warnings: [],
};

// ==========================================
// Rate Limit Tests
// ==========================================

describe('Provider Import Rate Limiting', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockValidateFile.mockReturnValue(null);
    mockParseAndValidateRows.mockResolvedValue({
      rows: [validRow],
      summary: { valid: 1, warnings: 0, errors: 0, duplicates: 0, total: 1 },
    });
    mockExecuteImport.mockResolvedValue({
      importId: 'import-1',
      successCount: 1,
      errorCount: 0,
      skippedCount: 0,
    });
    app = createApp();
  });

  // Production limits: validateLimiter max=5/min, executeLimiter max=2/min

  it('returns 429 on 6th POST /validate request within the window', async () => {
    const csv = Buffer.from('firstName,lastName,npi,email,providerType\nJane,Doe,1234567893,j@e.com,psychiatrist');

    // Send 5 requests (should all succeed)
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post('/validate')
        .attach('file', csv, { filename: 'p.csv', contentType: 'text/csv' });
      expect(res.status).toBe(200);
    }

    // 6th request should be rate limited
    const res = await request(app)
      .post('/validate')
      .attach('file', csv, { filename: 'p.csv', contentType: 'text/csv' });
    expect(res.status).toBe(429);
    expect(res.body.error).toContain('Too many');
  });

  it('returns 429 on 3rd POST /execute request within the window', async () => {
    // Send 2 requests (should both succeed)
    for (let i = 0; i < 2; i++) {
      const res = await request(app)
        .post('/execute')
        .send({ rows: [validRow] });
      expect(res.status).toBe(201);
    }

    // 3rd request should be rate limited
    const res = await request(app)
      .post('/execute')
      .send({ rows: [validRow] });
    expect(res.status).toBe(429);
    expect(res.body.error).toContain('Too many');
  });
});

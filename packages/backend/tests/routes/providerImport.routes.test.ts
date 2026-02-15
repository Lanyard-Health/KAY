import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { errorHandler } from '../../src/middleware/error.middleware.js';

// Hoist service mocks
const {
  mockValidateFile,
  mockParseAndValidateRows,
  mockExecuteImport,
  mockGetImportStatus,
} = vi.hoisted(() => ({
  mockValidateFile: vi.fn(),
  mockParseAndValidateRows: vi.fn(),
  mockExecuteImport: vi.fn(),
  mockGetImportStatus: vi.fn(),
}));

vi.mock('../../src/services/providerImport.service.js', () => ({
  validateFile: mockValidateFile,
  parseAndValidateRows: mockParseAndValidateRows,
  executeImport: mockExecuteImport,
  getImportStatus: mockGetImportStatus,
}));

// Mock auth — authenticate passes through, authorize checks role
const { mockAuthenticate } = vi.hoisted(() => ({
  mockAuthenticate: vi.fn((_req: any, _res: any, next: any) => next()),
}));

vi.mock('../../src/middleware/auth.middleware.js', () => ({
  authenticate: mockAuthenticate,
  authorize: vi.fn((...allowedRoles: string[]) => {
    return (req: any, res: any, next: any) => {
      if (!req.user || !allowedRoles.includes(req.user.role)) {
        res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Insufficient permissions' },
        });
        return;
      }
      next();
    };
  }),
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import providerImportRoutes from '../../src/routes/providerImport.routes.js';

// ==========================================
// Test helpers
// ==========================================

const practiceAdminUser = {
  id: 'user-1',
  role: 'practice_admin',
  email: 'admin@practice.com',
};

function createApp(
  user: Record<string, unknown> | null = practiceAdminUser,
  practiceIds: string[] = ['practice-1'],
) {
  const app = express();
  app.use(express.json());

  // Inject user + practiceScope before routes (null user simulates no auth)
  if (user) {
    app.use((req, _res, next) => {
      req.user = user as any;
      req.practiceScope = { isSuperAdmin: false, practiceIds };
      next();
    });
  }

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

const warningRow = {
  rowNumber: 3,
  status: 'warning' as const,
  data: {
    firstName: 'John',
    lastName: 'Smith',
    npi: '1245319599',
    email: 'john@example.com',
    providerType: 'psychologist',
  },
  errors: [],
  warnings: [{ field: 'licenseExpiration', message: 'License is expired' }],
};

const REQUIRED_HEADERS = 'firstName,lastName,npi,email,providerType';

function makeCsv(rows: string[] = []): string {
  return [REQUIRED_HEADERS, ...rows].join('\n');
}

// ==========================================
// Tests
// ==========================================

describe('Provider Import Routes', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Restore default authenticate behavior (pass-through)
    mockAuthenticate.mockImplementation((_req: any, _res: any, next: any) => next());
    app = createApp();
  });

  // ========================================
  // Authorization (cross-cutting)
  // ========================================

  describe('Authorization', () => {
    it('allows practice_admin role on all endpoints', async () => {
      // Template
      const templateRes = await request(app).get('/template');
      expect(templateRes.status).toBe(200);

      // Validate
      mockValidateFile.mockReturnValue(null);
      mockParseAndValidateRows.mockResolvedValue({
        rows: [validRow],
        summary: { valid: 1, warnings: 0, errors: 0, duplicates: 0, total: 1 },
      });
      const validateRes = await request(app)
        .post('/validate')
        .attach('file', Buffer.from(makeCsv(['Jane,Doe,1234567893,j@e.com,psychiatrist'])), {
          filename: 'p.csv', contentType: 'text/csv',
        });
      expect(validateRes.status).toBe(200);

      // Execute
      mockExecuteImport.mockResolvedValue({
        importId: 'import-1', successCount: 1, errorCount: 0, skippedCount: 0,
      });
      const executeRes = await request(app).post('/execute').send({ rows: [validRow] });
      expect(executeRes.status).toBe(201);

      // Status
      mockGetImportStatus.mockResolvedValue({ id: 'import-1', status: 'completed' });
      const statusRes = await request(app).get('/import-1/status');
      expect(statusRes.status).toBe(200);
    });

    it('returns 403 for credentialing_staff on all endpoints', async () => {
      const staffApp = createApp({ id: 'u-2', role: 'credentialing_staff', email: 's@test.com' });

      const templateRes = await request(staffApp).get('/template');
      expect(templateRes.status).toBe(403);

      const validateRes = await request(staffApp)
        .post('/validate')
        .attach('file', Buffer.from('a'), { filename: 't.csv', contentType: 'text/csv' });
      expect(validateRes.status).toBe(403);

      const executeRes = await request(staffApp).post('/execute').send({ rows: [validRow] });
      expect(executeRes.status).toBe(403);

      const statusRes = await request(staffApp).get('/import-1/status');
      expect(statusRes.status).toBe(403);
    });

    it('returns 401 when no auth token is provided', async () => {
      // Override authenticate to simulate missing/invalid token
      mockAuthenticate.mockImplementation((_req: any, res: any) => {
        res.status(401).json({ success: false, error: 'Authentication required' });
      });

      const unauthApp = createApp(null);

      const templateRes = await request(unauthApp).get('/template');
      expect(templateRes.status).toBe(401);

      const validateRes = await request(unauthApp).post('/validate');
      expect(validateRes.status).toBe(401);

      const executeRes = await request(unauthApp).post('/execute').send({ rows: [validRow] });
      expect(executeRes.status).toBe(401);

      const statusRes = await request(unauthApp).get('/import-1/status');
      expect(statusRes.status).toBe(401);
    });

    it('returns 404 when practice_admin queries import from another practice', async () => {
      // User is scoped to practice-A, import belongs to practice-B
      const practiceAApp = createApp(
        { id: 'user-a', role: 'practice_admin', email: 'a@test.com' },
        ['practice-A'],
      );

      // Service returns null because import doesn't belong to practice-A
      mockGetImportStatus.mockResolvedValue(null);

      const res = await request(practiceAApp).get('/import-from-practice-B/status');

      expect(res.status).toBe(404);
      // Verify service was called with the user's practice, not the import's practice
      expect(mockGetImportStatus).toHaveBeenCalledWith('import-from-practice-B', 'practice-A');
    });
  });

  // ========================================
  // GET /template
  // ========================================

  describe('GET /template', () => {
    it('returns CSV with correct Content-Type and Content-Disposition', async () => {
      const res = await request(app).get('/template');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toContain(
        'filename="lanyard-provider-import-template.csv"',
      );
    });

    it('response body contains all expected CSV headers', async () => {
      const res = await request(app).get('/template');

      const lines = res.text.split('\n');
      const headers = lines[0]!;
      // Required headers
      expect(headers).toContain('firstName');
      expect(headers).toContain('lastName');
      expect(headers).toContain('npi');
      expect(headers).toContain('email');
      expect(headers).toContain('providerType');
      // Optional headers
      expect(headers).toContain('phone');
      expect(headers).toContain('licenseNumber');
      expect(headers).toContain('licenseState');
      expect(headers).toContain('licenseExpiration');
      expect(headers).toContain('taxonomyCode');

      // Example data row exists
      expect(lines[1]).toContain('Jane');
      expect(lines[1]).toContain('1234567893');
    });

    it('returns 403 for provider role', async () => {
      const providerApp = createApp({ id: 'u-2', role: 'provider', email: 'p@test.com' });
      const res = await request(providerApp).get('/template');
      expect(res.status).toBe(403);
    });
  });

  // ========================================
  // POST /validate
  // ========================================

  describe('POST /validate', () => {
    it('returns 200 with validation results in expected shape', async () => {
      const mockResult = {
        rows: [
          validRow,
          warningRow,
          {
            rowNumber: 4,
            status: 'error',
            data: { firstName: '', lastName: 'Bad', npi: '123', email: 'bad', providerType: 'x' },
            errors: [{ field: 'firstName', message: 'First name is required' }],
            warnings: [],
          },
          {
            rowNumber: 5,
            status: 'duplicate',
            data: { firstName: 'Dup', lastName: 'Row', npi: '1234567893', email: 'd@e.com', providerType: 'lcsw' },
            errors: [],
            warnings: [{ field: 'npi', message: 'Provider already exists' }],
          },
        ],
        summary: { valid: 1, warnings: 1, errors: 1, duplicates: 1, total: 4 },
      };

      mockValidateFile.mockReturnValue(null);
      mockParseAndValidateRows.mockResolvedValue(mockResult);

      const csv = makeCsv([`Jane,Doe,${VALID_NPI},jane@example.com,psychiatrist`]);
      const res = await request(app)
        .post('/validate')
        .attach('file', Buffer.from(csv), {
          filename: 'providers.csv',
          contentType: 'text/csv',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Rows array shape
      const rows = res.body.data.rows;
      expect(rows).toHaveLength(4);
      for (const row of rows) {
        expect(row).toHaveProperty('rowNumber');
        expect(row).toHaveProperty('status');
        expect(row).toHaveProperty('data');
        expect(row).toHaveProperty('errors');
        expect(row).toHaveProperty('warnings');
        expect(typeof row.rowNumber).toBe('number');
        expect(['valid', 'warning', 'error', 'duplicate']).toContain(row.status);
        expect(Array.isArray(row.errors)).toBe(true);
        expect(Array.isArray(row.warnings)).toBe(true);
      }

      // Summary shape
      const summary = res.body.data.summary;
      expect(summary.valid).toBe(1);
      expect(summary.warnings).toBe(1);
      expect(summary.errors).toBe(1);
      expect(summary.duplicates).toBe(1);
      expect(summary.total).toBe(4);
    });

    it('passes CSV content and practiceId to service', async () => {
      mockValidateFile.mockReturnValue(null);
      mockParseAndValidateRows.mockResolvedValue({
        rows: [validRow],
        summary: { valid: 1, warnings: 0, errors: 0, duplicates: 0, total: 1 },
      });

      const csv = makeCsv([`Jane,Doe,${VALID_NPI},jane@example.com,psychiatrist`]);
      await request(app)
        .post('/validate')
        .attach('file', Buffer.from(csv), {
          filename: 'providers.csv',
          contentType: 'text/csv',
        });

      expect(mockValidateFile).toHaveBeenCalledWith(
        expect.objectContaining({
          originalname: 'providers.csv',
          mimetype: 'text/csv',
        }),
      );
      expect(mockParseAndValidateRows).toHaveBeenCalledWith(
        expect.any(String),
        'practice-1',
      );
    });

    it('returns 400 when no file is uploaded', async () => {
      const res = await request(app).post('/validate');

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('No file uploaded');
    });

    it('returns 400 with error code when file is not CSV', async () => {
      mockValidateFile.mockReturnValue({
        code: 'INVALID_FILE_TYPE',
        message: 'File must be a .csv file',
      });

      const res = await request(app)
        .post('/validate')
        .attach('file', Buffer.from('not csv'), {
          filename: 'data.xlsx',
          contentType: 'application/vnd.ms-excel',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_FILE_TYPE');
      expect(res.body.error.message).toContain('File must be a .csv file');
    });

    it('returns 400 when user has no practice', async () => {
      const noPracticeApp = createApp(practiceAdminUser, []);

      const res = await request(noPracticeApp)
        .post('/validate')
        .attach('file', Buffer.from('a,b'), {
          filename: 'test.csv',
          contentType: 'text/csv',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('No practice');
    });

    it('returns 403 for credentialing_staff role', async () => {
      const staffApp = createApp({ id: 'u-2', role: 'credentialing_staff', email: 's@test.com' });
      const res = await request(staffApp)
        .post('/validate')
        .attach('file', Buffer.from('a'), { filename: 't.csv', contentType: 'text/csv' });

      expect(res.status).toBe(403);
    });
  });

  // ========================================
  // POST /execute
  // ========================================

  describe('POST /execute', () => {
    it('creates providers and returns 201 with importId', async () => {
      mockExecuteImport.mockResolvedValue({
        importId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        successCount: 1,
        errorCount: 0,
        skippedCount: 0,
      });

      const res = await request(app)
        .post('/execute')
        .send({ rows: [validRow] });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.importId).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
      expect(res.body.data.successCount).toBe(1);
      expect(res.body.data.errorCount).toBe(0);
      expect(res.body.data.skippedCount).toBe(0);
    });

    it('accepts rows with warning status', async () => {
      mockExecuteImport.mockResolvedValue({
        importId: 'import-2',
        successCount: 2,
        errorCount: 0,
        skippedCount: 0,
      });

      const res = await request(app)
        .post('/execute')
        .send({ rows: [validRow, warningRow] });

      expect(res.status).toBe(201);
      expect(res.body.data.successCount).toBe(2);
      expect(mockExecuteImport).toHaveBeenCalledWith(
        'practice-1',
        'user-1',
        [validRow, warningRow],
      );
    });

    it('returns 400 for empty rows array', async () => {
      const res = await request(app)
        .post('/execute')
        .send({ rows: [] });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed');
    });

    it('returns 400 for missing required data fields', async () => {
      const res = await request(app)
        .post('/execute')
        .send({
          rows: [{
            rowNumber: 2,
            status: 'valid',
            data: { firstName: 'Jane' }, // missing lastName, npi, email, providerType
            errors: [],
            warnings: [],
          }],
        });

      expect(res.status).toBe(400);
    });

    it('returns 400 for rows with error status', async () => {
      const res = await request(app)
        .post('/execute')
        .send({
          rows: [{
            ...validRow,
            status: 'error',
          }],
        });

      expect(res.status).toBe(400);
    });

    it('returns 400 for rows with duplicate status', async () => {
      const res = await request(app)
        .post('/execute')
        .send({
          rows: [{
            ...validRow,
            status: 'duplicate',
          }],
        });

      expect(res.status).toBe(400);
    });

    it('returns 422 when import execution fails', async () => {
      mockExecuteImport.mockResolvedValue({
        importId: 'import-1',
        successCount: 0,
        errorCount: 1,
        skippedCount: 0,
        error: 'Unique constraint violation on npi',
      });

      const res = await request(app)
        .post('/execute')
        .send({ rows: [validRow] });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.data.error).toContain('Unique constraint');
    });

    it('returns 400 when user has no practice', async () => {
      const noPracticeApp = createApp(practiceAdminUser, []);
      const res = await request(noPracticeApp)
        .post('/execute')
        .send({ rows: [validRow] });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('No practice');
    });

    it('returns 403 for provider role', async () => {
      const providerApp = createApp({ id: 'u-2', role: 'provider', email: 'p@test.com' });
      const res = await request(providerApp)
        .post('/execute')
        .send({ rows: [validRow] });

      expect(res.status).toBe(403);
    });
  });

  // ========================================
  // GET /:importId/status
  // ========================================

  describe('GET /:importId/status', () => {
    const mockImport = {
      id: 'import-1',
      practiceId: 'practice-1',
      status: 'completed',
      totalRows: 5,
      successCount: 5,
      errorCount: 0,
      skippedCount: 0,
      errorDetails: null,
      createdBy: 'user-1',
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };

    it('returns 200 with full import record for valid importId', async () => {
      mockGetImportStatus.mockResolvedValue(mockImport);

      const res = await request(app).get('/import-1/status');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe('import-1');
      expect(res.body.data.status).toBe('completed');
      expect(res.body.data.totalRows).toBe(5);
      expect(res.body.data.successCount).toBe(5);
      expect(res.body.data.errorCount).toBe(0);

      expect(mockGetImportStatus).toHaveBeenCalledWith('import-1', 'practice-1');
    });

    it('returns 404 when importId belongs to a different practice', async () => {
      // Import exists but for practice-B, not the user's practice-1
      mockGetImportStatus.mockResolvedValue(null);

      const res = await request(app).get('/import-from-practice-B/status');

      expect(res.status).toBe(404);
    });

    it('returns 404 for non-existent importId', async () => {
      mockGetImportStatus.mockResolvedValue(null);

      const res = await request(app).get('/nonexistent-id/status');

      expect(res.status).toBe(404);
    });

    it('returns 400 when user has no practice', async () => {
      const noPracticeApp = createApp(practiceAdminUser, []);
      const res = await request(noPracticeApp).get('/import-1/status');

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('No practice');
    });

    it('returns 403 for provider role', async () => {
      const providerApp = createApp({ id: 'u-2', role: 'provider', email: 'p@test.com' });
      const res = await request(providerApp).get('/import-1/status');

      expect(res.status).toBe(403);
    });
  });
});

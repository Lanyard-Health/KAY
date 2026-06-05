import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../../tests/helpers/test-app.js';
import { practiceAdminUser } from '../../tests/helpers/fixtures.js';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock, prismaBase: prismaMock };
});

vi.mock('../middleware/auth.middleware.js', () => ({
  authenticate: vi.fn((_req: any, _res: any, next: any) => next()),
  authorize: vi.fn(() => (_req: any, _res: any, next: any) => next()),
}));

vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../services/providerImport.service.js', () => ({
  validateFile: vi.fn(),
  parseAndValidateRows: vi.fn(),
  executeImport: vi.fn(),
  getImportStatus: vi.fn(),
}));

import providerImportRouter from './providerImport.routes.js';
import {
  validateFile,
  parseAndValidateRows,
  executeImport,
  getImportStatus,
} from '../services/providerImport.service.js';

import express from 'express';
import { errorHandler } from '../middleware/error.middleware.js';

function createPracticeTestApp(router: any) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = practiceAdminUser as any;
    req.practiceScope = { isSuperAdmin: false, practiceIds: ['practice-1-id'] };
    next();
  });
  app.use(router);
  app.use(errorHandler);
  return app;
}

describe('Provider Import Routes', () => {
  const app = createPracticeTestApp(providerImportRouter);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================
  // GET /template
  // ==========================================

  describe('GET /template', () => {
    it('returns CSV content with correct headers and example row', async () => {
      const res = await request(app).get('/template');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/csv/);
      expect(res.headers['content-disposition']).toContain(
        'lanyard-provider-import-template.csv',
      );

      const lines = res.text.split('\n');
      expect(lines).toHaveLength(2);
      expect(lines[0]).toContain('firstName');
      expect(lines[0]).toContain('npi');
      expect(lines[0]).toContain('email');
      expect(lines[1]).toContain('Jane');
      expect(lines[1]).toContain('1234567893');
    });
  });

  // ==========================================
  // POST /execute
  // ==========================================

  describe('POST /execute', () => {
    it('returns 400 with empty body', async () => {
      const res = await request(app).post('/execute').send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Validation failed');
      expect(res.body.details).toBeDefined();
    });

    it('returns 201 on successful import execution', async () => {
      const mockResult = {
        importId: 'import-1-id',
        totalRows: 1,
        successCount: 1,
        failureCount: 0,
        error: null,
        results: [{ rowNumber: 1, status: 'created', providerId: 'prov-1' }],
      };
      vi.mocked(executeImport).mockResolvedValue(mockResult as any);

      const validBody = {
        rows: [
          {
            rowNumber: 1,
            status: 'valid' as const,
            data: {
              firstName: 'Jane',
              lastName: 'Doe',
              npi: '1234567893',
              email: 'jane.doe@example.com',
              providerType: 'psychiatrist',
            },
            errors: [],
            warnings: [],
          },
        ],
      };

      const res = await request(app).post('/execute').send(validBody);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.importId).toBe('import-1-id');
      expect(vi.mocked(executeImport)).toHaveBeenCalledWith(
        'practice-1-id',
        practiceAdminUser.id,
        validBody.rows,
      );
    });
  });

  // ==========================================
  // GET /:importId/status
  // ==========================================

  describe('GET /:importId/status', () => {
    it('returns 404 when import is not found', async () => {
      vi.mocked(getImportStatus).mockResolvedValue(null as any);

      const res = await request(app).get('/non-existent-id/status');

      expect(res.status).toBe(404);
      expect(res.body.error.message).toContain('not found');
      expect(vi.mocked(getImportStatus)).toHaveBeenCalledWith(
        'non-existent-id',
        'practice-1-id',
      );
    });

    it('returns import status when found', async () => {
      const mockStatus = {
        id: 'import-1-id',
        practiceId: 'practice-1-id',
        status: 'completed',
        totalRows: 3,
        successCount: 2,
        failureCount: 1,
        createdAt: new Date().toISOString(),
      };
      vi.mocked(getImportStatus).mockResolvedValue(mockStatus as any);

      const res = await request(app).get('/import-1-id/status');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe('import-1-id');
      expect(res.body.data.status).toBe('completed');
      expect(vi.mocked(getImportStatus)).toHaveBeenCalledWith(
        'import-1-id',
        'practice-1-id',
      );
    });
  });
});

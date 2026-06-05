import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../../tests/helpers/test-app.js';
import { adminUser } from '../../tests/helpers/fixtures.js';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock, prismaBase: prismaMock };
});

vi.mock('../middleware/auth.middleware.js', () => ({
  authenticate: vi.fn((_req: any, _res: any, next: any) => next()),
  authorize: vi.fn(() => (_req: any, _res: any, next: any) => next()),
}));

vi.mock('../middleware/practiceScope.middleware.js', () => ({
  validateProviderPracticeAccess: vi.fn().mockResolvedValue(true),
  getPracticeRelationFilter: vi.fn(() => ({})),
}));

vi.mock('../services/email.service.js', () => ({
  emailService: {
    getConfig: vi.fn(),
    isConfigured: vi.fn(),
    verifyConnection: vi.fn(),
    sendTestEmail: vi.fn(),
  },
}));

vi.mock('../services/followup.service.js', () => ({
  followUpService: {
    getEnrollmentEmailData: vi.fn(),
    generateProfessionalEmail: vi.fn(),
    sendCustomFollowUp: vi.fn(),
    configureFollowUp: vi.fn(),
    getEnrollmentsDueForFollowUp: vi.fn(),
  },
}));

vi.mock('../services/scheduler.service.js', () => ({
  schedulerService: {
    getStatus: vi.fn(),
    runFollowUpJob: vi.fn(),
  },
}));

vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import followUpRoutes from './followup.routes.js';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import { emailService } from '../services/email.service.js';
import { followUpService } from '../services/followup.service.js';
import { schedulerService } from '../services/scheduler.service.js';
import { validateProviderPracticeAccess } from '../middleware/practiceScope.middleware.js';

describe('Follow-up Routes', () => {
  const app = createTestApp(followUpRoutes, adminUser);

  beforeEach(() => {
    vi.clearAllMocks();
    // Re-set after clearAllMocks: practice scope middleware must allow access
    (validateProviderPracticeAccess as any).mockResolvedValue(true);
    // Default: enrollment exists for checkEnrollmentPracticeAccess middleware
    prismaMock.enrollment.findUnique.mockResolvedValue({
      id: 'enroll-1',
      providerId: 'provider-1-id',
    } as any);
  });

  describe('GET /status', () => {
    it('returns email service status and scheduler status', async () => {
      (emailService.getConfig as any).mockReturnValue({ host: 'smtp.test.com', port: 587, user: 'user@test.com' });
      (emailService.isConfigured as any).mockReturnValue(true);
      (emailService.verifyConnection as any).mockResolvedValue({ success: true });
      (schedulerService.getStatus as any).mockReturnValue({ running: true });

      const res = await request(app).get('/status');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.email.configured).toBe(true);
      expect(res.body.data.email.connectionVerified).toBe(true);
      expect(res.body.data.scheduler.running).toBe(true);
    });

    it('masks email user in config', async () => {
      (emailService.getConfig as any).mockReturnValue({ host: 'smtp.test.com', port: 587, user: 'user@test.com' });
      (emailService.isConfigured as any).mockReturnValue(true);
      (emailService.verifyConnection as any).mockResolvedValue({ success: true });
      (schedulerService.getStatus as any).mockReturnValue({});

      const res = await request(app).get('/status');

      expect(res.body.data.email.config.user).toBe('use***');
    });
  });

  describe('POST /test-email', () => {
    it('sends a test email successfully', async () => {
      (emailService.sendTestEmail as any).mockResolvedValue({ success: true, messageId: 'msg-1' });

      const res = await request(app)
        .post('/test-email')
        .send({ email: 'test@example.com' });

      expect(res.status).toBe(200);
      expect(res.body.data.messageId).toBe('msg-1');
    });

    it('returns 400 when email is missing', async () => {
      const res = await request(app).post('/test-email').send({});

      expect(res.status).toBe(400);
    });

    it('returns 500 when email sending fails', async () => {
      (emailService.sendTestEmail as any).mockResolvedValue({ success: false, error: 'SMTP error' });

      const res = await request(app)
        .post('/test-email')
        .send({ email: 'test@example.com' });

      expect(res.status).toBe(500);
    });
  });

  describe('GET /enrollment/:id/preview', () => {
    it('returns enrollment email data', async () => {
      const mockData = { providerName: 'Dr. Smith', payerName: 'BCBS' };
      (followUpService.getEnrollmentEmailData as any).mockResolvedValue(mockData);

      const res = await request(app).get('/enrollment/enroll-1/preview');

      expect(res.status).toBe(200);
      expect(res.body.data.providerName).toBe('Dr. Smith');
    });

    it('returns 404 when enrollment not found', async () => {
      (followUpService.getEnrollmentEmailData as any).mockResolvedValue(null);

      const res = await request(app).get('/enrollment/enroll-1/preview');

      expect(res.status).toBe(404);
    });
  });

  describe('POST /enrollment/:id/preview-html', () => {
    it('generates HTML email preview', async () => {
      const mockData = { providerName: 'Dr. Smith', payerName: 'BCBS' };
      (followUpService.getEnrollmentEmailData as any).mockResolvedValue(mockData);
      (followUpService.generateProfessionalEmail as any).mockReturnValue('<html>email</html>');

      const res = await request(app)
        .post('/enrollment/enroll-1/preview-html')
        .send({ customMessage: 'Please expedite' });

      expect(res.status).toBe(200);
      expect(res.body.data.html).toBe('<html>email</html>');
      expect(res.body.data.subject).toContain('Dr. Smith');
    });
  });

  describe('POST /enrollment/:id/send', () => {
    it('sends a follow-up email', async () => {
      (followUpService.sendCustomFollowUp as any).mockResolvedValue({ success: true, messageId: 'msg-1' });

      const res = await request(app)
        .post('/enrollment/enroll-1/send')
        .send({ email: 'payer@test.com' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 400 when email is missing', async () => {
      const res = await request(app)
        .post('/enrollment/enroll-1/send')
        .send({});

      expect(res.status).toBe(400);
    });

    it('returns 400 when send fails', async () => {
      (followUpService.sendCustomFollowUp as any).mockResolvedValue({ success: false, error: 'Email not configured' });

      const res = await request(app)
        .post('/enrollment/enroll-1/send')
        .send({ email: 'payer@test.com' });

      expect(res.status).toBe(400);
    });
  });

  describe('PUT /enrollment/:id/settings', () => {
    it('configures follow-up settings', async () => {
      (followUpService.configureFollowUp as any).mockResolvedValue({ id: 'enroll-1', followUpEnabled: true });

      const res = await request(app)
        .put('/enrollment/enroll-1/settings')
        .send({ enabled: true, email: 'payer@test.com', frequencyDays: 14 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 400 when enabling without email', async () => {
      const res = await request(app)
        .put('/enrollment/enroll-1/settings')
        .send({ enabled: true });

      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid frequency', async () => {
      const res = await request(app)
        .put('/enrollment/enroll-1/settings')
        .send({ enabled: true, email: 'x@x.com', frequencyDays: 100 });

      expect(res.status).toBe(400);
    });

    it('returns 404 when enrollment not found', async () => {
      (followUpService.configureFollowUp as any).mockResolvedValue(null);

      const res = await request(app)
        .put('/enrollment/enroll-1/settings')
        .send({ enabled: false });

      expect(res.status).toBe(404);
    });
  });

  describe('GET /enrollment/:id/settings', () => {
    it('returns follow-up settings for enrollment', async () => {
      prismaMock.enrollment.findUnique.mockResolvedValue({
        id: 'enroll-1',
        followUpEnabled: true,
        followUpEmail: 'payer@test.com',
        followUpFrequencyDays: 14,
        lastFollowUpSentAt: null,
        nextFollowUpDate: null,
        lastFollowUpDate: null,
      } as any);

      const res = await request(app).get('/enrollment/enroll-1/settings');

      expect(res.status).toBe(200);
      expect(res.body.data.followUpEnabled).toBe(true);
    });
  });

  describe('GET /enrollments', () => {
    it('returns all enrollments with follow-up enabled', async () => {
      prismaMock.enrollment.findMany.mockResolvedValue([
        { id: 'enroll-1', followUpEnabled: true, provider: {}, payer: {} },
      ] as any);

      const res = await request(app).get('/enrollments');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
    });
  });

  describe('GET /due', () => {
    it('returns enrollments due for follow-up', async () => {
      (followUpService.getEnrollmentsDueForFollowUp as any).mockResolvedValue([{ id: 'enroll-1' }]);

      const res = await request(app).get('/due');

      expect(res.status).toBe(200);
      expect(res.body.count).toBe(1);
    });
  });

  describe('POST /run', () => {
    it('triggers follow-up processing', async () => {
      (schedulerService.runFollowUpJob as any).mockResolvedValue({ sent: 3, errors: 0 });

      const res = await request(app).post('/run');

      expect(res.status).toBe(200);
      expect(res.body.data.sent).toBe(3);
    });
  });

  describe('GET /enrollment/:id/history', () => {
    it('returns follow-up history', async () => {
      prismaMock.enrollment.findUnique.mockResolvedValue({
        id: 'enroll-1',
        followUpEmail: 'payer@test.com',
        provider: { firstName: 'Jane', lastName: 'Doe' },
        payer: { name: 'BCBS' },
      } as any);
      prismaMock.notification.findMany.mockResolvedValue([
        { id: 'notif-1', type: 'enrollment_follow_up' },
      ] as any);

      const res = await request(app).get('/enrollment/enroll-1/history');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
    });

    it('returns 404 when enrollment not found for history', async () => {
      prismaMock.enrollment.findUnique.mockResolvedValue(null);

      const res = await request(app).get('/enrollment/nonexistent/history');

      expect(res.status).toBe(404);
    });
  });
});

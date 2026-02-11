import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../../tests/helpers/test-app.js';
import { adminUser, providerUser } from '../../tests/helpers/fixtures.js';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

vi.mock('../middleware/auth.middleware.js', () => ({
  authenticate: vi.fn((_req: any, _res: any, next: any) => next()),
  authorize: vi.fn(() => (_req: any, _res: any, next: any) => next()),
}));

vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// Mock portal service functions — all vi.fn() inside factory
vi.mock('../services/portal.service.js', () => ({
  submitApplication: vi.fn(),
  getApplicationStatusByNpi: vi.fn(),
  getApplications: vi.fn(),
  getApplicationById: vi.fn(),
  approveApplication: vi.fn(),
  rejectApplication: vi.fn(),
  getPendingApplicationCount: vi.fn(),
  getUnreadNotificationCount: vi.fn(),
  getAdminNotifications: vi.fn(),
  markNotificationsAsRead: vi.fn(),
}));

import portalRouter from './portal.routes.js';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import {
  submitApplication,
  getApplicationStatusByNpi,
  getApplications,
  getApplicationById,
  approveApplication,
  rejectApplication,
  getPendingApplicationCount,
  getUnreadNotificationCount,
  getAdminNotifications,
  markNotificationsAsRead,
} from '../services/portal.service.js';

const mockApplication = {
  id: 'app-1-id',
  npi: '1234567890',
  firstName: 'Jane',
  lastName: 'Doe',
  email: 'jane@test.com',
  phone: '555-1234',
  status: 'pending',
  submittedAt: new Date(),
  reviewedAt: null,
  reviewedBy: null,
  reviewNotes: null,
};

const validApplicationInput = {
  npi: '1234567890',
  firstName: 'Jane',
  lastName: 'Doe',
  email: 'jane@test.com',
  phone: '555-123-4567',
  dateOfBirth: '1985-06-15',
  gender: 'female',
};

describe('Portal Routes', () => {
  // Public endpoints: no user needed
  const publicApp = createTestApp(portalRouter);
  publicApp.set('trust proxy', 1);
  // Authenticated endpoints
  const adminApp = createTestApp(portalRouter, adminUser);
  const providerApp = createTestApp(portalRouter, providerUser);

  let testIpCounter = 0;
  function nextIp() {
    return `10.0.0.${++testIpCounter}`;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================
  // PUBLIC: POST /register
  // ==========================================
  describe('POST /register', () => {
    it('creates application with 201', async () => {
      (submitApplication as any).mockResolvedValue(mockApplication);

      const res = await request(publicApp)
        .post('/register')
        .set('X-Forwarded-For', nextIp())
        .send(validApplicationInput);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe('app-1-id');
      expect(res.body.data.status).toBe('pending');
    });

    it('returns 400 for missing required fields', async () => {
      const res = await request(publicApp)
        .post('/register')
        .set('X-Forwarded-For', nextIp())
        .send({ npi: '1234567890' }); // missing firstName, lastName, email, phone

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 for invalid NPI format', async () => {
      const res = await request(publicApp)
        .post('/register')
        .set('X-Forwarded-For', nextIp())
        .send({ ...validApplicationInput, npi: '123' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 for invalid email', async () => {
      const res = await request(publicApp)
        .post('/register')
        .set('X-Forwarded-For', nextIp())
        .send({ ...validApplicationInput, email: 'not-email' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 for short names', async () => {
      const res = await request(publicApp)
        .post('/register')
        .set('X-Forwarded-For', nextIp())
        .send({ ...validApplicationInput, firstName: 'J' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 409 for duplicate NPI (already pending)', async () => {
      (submitApplication as any).mockRejectedValue(new Error('already pending'));

      const res = await request(publicApp)
        .post('/register')
        .set('X-Forwarded-For', nextIp())
        .send(validApplicationInput);

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
    });

    it('returns 409 for existing provider', async () => {
      (submitApplication as any).mockRejectedValue(new Error('already exists'));

      const res = await request(publicApp)
        .post('/register')
        .set('X-Forwarded-For', nextIp())
        .send(validApplicationInput);

      expect(res.status).toBe(409);
    });
  });

  // ==========================================
  // PUBLIC: GET /status/:npi
  // ==========================================
  describe('GET /status/:npi', () => {
    it('returns application status', async () => {
      (getApplicationStatusByNpi as any).mockResolvedValue({
        id: 'app-1-id',
        status: 'pending',
        submittedAt: new Date(),
      });

      const res = await request(publicApp).get('/status/1234567890').set('X-Forwarded-For', nextIp());

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('pending');
    });

    it('returns 404 when no application found', async () => {
      (getApplicationStatusByNpi as any).mockResolvedValue(null);

      const res = await request(publicApp).get('/status/9999999999').set('X-Forwarded-For', nextIp());

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 for invalid NPI', async () => {
      const res = await request(publicApp).get('/status/123').set('X-Forwarded-For', nextIp());

      expect(res.status).toBe(400);
    });
  });

  // ==========================================
  // ADMIN: GET /admin/applications
  // ==========================================
  describe('GET /admin/applications', () => {
    it('returns applications list with pending count', async () => {
      (getApplications as any).mockResolvedValue([mockApplication]);
      (getPendingApplicationCount as any).mockResolvedValue(1);

      const res = await request(adminApp).get('/admin/applications');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.applications).toHaveLength(1);
      expect(res.body.data.pendingCount).toBe(1);
      expect(res.body.data.total).toBe(1);
    });

    it('filters by status query param', async () => {
      (getApplications as any).mockResolvedValue([]);
      (getPendingApplicationCount as any).mockResolvedValue(0);

      await request(adminApp).get('/admin/applications?status=approved');

      expect(getApplications).toHaveBeenCalledWith('approved');
    });

    it('returns 400 for invalid status', async () => {
      const res = await request(adminApp).get('/admin/applications?status=invalid');

      expect(res.status).toBe(400);
    });
  });

  // ==========================================
  // ADMIN: GET /admin/applications/:id
  // ==========================================
  describe('GET /admin/applications/:id', () => {
    it('returns single application', async () => {
      (getApplicationById as any).mockResolvedValue(mockApplication);

      const res = await request(adminApp).get('/admin/applications/app-1-id');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe('app-1-id');
    });

    it('returns 404 when not found', async () => {
      (getApplicationById as any).mockResolvedValue(null);

      const res = await request(adminApp).get('/admin/applications/nonexistent');

      expect(res.status).toBe(404);
    });
  });

  // ==========================================
  // ADMIN: POST /admin/applications/:id/approve
  // ==========================================
  describe('POST /admin/applications/:id/approve', () => {
    it('approves an application', async () => {
      (approveApplication as any).mockResolvedValue({
        ...mockApplication,
        status: 'approved',
      });

      const res = await request(adminApp)
        .post('/admin/applications/app-1-id/approve')
        .send({ notes: 'Looks good' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Application approved');
      expect(approveApplication).toHaveBeenCalledWith('app-1-id', 'admin@test.com', 'Looks good');
    });

    it('returns 404 when not found', async () => {
      (approveApplication as any).mockRejectedValue(new Error('Application not found'));

      const res = await request(adminApp).post('/admin/applications/bad-id/approve');

      expect(res.status).toBe(404);
    });

    it('returns 409 when already reviewed', async () => {
      (approveApplication as any).mockRejectedValue(new Error('already been reviewed'));

      const res = await request(adminApp).post('/admin/applications/app-1-id/approve');

      expect(res.status).toBe(409);
    });
  });

  // ==========================================
  // ADMIN: POST /admin/applications/:id/reject
  // ==========================================
  describe('POST /admin/applications/:id/reject', () => {
    it('rejects an application with notes', async () => {
      (rejectApplication as any).mockResolvedValue({
        ...mockApplication,
        status: 'rejected',
      });

      const res = await request(adminApp)
        .post('/admin/applications/app-1-id/reject')
        .send({ notes: 'Incomplete information' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Application rejected');
    });

    it('returns 400 when notes missing', async () => {
      const res = await request(adminApp)
        .post('/admin/applications/app-1-id/reject')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('notes are required');
    });

    it('returns 400 for empty notes', async () => {
      const res = await request(adminApp)
        .post('/admin/applications/app-1-id/reject')
        .send({ notes: '  ' });

      expect(res.status).toBe(400);
    });

    it('returns 404 when not found', async () => {
      (rejectApplication as any).mockRejectedValue(new Error('Application not found'));

      const res = await request(adminApp)
        .post('/admin/applications/bad-id/reject')
        .send({ notes: 'Not found test' });

      expect(res.status).toBe(404);
    });
  });

  // ==========================================
  // ADMIN: GET /admin/notifications
  // ==========================================
  describe('GET /admin/notifications', () => {
    it('returns notifications with unread count', async () => {
      (getAdminNotifications as any).mockResolvedValue([
        { id: 'notif-1', type: 'NEW_APPLICATION', read: false },
      ]);
      (getUnreadNotificationCount as any).mockResolvedValue(1);

      const res = await request(adminApp).get('/admin/notifications');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.notifications).toHaveLength(1);
      expect(res.body.data.unreadCount).toBe(1);
    });
  });

  // ==========================================
  // ADMIN: POST /admin/notifications/mark-read
  // ==========================================
  describe('POST /admin/notifications/mark-read', () => {
    it('marks notifications as read', async () => {
      (markNotificationsAsRead as any).mockResolvedValue(undefined);

      const res = await request(adminApp)
        .post('/admin/notifications/mark-read')
        .send({ notificationIds: ['notif-1', 'notif-2'] });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(markNotificationsAsRead).toHaveBeenCalledWith(['notif-1', 'notif-2']);
    });
  });

  // ==========================================
  // PUBLIC: GET /npi-lookup/:npi
  // ==========================================
  describe('GET /npi-lookup/:npi', () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
      globalThis.fetch = vi.fn() as any;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('returns NPPES data for valid NPI', async () => {
      (globalThis.fetch as any).mockResolvedValue({
        json: () => Promise.resolve({
          results: [{
            basic: { first_name: 'Jane', last_name: 'Doe', gender: 'F' },
            taxonomies: [{ code: '207Q00000X', desc: 'Family Medicine', primary: true }],
            addresses: [{ address_purpose: 'LOCATION', state: 'CA', telephone_number: '555-1234' }],
            enumeration_type: 'NPI-1',
          }],
        }),
      });

      const res = await request(publicApp).get('/npi-lookup/1234567890').set('X-Forwarded-For', nextIp());

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.firstName).toBe('Jane');
      expect(res.body.data.lastName).toBe('Doe');
      expect(res.body.data.state).toBe('CA');
    });

    it('returns 404 when NPI not found in NPPES', async () => {
      (globalThis.fetch as any).mockResolvedValue({
        json: () => Promise.resolve({ results: [] }),
      });

      const res = await request(publicApp).get('/npi-lookup/9999999999').set('X-Forwarded-For', nextIp());

      expect(res.status).toBe(404);
    });

    it('returns 400 for invalid NPI format', async () => {
      const res = await request(publicApp).get('/npi-lookup/123').set('X-Forwarded-For', nextIp());

      expect(res.status).toBe(400);
    });
  });

  // ==========================================
  // AUTH: GET /me
  // ==========================================
  describe('GET /me', () => {
    it('returns provider dashboard data', async () => {
      prismaMock.provider.findUnique.mockResolvedValue({
        id: 'provider-record-id',
        firstName: 'Provider',
        lastName: 'User',
        payerEnrollments: [{ id: 'enr-1', payer: { name: 'Aetna' } }],
        practiceLocations: [{ id: 'loc-1' }],
      } as any);

      const res = await request(providerApp).get('/me');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.enrollmentCount).toBe(1);
      expect(res.body.data.locationCount).toBe(1);
    });

    it('returns 404 when no provider linked', async () => {
      const noProviderUser = { ...adminUser, providerId: null };
      const noProviderApp = createTestApp(portalRouter, noProviderUser);

      const res = await request(noProviderApp).get('/me');

      expect(res.status).toBe(404);
    });

    it('returns 404 when provider not found in DB', async () => {
      prismaMock.provider.findUnique.mockResolvedValue(null);

      const res = await request(providerApp).get('/me');

      expect(res.status).toBe(404);
    });
  });

  // ==========================================
  // AUTH: GET /me/completeness
  // ==========================================
  describe('GET /me/completeness', () => {
    it('returns profile completeness percentage', async () => {
      prismaMock.provider.findUnique.mockResolvedValue({
        id: 'provider-record-id',
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@test.com',
        phone: '555-1234',
        npi: '1234567890',
        dateOfBirth: new Date(),
        providerType: 'psychiatrist',
        specialties: ['psychiatry'],
        practiceLocations: [{ id: 'loc-1' }],
        payerEnrollments: [],
      } as any);

      const res = await request(providerApp).get('/me/completeness');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.percentage).toBeDefined();
      expect(res.body.data.sections).toBeDefined();
      expect(res.body.data.completedCount).toBeGreaterThan(0);
    });

    it('returns 404 when no provider linked', async () => {
      const noProviderUser = { ...adminUser, providerId: null };
      const noProviderApp = createTestApp(portalRouter, noProviderUser);

      const res = await request(noProviderApp).get('/me/completeness');

      expect(res.status).toBe(404);
    });
  });
});

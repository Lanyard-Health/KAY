import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../../tests/helpers/test-app.js';
import { adminUser, providerUser } from '../../tests/helpers/fixtures.js';

const { mockGetNotifications, mockGetUnreadCount, mockMarkAsRead, mockGetPreferences, mockUpdatePreferences } = vi.hoisted(() => ({
  mockGetNotifications: vi.fn(),
  mockGetUnreadCount: vi.fn(),
  mockMarkAsRead: vi.fn(),
  mockGetPreferences: vi.fn(),
  mockUpdatePreferences: vi.fn(),
}));

vi.mock('../middleware/auth.middleware.js', () => ({
  authenticate: vi.fn((_req: any, _res: any, next: any) => next()),
  authorize: vi.fn(() => (_req: any, _res: any, next: any) => next()),
}));

vi.mock('../services/notification.service.js', () => ({
  notificationService: {
    getNotifications: mockGetNotifications,
    getUnreadCount: mockGetUnreadCount,
    markAsRead: mockMarkAsRead,
    getPreferences: mockGetPreferences,
    updatePreferences: mockUpdatePreferences,
  },
}));

import notificationRouter from './notification.routes.js';

describe('Notification Routes', () => {
  const app = createTestApp(notificationRouter, adminUser);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /', () => {
    it('returns notifications with defaults', async () => {
      mockGetNotifications.mockResolvedValue({
        notifications: [{ id: 'n1', title: 'Test', read: false }],
        totalCount: 1,
        unreadCount: 1,
      });

      const res = await request(app).get('/');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.notifications).toHaveLength(1);
      expect(mockGetNotifications).toHaveBeenCalledWith('admin-user-id', {
        unreadOnly: false,
        limit: 20,
        offset: 0,
      });
    });

    it('passes unreadOnly filter', async () => {
      mockGetNotifications.mockResolvedValue({
        notifications: [],
        totalCount: 0,
        unreadCount: 0,
      });

      await request(app).get('/?unreadOnly=true');

      expect(mockGetNotifications).toHaveBeenCalledWith('admin-user-id', {
        unreadOnly: true,
        limit: 20,
        offset: 0,
      });
    });

    it('passes custom limit and offset', async () => {
      mockGetNotifications.mockResolvedValue({
        notifications: [],
        totalCount: 0,
        unreadCount: 0,
      });

      await request(app).get('/?limit=50&offset=10');

      expect(mockGetNotifications).toHaveBeenCalledWith('admin-user-id', {
        unreadOnly: false,
        limit: 50,
        offset: 10,
      });
    });

    it('returns 400 when limit exceeds 100', async () => {
      const res = await request(app).get('/?limit=999');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(mockGetNotifications).not.toHaveBeenCalled();
    });

    it('returns 400 when limit=0 (below minimum)', async () => {
      const res = await request(app).get('/?limit=0');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(mockGetNotifications).not.toHaveBeenCalled();
    });

    it('returns 400 for non-numeric limit', async () => {
      const res = await request(app).get('/?limit=abc');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(mockGetNotifications).not.toHaveBeenCalled();
    });

    it('uses provider user id', async () => {
      const providerApp = createTestApp(notificationRouter, providerUser);
      mockGetNotifications.mockResolvedValue({
        notifications: [],
        totalCount: 0,
        unreadCount: 0,
      });

      await request(providerApp).get('/');

      expect(mockGetNotifications).toHaveBeenCalledWith('provider-user-id', expect.anything());
    });

    it('returns 500 on service error', async () => {
      mockGetNotifications.mockRejectedValue(new Error('DB down'));

      const res = await request(app).get('/');

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
    });
  });

  describe('GET /unread-count', () => {
    it('returns unread count', async () => {
      mockGetUnreadCount.mockResolvedValue(5);

      const res = await request(app).get('/unread-count');

      expect(res.status).toBe(200);
      expect(res.body.data.unreadCount).toBe(5);
      expect(mockGetUnreadCount).toHaveBeenCalledWith('admin-user-id');
    });

    it('returns 0 when no unread', async () => {
      mockGetUnreadCount.mockResolvedValue(0);

      const res = await request(app).get('/unread-count');

      expect(res.body.data.unreadCount).toBe(0);
    });

    it('returns 500 on service error', async () => {
      mockGetUnreadCount.mockRejectedValue(new Error('DB down'));

      const res = await request(app).get('/unread-count');

      expect(res.status).toBe(500);
    });
  });

  describe('POST /mark-read', () => {
    it('marks specific notifications as read', async () => {
      mockMarkAsRead.mockResolvedValue({ count: 2 });
      const ids = [
        '550e8400-e29b-41d4-a716-446655440001',
        '550e8400-e29b-41d4-a716-446655440002',
      ];

      const res = await request(app)
        .post('/mark-read')
        .send({ notificationIds: ids });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockMarkAsRead).toHaveBeenCalledWith('admin-user-id', ids);
    });

    it('marks all as read when no IDs provided', async () => {
      mockMarkAsRead.mockResolvedValue({ count: 10 });

      const res = await request(app)
        .post('/mark-read')
        .send({});

      expect(res.status).toBe(200);
      expect(mockMarkAsRead).toHaveBeenCalledWith('admin-user-id', undefined);
    });

    it('returns 400 for invalid body', async () => {
      const res = await request(app)
        .post('/mark-read')
        .send({ notificationIds: 'not-an-array' });

      expect(res.status).toBe(400);
    });

    it('returns 500 on service error', async () => {
      mockMarkAsRead.mockRejectedValue(new Error('DB down'));

      const res = await request(app)
        .post('/mark-read')
        .send({});

      expect(res.status).toBe(500);
    });
  });

  const PREFS = {
    enrollmentStatusChanges: true,
    credentialExpirations: true,
    followUpReminders: true,
    denialAlerts: true,
    weeklySummary: false,
  };

  describe('GET /preferences', () => {
    it('returns the current user preferences', async () => {
      mockGetPreferences.mockResolvedValue(PREFS);

      const res = await request(app).get('/preferences');

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual(PREFS);
      expect(mockGetPreferences).toHaveBeenCalledWith('admin-user-id');
    });

    it('returns 500 on service error', async () => {
      mockGetPreferences.mockRejectedValue(new Error('DB down'));

      const res = await request(app).get('/preferences');

      expect(res.status).toBe(500);
    });
  });

  describe('PUT /preferences', () => {
    it('round-trips a full preferences object', async () => {
      const updated = { ...PREFS, weeklySummary: true };
      mockUpdatePreferences.mockResolvedValue(updated);

      const res = await request(app).put('/preferences').send(updated);

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual(updated);
      expect(mockUpdatePreferences).toHaveBeenCalledWith('admin-user-id', updated);
    });

    it('returns 400 when a key is missing', async () => {
      const { weeklySummary: _omit, ...partial } = PREFS;
      const res = await request(app).put('/preferences').send(partial);

      expect(res.status).toBe(400);
      expect(mockUpdatePreferences).not.toHaveBeenCalled();
    });

    it('returns 400 on extra keys (strict schema)', async () => {
      const res = await request(app).put('/preferences').send({ ...PREFS, hackerFlag: true });

      expect(res.status).toBe(400);
      expect(mockUpdatePreferences).not.toHaveBeenCalled();
    });

    it('returns 400 on non-boolean values', async () => {
      const res = await request(app).put('/preferences').send({ ...PREFS, denialAlerts: 'yes' });

      expect(res.status).toBe(400);
      expect(mockUpdatePreferences).not.toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      mockUpdatePreferences.mockRejectedValue(new Error('DB down'));

      const res = await request(app).put('/preferences').send(PREFS);

      expect(res.status).toBe(500);
    });
  });
});

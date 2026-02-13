import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../../tests/helpers/test-app.js';
import { adminUser, providerUser } from '../../tests/helpers/fixtures.js';

const { mockGetNotifications, mockGetUnreadCount, mockMarkAsRead } = vi.hoisted(() => ({
  mockGetNotifications: vi.fn(),
  mockGetUnreadCount: vi.fn(),
  mockMarkAsRead: vi.fn(),
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

    it('caps limit at 100', async () => {
      mockGetNotifications.mockResolvedValue({
        notifications: [],
        totalCount: 0,
        unreadCount: 0,
      });

      await request(app).get('/?limit=999');

      expect(mockGetNotifications).toHaveBeenCalledWith('admin-user-id', {
        unreadOnly: false,
        limit: 100,
        offset: 0,
      });
    });

    it('defaults limit to 20 when 0 is passed (falsy coercion)', async () => {
      mockGetNotifications.mockResolvedValue({
        notifications: [],
        totalCount: 0,
        unreadCount: 0,
      });

      await request(app).get('/?limit=0');

      // parseInt('0') || 20 = 0 || 20 = 20 (0 is falsy)
      expect(mockGetNotifications).toHaveBeenCalledWith('admin-user-id', {
        unreadOnly: false,
        limit: 20,
        offset: 0,
      });
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
});

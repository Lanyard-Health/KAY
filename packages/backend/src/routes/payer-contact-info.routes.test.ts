import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock, prismaBase: prismaMock };
});

vi.mock('../middleware/auth.middleware.js', () => ({
  authenticate: vi.fn((_req: any, _res: any, next: any) => next()),
  authorize: vi.fn((...allowedRoles: string[]) => (req: any, res: any, next: any) => {
    if (!allowedRoles.includes(req.user?.role)) {
      return res.status(403).json({ success: false, error: { message: 'Forbidden' } });
    }
    next();
  }),
}));

import contactInfoRoutes from './payer-contact-info.routes.js';
import { createTestApp } from '../../tests/helpers/test-app.js';
import { adminUser, staffUser, practiceAdminUser } from '../../tests/helpers/fixtures.js';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';

const PAYER_ID = '22222222-2222-4222-a222-222222222222';

describe('GET /payers/:payerId/contact-info', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the row for lanyard_staff', async () => {
    prismaMock.payer.findUnique.mockResolvedValue({ id: PAYER_ID } as any);
    prismaMock.payerContactInfo.findUnique.mockResolvedValue({ payerId: PAYER_ID, phone: '(800) 555-0142' } as any);
    const app = createTestApp(contactInfoRoutes, { ...staffUser, role: 'lanyard_staff' });
    const res = await request(app).get(`/payers/${PAYER_ID}/contact-info`);
    expect(res.status).toBe(200);
    expect(res.body.data.phone).toBe('(800) 555-0142');
  });

  it('returns data null when nothing is on file (designed empty state)', async () => {
    prismaMock.payer.findUnique.mockResolvedValue({ id: PAYER_ID } as any);
    prismaMock.payerContactInfo.findUnique.mockResolvedValue(null);
    const app = createTestApp(contactInfoRoutes, adminUser);
    const res = await request(app).get(`/payers/${PAYER_ID}/contact-info`);
    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
  });

  it('404s on an unknown payer', async () => {
    prismaMock.payer.findUnique.mockResolvedValue(null);
    const app = createTestApp(contactInfoRoutes, adminUser);
    const res = await request(app).get(`/payers/${PAYER_ID}/contact-info`);
    expect(res.status).toBe(404);
  });

  it('403s for practice-side roles (fail closed)', async () => {
    for (const user of [{ ...staffUser, role: 'credentialing_staff' }, practiceAdminUser]) {
      const app = createTestApp(contactInfoRoutes, user);
      const res = await request(app).get(`/payers/${PAYER_ID}/contact-info`);
      expect(res.status).toBe(403);
    }
  });
});

describe('PUT /payers/:payerId/contact-info', () => {
  beforeEach(() => vi.clearAllMocks());

  it('upserts and stamps updatedById', async () => {
    prismaMock.payer.findUnique.mockResolvedValue({ id: PAYER_ID } as any);
    prismaMock.payerContactInfo.upsert.mockResolvedValue({ payerId: PAYER_ID, phone: '(800) 555-0142' } as any);
    const app = createTestApp(contactInfoRoutes, { ...staffUser, role: 'lanyard_staff' });
    const res = await request(app).put(`/payers/${PAYER_ID}/contact-info`)
      .send({ phone: '(800) 555-0142', email: '', bestWay: 'Phone, ask for credentialing dept' });
    expect(res.status).toBe(200);
    const args = prismaMock.payerContactInfo.upsert.mock.calls[0][0];
    expect(args.create.updatedById).toBe('staff-user-id');
    expect(args.update.updatedById).toBe('staff-user-id');
    expect(args.create.email).toBeNull(); // '' → null
  });

  it('403s for practice-side credentialing_staff', async () => {
    const app = createTestApp(contactInfoRoutes, { ...staffUser, role: 'credentialing_staff' });
    const res = await request(app).put(`/payers/${PAYER_ID}/contact-info`).send({ phone: 'x' });
    expect(res.status).toBe(403);
  });
});

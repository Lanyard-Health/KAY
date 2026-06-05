import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { errorHandler } from '../../middleware/error.middleware.js';

// Hoist mock
const { mockSelfServeSignup } = vi.hoisted(() => ({
  mockSelfServeSignup: vi.fn(),
}));

// Mock the service — keep other exports intact
vi.mock('../../services/portal.service.js', () => ({
  selfServeSignup: mockSelfServeSignup,
  submitApplication: vi.fn(),
  getApplicationStatus: vi.fn(),
  approveApplication: vi.fn(),
  rejectApplication: vi.fn(),
  getCurrentProvider: vi.fn(),
  getProfileCompleteness: vi.fn(),
  updateProviderProfile: vi.fn(),
  updateOnboardingStatus: vi.fn(),
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock, prismaBase: prismaMock };
});

// Mock authenticate to skip auth for tests
vi.mock('../../middleware/auth.middleware.js', () => ({
  authenticate: (_req: any, _res: any, next: any) => next(),
  authorize: () => (_req: any, _res: any, next: any) => next(),
  requireProviderAccess: (_req: any, _res: any, next: any) => next(),
}));

// Mock rate limiter to pass through
vi.mock('express-rate-limit', () => ({
  default: () => (_req: any, _res: any, next: any) => next(),
}));

import portalRoutes from '../../routes/portal.routes.js';

function createApp() {
  const app = express();
  app.use(express.json());
  // Mount at /portal to match the router prefix
  app.use('/portal', portalRoutes);
  app.use(errorHandler);
  return app;
}

const validBody = {
  npi: '1234567890',
  firstName: 'Jane',
  lastName: 'Doe',
  email: 'jane@example.com',
  phone: '(555) 123-4567',
  dateOfBirth: '1985-06-15',
  gender: 'female',
  providerType: 'psychiatrist',
  password: 'StrongPass123!',
  confirmPassword: 'StrongPass123!',
};

describe('POST /portal/self-serve-signup', () => {
  beforeEach(() => {
    mockSelfServeSignup.mockReset();
  });

  it('returns 201 on valid self-serve signup', async () => {
    mockSelfServeSignup.mockResolvedValue({
      userId: 'user-1',
      providerId: 'provider-1',
      email: 'jane@example.com',
    });

    const res = await request(createApp())
      .post('/portal/self-serve-signup')
      .send(validBody);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({
      userId: 'user-1',
      providerId: 'provider-1',
      email: 'jane@example.com',
    });

    // Verify confirmPassword was stripped
    expect(mockSelfServeSignup).toHaveBeenCalledWith(
      expect.not.objectContaining({ confirmPassword: expect.anything() }),
    );
  });

  it('returns 400 for missing password', async () => {
    const { password, confirmPassword, ...noPassword } = validBody;
    const res = await request(createApp())
      .post('/portal/self-serve-signup')
      .send(noPassword);

    expect(res.status).toBe(400);
  });

  it('returns 400 for weak password (under 12 chars)', async () => {
    const res = await request(createApp())
      .post('/portal/self-serve-signup')
      .send({ ...validBody, password: 'Weak1!', confirmPassword: 'Weak1!' });

    expect(res.status).toBe(400);
  });

  it('returns 400 for password mismatch', async () => {
    const res = await request(createApp())
      .post('/portal/self-serve-signup')
      .send({ ...validBody, confirmPassword: 'DifferentPass123!' });

    expect(res.status).toBe(400);
  });

  it('returns 409 for duplicate email', async () => {
    mockSelfServeSignup.mockRejectedValue(
      new Error('An account with this email address already exists'),
    );

    const res = await request(createApp())
      .post('/portal/self-serve-signup')
      .send(validBody);

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
  });

  it('returns 409 for duplicate NPI', async () => {
    mockSelfServeSignup.mockRejectedValue(
      new Error('A provider with this NPI already exists in our system'),
    );

    const res = await request(createApp())
      .post('/portal/self-serve-signup')
      .send(validBody);

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
  });

  it('returns 500 for unexpected errors without exposing details', async () => {
    mockSelfServeSignup.mockRejectedValue(new Error('Internal DB crash'));

    const res = await request(createApp())
      .post('/portal/self-serve-signup')
      .send(validBody);

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    // Error now flows through global error handler — internal details not exposed in production
    expect(res.body.error?.code || res.body.error).toBeDefined();
    expect(res.body.stack).toBeUndefined();
  });
});

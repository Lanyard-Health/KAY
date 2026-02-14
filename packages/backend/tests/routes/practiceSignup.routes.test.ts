import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { errorHandler } from '../../src/middleware/error.middleware.js';

// Hoist mock function
const { mockRegisterPractice } = vi.hoisted(() => ({
  mockRegisterPractice: vi.fn(),
}));

// Mock the service
vi.mock('../../src/services/practiceSignup.service.js', () => ({
  registerPractice: mockRegisterPractice,
}));

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import practiceSignupRoutes from '../../src/routes/practiceSignup.routes.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(practiceSignupRoutes);
  app.use(errorHandler);
  return app;
}

const validBody = {
  practiceName: 'Test Practice',
  firstName: 'John',
  lastName: 'Doe',
  email: 'john@testpractice.com',
  phone: '(555) 123-4567',
  password: 'StrongPass123!',
};

describe('POST /register', () => {
  beforeEach(() => {
    mockRegisterPractice.mockReset();
  });

  it('should return 201 with userId and practiceId on success', async () => {
    mockRegisterPractice.mockResolvedValue({
      userId: 'user-1',
      practiceId: 'practice-1',
      email: 'john@testpractice.com',
    });

    const res = await request(createApp())
      .post('/register')
      .send(validBody);

    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({
      userId: 'user-1',
      practiceId: 'practice-1',
      email: 'john@testpractice.com',
    });
  });

  it('should return 400 for missing required fields', async () => {
    const res = await request(createApp())
      .post('/register')
      .send({ email: 'test@test.com' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
    expect(res.body.details).toBeDefined();
  });

  it('should return 400 for weak password', async () => {
    const res = await request(createApp())
      .post('/register')
      .send({ ...validBody, password: 'weak' });

    expect(res.status).toBe(400);
    expect(res.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'password' }),
      ]),
    );
  });

  it('should return 409 for duplicate email', async () => {
    mockRegisterPractice.mockRejectedValue(new Error('EMAIL_EXISTS'));

    const res = await request(createApp())
      .post('/register')
      .send(validBody);

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('already exists');
  });

  it('should return 500 for unexpected errors without exposing details', async () => {
    mockRegisterPractice.mockRejectedValue(new Error('Unexpected'));

    const res = await request(createApp())
      .post('/register')
      .send(validBody);

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Registration failed. Please try again.');
    expect(res.body.stack).toBeUndefined();
  });
});

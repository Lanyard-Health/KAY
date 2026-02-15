import { describe, it, expect, vi } from 'vitest';
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

// Fresh import — gets its own rate limiter instance (MemoryStore resets per file)
import practiceSignupRoutes from '../../src/routes/practiceSignup.routes.js';

const validBody = {
  practiceName: 'Test Practice',
  firstName: 'John',
  lastName: 'Doe',
  email: 'john@testpractice.com',
  phone: '(555) 123-4567',
  password: 'StrongPass123!',
};

describe('POST /register — rate limiting', () => {
  it('returns 429 after exceeding 5 requests in the time window', async () => {
    mockRegisterPractice.mockResolvedValue({
      userId: 'user-1',
      practiceId: 'practice-1',
      email: 'john@testpractice.com',
    });

    // Single app instance so all requests share the same rate limiter state
    const app = express();
    app.use(express.json());
    app.use(practiceSignupRoutes);
    app.use(errorHandler);

    // First 5 requests should succeed (NODE_ENV=test → max=5)
    for (let i = 0; i < 5; i++) {
      const res = await request(app).post('/register').send(validBody);
      expect(res.status).toBe(201);
    }

    // 6th request should be rate limited
    const res = await request(app).post('/register').send(validBody);
    expect(res.status).toBe(429);
    expect(res.body.error).toContain('Too many signup attempts');
  });
});

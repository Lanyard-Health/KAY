import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { errorHandler } from '../middleware/error.middleware.js';

vi.mock('../services/practiceSignup.service.js', () => ({
  registerPractice: vi.fn(),
}));

vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import practiceSignupRouter from './practiceSignup.routes.js';
import { registerPractice } from '../services/practiceSignup.service.js';

const mockedRegisterPractice = vi.mocked(registerPractice);

const app = express();
app.use(express.json());
app.use(practiceSignupRouter);
app.use(errorHandler);

const validPayload = {
  practiceName: 'Test Medical Group',
  firstName: 'Jane',
  lastName: 'Doe',
  email: 'jane.doe@example.com',
  password: 'SecureP@ss1234',
  phone: '555-123-4567',
  addressLine1: '123 Main St',
  city: 'Boston',
  state: 'MA',
  zipCode: '02101',
  operatingStates: ['MA'],
  targetPayerIds: ['00000000-0000-4000-a000-000000000001'],
};

describe('Practice Signup Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /register', () => {
    it('returns 201 on successful registration', async () => {
      const mockResult = { practiceId: 'practice-abc-123', userId: 'user-xyz-789' };
      mockedRegisterPractice.mockResolvedValue(mockResult);

      const res = await request(app).post('/register').send(validPayload);

      expect(res.status).toBe(201);
      expect(res.body.data).toEqual(mockResult);
      expect(mockedRegisterPractice).toHaveBeenCalledWith(
        expect.objectContaining({
          practiceName: validPayload.practiceName,
          email: validPayload.email,
          firstName: validPayload.firstName,
          lastName: validPayload.lastName,
          phone: validPayload.phone,
        })
      );
    });

    it('passes a valid owners array through to the service', async () => {
      mockedRegisterPractice.mockResolvedValue({ practiceId: 'p1', userId: 'u1' });

      const res = await request(app).post('/register').send({
        ...validPayload,
        owners: [{ name: 'Jane Doe', ssn: '123-45-6789', ownershipPercentage: 100, dateOfBirth: '1985-04-12' }],
      });

      expect(res.status).toBe(201);
      expect(mockedRegisterPractice).toHaveBeenCalledWith(
        expect.objectContaining({
          owners: expect.arrayContaining([expect.objectContaining({ name: 'Jane Doe', ssn: '123-45-6789' })]),
        })
      );
    });

    it('rejects more than 3 owners', async () => {
      const owners = Array.from({ length: 4 }, (_, i) => ({ name: `Owner ${i + 1}` }));
      const res = await request(app).post('/register').send({ ...validPayload, owners });

      expect(res.status).toBe(400);
      expect(mockedRegisterPractice).not.toHaveBeenCalled();
    });

    it('rejects a malformed owner SSN', async () => {
      const res = await request(app)
        .post('/register')
        .send({ ...validPayload, owners: [{ name: 'Jane Doe', ssn: '12-3' }] });

      expect(res.status).toBe(400);
      expect(mockedRegisterPractice).not.toHaveBeenCalled();
    });

    it('returns 400 on validation failure with empty body', async () => {
      const res = await request(app).post('/register').send({});

      expect(res.status).toBe(400);
      expect(res.body.error.message).toBe('Validation failed');
      expect(res.body.error.details).toBeDefined();
      expect(Array.isArray(res.body.error.details)).toBe(true);
      expect(res.body.error.details.length).toBeGreaterThan(0);
      expect(mockedRegisterPractice).not.toHaveBeenCalled();
    });

    it('returns 400 on validation failure with missing required fields', async () => {
      const incomplete = { practiceName: 'Test Practice' };

      const res = await request(app).post('/register').send(incomplete);

      expect(res.status).toBe(400);
      expect(res.body.error.message).toBe('Validation failed');
      expect(res.body.error.details).toBeDefined();
      expect(mockedRegisterPractice).not.toHaveBeenCalled();
    });

    it('returns 409 when email already exists', async () => {
      mockedRegisterPractice.mockRejectedValue(new Error('EMAIL_EXISTS'));

      const res = await request(app).post('/register').send(validPayload);

      expect(res.status).toBe(409);
      expect(res.body.error.message).toBe('An account with this email already exists');
    });

    it('returns 500 on unexpected error', async () => {
      mockedRegisterPractice.mockRejectedValue(new Error('Something went wrong'));

      const res = await request(app).post('/register').send(validPayload);

      expect(res.status).toBe(500);
      expect(res.body.error.message).toBe('Registration failed. Please try again.');
    });
  });
});

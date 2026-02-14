import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoist mock functions so vi.mock factory can reference them
const { mockCreateCognitoUser, mockSetCognitoUserPassword, mockDeleteCognitoUser } = vi.hoisted(() => ({
  mockCreateCognitoUser: vi.fn(),
  mockSetCognitoUserPassword: vi.fn(),
  mockDeleteCognitoUser: vi.fn(),
}));

// Mock prisma
vi.mock('../../src/utils/prisma.js', async () => {
  const { prismaMock } = await import('../helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

// Mock cognito service
vi.mock('../../src/services/cognitoUser.service.js', () => ({
  createCognitoUser: mockCreateCognitoUser,
  setCognitoUserPassword: mockSetCognitoUserPassword,
  deleteCognitoUser: mockDeleteCognitoUser,
}));

// Mock email service
vi.mock('../../src/services/email.service.js', () => ({
  emailService: {
    isConfigured: vi.fn().mockReturnValue(false),
    sendEmail: vi.fn(),
  },
}));

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { registerPractice } from '../../src/services/practiceSignup.service.js';
import { prismaMock } from '../helpers/mock-prisma.js';

const validInput = {
  practiceName: 'Test Practice',
  firstName: 'John',
  lastName: 'Doe',
  email: 'john@testpractice.com',
  phone: '(555) 123-4567',
  password: 'StrongPass123!',
};

describe('practiceSignup.service', () => {
  beforeEach(() => {
    mockCreateCognitoUser.mockReset();
    mockSetCognitoUserPassword.mockReset();
    mockDeleteCognitoUser.mockReset();
    mockDeleteCognitoUser.mockResolvedValue(undefined);
  });

  describe('registerPractice', () => {
    it('should create Cognito user, set password, and create Practice + User + UserPractice', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);
      mockCreateCognitoUser.mockResolvedValue({ cognitoId: 'cognito-123' });
      mockSetCognitoUserPassword.mockResolvedValue(undefined);

      const mockPractice = { id: 'practice-1', name: 'Test Practice' };
      const mockUser = { id: 'user-1', email: 'john@testpractice.com' };
      prismaMock.$transaction.mockImplementation(async (fn: any) => {
        const tx = {
          practice: { create: vi.fn().mockResolvedValue(mockPractice) },
          user: { create: vi.fn().mockResolvedValue(mockUser) },
          userPractice: { create: vi.fn().mockResolvedValue({}) },
        };
        return fn(tx);
      });

      const result = await registerPractice(validInput);

      expect(result).toEqual({
        userId: 'user-1',
        practiceId: 'practice-1',
        email: 'john@testpractice.com',
      });

      expect(mockCreateCognitoUser).toHaveBeenCalledWith({
        email: 'john@testpractice.com',
        firstName: 'John',
        lastName: 'Doe',
        suppressInviteEmail: true,
      });

      expect(mockSetCognitoUserPassword).toHaveBeenCalledWith(
        'john@testpractice.com',
        'StrongPass123!',
        true,
      );
    });

    it('should throw EMAIL_EXISTS if email already in use', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: 'existing' } as any);

      await expect(registerPractice(validInput)).rejects.toThrow('EMAIL_EXISTS');
      expect(mockCreateCognitoUser).not.toHaveBeenCalled();
    });

    it('should not create DB records if Cognito creation fails', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);
      mockCreateCognitoUser.mockRejectedValue(new Error('Cognito failure'));

      await expect(registerPractice(validInput)).rejects.toThrow('Cognito failure');
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('should roll back Cognito user if DB transaction fails', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);
      mockCreateCognitoUser.mockResolvedValue({ cognitoId: 'cognito-123' });
      mockSetCognitoUserPassword.mockResolvedValue(undefined);
      prismaMock.$transaction.mockRejectedValue(new Error('DB failure'));

      await expect(registerPractice(validInput)).rejects.toThrow('DB failure');
      expect(mockDeleteCognitoUser).toHaveBeenCalledWith('john@testpractice.com');
    });

    it('should roll back Cognito user if password set fails', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);
      mockCreateCognitoUser.mockResolvedValue({ cognitoId: 'cognito-123' });
      mockSetCognitoUserPassword.mockRejectedValue(new Error('Password policy'));

      await expect(registerPractice(validInput)).rejects.toThrow('Password policy');
      expect(mockDeleteCognitoUser).toHaveBeenCalledWith('john@testpractice.com');
    });
  });
});

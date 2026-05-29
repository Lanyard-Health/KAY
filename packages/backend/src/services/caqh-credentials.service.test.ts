import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock prisma via async factory
vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

// Mock logger
vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// Mock crypto
const mockEncrypt = vi.fn((text: string) => `encrypted:${text}`);
const mockDecrypt = vi.fn((text: string) => {
  if (text.startsWith('encrypted:')) {
    return text.replace('encrypted:', '');
  }
  throw new Error('Invalid encrypted text format');
});

vi.mock('../utils/crypto.js', () => ({
  encrypt: (...args: any[]) => mockEncrypt(...args),
  decrypt: (...args: any[]) => mockDecrypt(...args),
}));

// Mock puppeteer so we don't launch browsers in tests
vi.mock('puppeteer', () => ({
  default: {
    launch: vi.fn(),
  },
}));

import { CaqhCredentialsService } from './caqh-credentials.service.js';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';

describe('CaqhCredentialsService', () => {
  let service: CaqhCredentialsService;

  beforeEach(() => {
    service = new CaqhCredentialsService();
    vi.clearAllMocks();
  });

  describe('saveCredentials()', () => {
    it('encrypts password before storage', async () => {
      prismaMock.providerProfile.update.mockResolvedValue({} as any);

      await service.saveCredentials('provider-1', 'username', 'myP@ssw0rd');

      expect(mockEncrypt).toHaveBeenCalledWith('myP@ssw0rd');
      expect(prismaMock.providerProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'provider-1' },
          data: expect.objectContaining({
            caqhUsername: 'username',
            caqhPassword: 'encrypted:myP@ssw0rd',
            caqhCredentialsValid: null,
            caqhCredentialsLastChecked: null,
          }),
        })
      );
    });

    it('stores username as plaintext', async () => {
      prismaMock.providerProfile.update.mockResolvedValue({} as any);

      await service.saveCredentials('provider-1', 'myuser', 'pass');

      expect(prismaMock.providerProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ caqhUsername: 'myuser' }),
        })
      );
    });

    it('resets validity and lastChecked on save', async () => {
      prismaMock.providerProfile.update.mockResolvedValue({} as any);

      await service.saveCredentials('provider-1', 'user', 'pass');

      expect(prismaMock.providerProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            caqhCredentialsValid: null,
            caqhCredentialsLastChecked: null,
          }),
        })
      );
    });
  });

  describe('getCredentialStatus()', () => {
    it('returns status for provider with credentials', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue({
        caqhUsername: 'testuser',
        caqhCredentialsValid: true,
        caqhCredentialsLastChecked: new Date('2024-01-01'),
      } as any);

      const status = await service.getCredentialStatus('provider-1');

      expect(status.hasCredentials).toBe(true);
      expect(status.isValid).toBe(true);
      expect(status.username).toBe('testuser');
      expect(status.lastChecked).toEqual(new Date('2024-01-01'));
    });

    it('returns hasCredentials=false when no username set', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue({
        caqhUsername: null,
        caqhCredentialsValid: null,
        caqhCredentialsLastChecked: null,
      } as any);

      const status = await service.getCredentialStatus('provider-1');

      expect(status.hasCredentials).toBe(false);
    });

    it('throws when provider not found', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue(null);

      await expect(service.getCredentialStatus('nonexistent')).rejects.toThrow('Provider not found');
    });
  });

  describe('verifyAndUpdateProvider()', () => {
    it('returns error when provider not found', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue(null);

      const result = await service.verifyAndUpdateProvider('nonexistent');

      expect(result.success).toBe(false);
      expect(result.message).toBe('Provider not found');
    });

    it('returns error when credentials not configured', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue({
        id: 'provider-1',
        caqhUsername: null,
        caqhPassword: null,
        firstName: 'Jane',
        lastName: 'Doe',
      } as any);

      const result = await service.verifyAndUpdateProvider('provider-1');

      expect(result.success).toBe(false);
      expect(result.message).toContain('not configured');
    });
  });
});

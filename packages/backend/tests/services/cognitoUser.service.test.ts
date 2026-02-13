import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AdminCreateUserCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminDeleteUserCommand,
  AdminUpdateUserAttributesCommand,
  AdminSetUserPasswordCommand,
  MessageActionType,
} from '@aws-sdk/client-cognito-identity-provider';

// Mock the AWS SDK client before importing the service
const mockSend = vi.fn();
vi.mock('@aws-sdk/client-cognito-identity-provider', async () => {
  const actual = await vi.importActual('@aws-sdk/client-cognito-identity-provider');
  return {
    ...actual,
    CognitoIdentityProviderClient: vi.fn().mockImplementation(function () { return {
      send: mockSend,
    }; }),
  };
});

// Mock the logger to keep tests quiet
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Set required env vars before importing the service
process.env['COGNITO_USER_POOL_ID'] = 'us-east-1_testpool';
process.env['DEV_AUTH_BYPASS'] = 'false';

describe('cognitoUser.service', () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  describe('createCognitoUser', () => {
    describe('production mode (DEV_AUTH_BYPASS=false)', () => {
      let createCognitoUser: typeof import('../../src/services/cognitoUser.service.js').createCognitoUser;

      beforeEach(async () => {
        process.env['DEV_AUTH_BYPASS'] = 'false';
        vi.resetModules();
        vi.doMock('@aws-sdk/client-cognito-identity-provider', async () => {
          const actual = await vi.importActual('@aws-sdk/client-cognito-identity-provider');
          return {
            ...actual,
            CognitoIdentityProviderClient: vi.fn().mockImplementation(function () { return {
              send: mockSend,
            }; }),
          };
        });
        vi.doMock('../../src/utils/logger.js', () => ({
          logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        }));
        const mod = await import('../../src/services/cognitoUser.service.js');
        createCognitoUser = mod.createCognitoUser;
      });

      it('creates a Cognito user and returns the sub as cognitoId', async () => {
        mockSend.mockResolvedValueOnce({
          User: {
            Attributes: [
              { Name: 'sub', Value: 'abc-123-def-456' },
              { Name: 'email', Value: 'test@example.com' },
            ],
          },
        });

        const result = await createCognitoUser({
          email: 'test@example.com',
          firstName: 'Test',
          lastName: 'User',
        });

        expect(result.cognitoId).toBe('abc-123-def-456');
        expect(mockSend).toHaveBeenCalledOnce();

        const command = mockSend.mock.calls[0][0];
        expect(command).toBeInstanceOf(AdminCreateUserCommand);
        expect(command.input.Username).toBe('test@example.com');
        expect(command.input.UserPoolId).toBe('us-east-1_testpool');
        expect(command.input.DesiredDeliveryMediums).toEqual(['EMAIL']);
      });

      it('sets email, email_verified, name, given_name, family_name attributes', async () => {
        mockSend.mockResolvedValueOnce({
          User: {
            Attributes: [{ Name: 'sub', Value: 'sub-123' }],
          },
        });

        await createCognitoUser({
          email: 'jane@example.com',
          firstName: 'Jane',
          lastName: 'Doe',
        });

        const command = mockSend.mock.calls[0][0];
        const attrs = command.input.UserAttributes;

        expect(attrs).toContainEqual({ Name: 'email', Value: 'jane@example.com' });
        expect(attrs).toContainEqual({ Name: 'email_verified', Value: 'true' });
        expect(attrs).toContainEqual({ Name: 'name', Value: 'Jane Doe' });
        expect(attrs).toContainEqual({ Name: 'given_name', Value: 'Jane' });
        expect(attrs).toContainEqual({ Name: 'family_name', Value: 'Doe' });
      });

      it('passes temporaryPassword when provided', async () => {
        mockSend.mockResolvedValueOnce({
          User: {
            Attributes: [{ Name: 'sub', Value: 'sub-123' }],
          },
        });

        await createCognitoUser({
          email: 'test@example.com',
          firstName: 'Test',
          lastName: 'User',
          temporaryPassword: 'TempPass123!',
        });

        const command = mockSend.mock.calls[0][0];
        expect(command.input.TemporaryPassword).toBe('TempPass123!');
      });

      it('does not set TemporaryPassword when not provided', async () => {
        mockSend.mockResolvedValueOnce({
          User: {
            Attributes: [{ Name: 'sub', Value: 'sub-123' }],
          },
        });

        await createCognitoUser({
          email: 'test@example.com',
          firstName: 'Test',
          lastName: 'User',
        });

        const command = mockSend.mock.calls[0][0];
        expect(command.input.TemporaryPassword).toBeUndefined();
      });

      it('suppresses invite email when suppressInviteEmail is true', async () => {
        mockSend.mockResolvedValueOnce({
          User: {
            Attributes: [{ Name: 'sub', Value: 'sub-123' }],
          },
        });

        await createCognitoUser({
          email: 'test@example.com',
          firstName: 'Test',
          lastName: 'User',
          suppressInviteEmail: true,
        });

        const command = mockSend.mock.calls[0][0];
        expect(command.input.MessageAction).toBe(MessageActionType.SUPPRESS);
      });

      it('does not suppress invite email by default', async () => {
        mockSend.mockResolvedValueOnce({
          User: {
            Attributes: [{ Name: 'sub', Value: 'sub-123' }],
          },
        });

        await createCognitoUser({
          email: 'test@example.com',
          firstName: 'Test',
          lastName: 'User',
        });

        const command = mockSend.mock.calls[0][0];
        expect(command.input.MessageAction).toBeUndefined();
      });

      it('throws when Cognito returns no sub attribute', async () => {
        mockSend.mockResolvedValueOnce({
          User: {
            Attributes: [{ Name: 'email', Value: 'test@example.com' }],
          },
        });

        await expect(
          createCognitoUser({
            email: 'test@example.com',
            firstName: 'Test',
            lastName: 'User',
          })
        ).rejects.toThrow('Cognito user created but no sub returned');
      });

      it('throws when Cognito returns no User', async () => {
        mockSend.mockResolvedValueOnce({});

        await expect(
          createCognitoUser({
            email: 'test@example.com',
            firstName: 'Test',
            lastName: 'User',
          })
        ).rejects.toThrow('Cognito user created but no sub returned');
      });

      it('propagates Cognito SDK errors', async () => {
        mockSend.mockRejectedValueOnce(new Error('UsernameExistsException'));

        await expect(
          createCognitoUser({
            email: 'existing@example.com',
            firstName: 'Test',
            lastName: 'User',
          })
        ).rejects.toThrow('UsernameExistsException');
      });
    });

    describe('dev bypass mode (DEV_AUTH_BYPASS=true)', () => {
      let createCognitoUser: typeof import('../../src/services/cognitoUser.service.js').createCognitoUser;

      beforeEach(async () => {
        process.env['DEV_AUTH_BYPASS'] = 'true';
        // Re-import to pick up new env
        vi.resetModules();
        // Re-mock after module reset
        vi.doMock('@aws-sdk/client-cognito-identity-provider', async () => {
          const actual = await vi.importActual('@aws-sdk/client-cognito-identity-provider');
          return {
            ...actual,
            CognitoIdentityProviderClient: vi.fn().mockImplementation(function () { return {
              send: mockSend,
            }; }),
          };
        });
        vi.doMock('../../src/utils/logger.js', () => ({
          logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        }));
        const mod = await import('../../src/services/cognitoUser.service.js');
        createCognitoUser = mod.createCognitoUser;
      });

      afterEach(() => {
        process.env['DEV_AUTH_BYPASS'] = 'false';
      });

      it('returns a dev-prefixed cognitoId without calling Cognito', async () => {
        const result = await createCognitoUser({
          email: 'dev@example.com',
          firstName: 'Dev',
          lastName: 'User',
        });

        expect(result.cognitoId).toMatch(/^dev-/);
        expect(result.cognitoId).toHaveLength(40); // "dev-" + UUID
        expect(mockSend).not.toHaveBeenCalled();
      });

      it('generates unique IDs on each call', async () => {
        const result1 = await createCognitoUser({
          email: 'dev1@example.com',
          firstName: 'Dev',
          lastName: 'One',
        });
        const result2 = await createCognitoUser({
          email: 'dev2@example.com',
          firstName: 'Dev',
          lastName: 'Two',
        });

        expect(result1.cognitoId).not.toBe(result2.cognitoId);
      });
    });
  });

  describe('disableCognitoUser', () => {
    let disableCognitoUser: typeof import('../../src/services/cognitoUser.service.js').disableCognitoUser;

    beforeEach(async () => {
      process.env['DEV_AUTH_BYPASS'] = 'false';
      vi.resetModules();
      vi.doMock('@aws-sdk/client-cognito-identity-provider', async () => {
        const actual = await vi.importActual('@aws-sdk/client-cognito-identity-provider');
        return {
          ...actual,
          CognitoIdentityProviderClient: vi.fn().mockImplementation(function () { return {
            send: mockSend,
          }; }),
        };
      });
      vi.doMock('../../src/utils/logger.js', () => ({
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      }));
      const mod = await import('../../src/services/cognitoUser.service.js');
      disableCognitoUser = mod.disableCognitoUser;
    });

    it('sends AdminDisableUserCommand with correct params', async () => {
      mockSend.mockResolvedValueOnce({});

      await disableCognitoUser('user@example.com');

      expect(mockSend).toHaveBeenCalledOnce();
      const command = mockSend.mock.calls[0][0];
      expect(command).toBeInstanceOf(AdminDisableUserCommand);
      expect(command.input.Username).toBe('user@example.com');
      expect(command.input.UserPoolId).toBe('us-east-1_testpool');
    });

    it('skips Cognito call in dev bypass mode', async () => {
      process.env['DEV_AUTH_BYPASS'] = 'true';
      vi.resetModules();
      vi.doMock('@aws-sdk/client-cognito-identity-provider', async () => {
        const actual = await vi.importActual('@aws-sdk/client-cognito-identity-provider');
        return {
          ...actual,
          CognitoIdentityProviderClient: vi.fn().mockImplementation(function () { return {
            send: mockSend,
          }; }),
        };
      });
      vi.doMock('../../src/utils/logger.js', () => ({
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      }));
      const mod = await import('../../src/services/cognitoUser.service.js');

      await mod.disableCognitoUser('user@example.com');
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('propagates Cognito SDK errors', async () => {
      mockSend.mockRejectedValueOnce(new Error('UserNotFoundException'));

      await expect(disableCognitoUser('missing@example.com')).rejects.toThrow(
        'UserNotFoundException'
      );
    });
  });

  describe('enableCognitoUser', () => {
    let enableCognitoUser: typeof import('../../src/services/cognitoUser.service.js').enableCognitoUser;

    beforeEach(async () => {
      process.env['DEV_AUTH_BYPASS'] = 'false';
      vi.resetModules();
      vi.doMock('@aws-sdk/client-cognito-identity-provider', async () => {
        const actual = await vi.importActual('@aws-sdk/client-cognito-identity-provider');
        return {
          ...actual,
          CognitoIdentityProviderClient: vi.fn().mockImplementation(function () { return {
            send: mockSend,
          }; }),
        };
      });
      vi.doMock('../../src/utils/logger.js', () => ({
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      }));
      const mod = await import('../../src/services/cognitoUser.service.js');
      enableCognitoUser = mod.enableCognitoUser;
    });

    it('sends AdminEnableUserCommand with correct params', async () => {
      mockSend.mockResolvedValueOnce({});

      await enableCognitoUser('user@example.com');

      expect(mockSend).toHaveBeenCalledOnce();
      const command = mockSend.mock.calls[0][0];
      expect(command).toBeInstanceOf(AdminEnableUserCommand);
      expect(command.input.Username).toBe('user@example.com');
      expect(command.input.UserPoolId).toBe('us-east-1_testpool');
    });
  });

  describe('deleteCognitoUser', () => {
    let deleteCognitoUser: typeof import('../../src/services/cognitoUser.service.js').deleteCognitoUser;

    beforeEach(async () => {
      process.env['DEV_AUTH_BYPASS'] = 'false';
      vi.resetModules();
      vi.doMock('@aws-sdk/client-cognito-identity-provider', async () => {
        const actual = await vi.importActual('@aws-sdk/client-cognito-identity-provider');
        return {
          ...actual,
          CognitoIdentityProviderClient: vi.fn().mockImplementation(function () { return {
            send: mockSend,
          }; }),
        };
      });
      vi.doMock('../../src/utils/logger.js', () => ({
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      }));
      const mod = await import('../../src/services/cognitoUser.service.js');
      deleteCognitoUser = mod.deleteCognitoUser;
    });

    it('sends AdminDeleteUserCommand with correct params', async () => {
      mockSend.mockResolvedValueOnce({});

      await deleteCognitoUser('user@example.com');

      expect(mockSend).toHaveBeenCalledOnce();
      const command = mockSend.mock.calls[0][0];
      expect(command).toBeInstanceOf(AdminDeleteUserCommand);
      expect(command.input.Username).toBe('user@example.com');
    });

    it('skips Cognito call in dev bypass mode', async () => {
      process.env['DEV_AUTH_BYPASS'] = 'true';
      vi.resetModules();
      vi.doMock('@aws-sdk/client-cognito-identity-provider', async () => {
        const actual = await vi.importActual('@aws-sdk/client-cognito-identity-provider');
        return {
          ...actual,
          CognitoIdentityProviderClient: vi.fn().mockImplementation(function () { return {
            send: mockSend,
          }; }),
        };
      });
      vi.doMock('../../src/utils/logger.js', () => ({
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      }));
      const mod = await import('../../src/services/cognitoUser.service.js');

      await mod.deleteCognitoUser('user@example.com');
      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  describe('updateCognitoUser', () => {
    let updateCognitoUser: typeof import('../../src/services/cognitoUser.service.js').updateCognitoUser;

    beforeEach(async () => {
      process.env['DEV_AUTH_BYPASS'] = 'false';
      vi.resetModules();
      vi.doMock('@aws-sdk/client-cognito-identity-provider', async () => {
        const actual = await vi.importActual('@aws-sdk/client-cognito-identity-provider');
        return {
          ...actual,
          CognitoIdentityProviderClient: vi.fn().mockImplementation(function () { return {
            send: mockSend,
          }; }),
        };
      });
      vi.doMock('../../src/utils/logger.js', () => ({
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      }));
      const mod = await import('../../src/services/cognitoUser.service.js');
      updateCognitoUser = mod.updateCognitoUser;
    });

    it('updates email with email_verified when email changes', async () => {
      mockSend.mockResolvedValueOnce({});

      await updateCognitoUser('old@example.com', { email: 'new@example.com' });

      const command = mockSend.mock.calls[0][0];
      expect(command).toBeInstanceOf(AdminUpdateUserAttributesCommand);
      expect(command.input.Username).toBe('old@example.com');
      expect(command.input.UserAttributes).toContainEqual({
        Name: 'email',
        Value: 'new@example.com',
      });
      expect(command.input.UserAttributes).toContainEqual({
        Name: 'email_verified',
        Value: 'true',
      });
    });

    it('updates given_name when firstName changes', async () => {
      mockSend.mockResolvedValueOnce({});

      await updateCognitoUser('user@example.com', { firstName: 'Updated' });

      const command = mockSend.mock.calls[0][0];
      expect(command.input.UserAttributes).toContainEqual({
        Name: 'given_name',
        Value: 'Updated',
      });
    });

    it('updates family_name when lastName changes', async () => {
      mockSend.mockResolvedValueOnce({});

      await updateCognitoUser('user@example.com', { lastName: 'NewLast' });

      const command = mockSend.mock.calls[0][0];
      expect(command.input.UserAttributes).toContainEqual({
        Name: 'family_name',
        Value: 'NewLast',
      });
    });

    it('updates multiple attributes at once', async () => {
      mockSend.mockResolvedValueOnce({});

      await updateCognitoUser('user@example.com', {
        email: 'new@example.com',
        firstName: 'New',
        lastName: 'Name',
      });

      const command = mockSend.mock.calls[0][0];
      expect(command.input.UserAttributes).toHaveLength(4); // email, email_verified, given_name, family_name
    });

    it('skips Cognito call when no attributes to update', async () => {
      await updateCognitoUser('user@example.com', {});

      expect(mockSend).not.toHaveBeenCalled();
    });

    it('skips Cognito call in dev bypass mode', async () => {
      process.env['DEV_AUTH_BYPASS'] = 'true';
      vi.resetModules();
      vi.doMock('@aws-sdk/client-cognito-identity-provider', async () => {
        const actual = await vi.importActual('@aws-sdk/client-cognito-identity-provider');
        return {
          ...actual,
          CognitoIdentityProviderClient: vi.fn().mockImplementation(function () { return {
            send: mockSend,
          }; }),
        };
      });
      vi.doMock('../../src/utils/logger.js', () => ({
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      }));
      const mod = await import('../../src/services/cognitoUser.service.js');

      await mod.updateCognitoUser('user@example.com', { email: 'new@example.com' });
      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  describe('setCognitoUserPassword', () => {
    let setCognitoUserPassword: typeof import('../../src/services/cognitoUser.service.js').setCognitoUserPassword;

    beforeEach(async () => {
      process.env['DEV_AUTH_BYPASS'] = 'false';
      vi.resetModules();
      vi.doMock('@aws-sdk/client-cognito-identity-provider', async () => {
        const actual = await vi.importActual('@aws-sdk/client-cognito-identity-provider');
        return {
          ...actual,
          CognitoIdentityProviderClient: vi.fn().mockImplementation(function () { return {
            send: mockSend,
          }; }),
        };
      });
      vi.doMock('../../src/utils/logger.js', () => ({
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      }));
      const mod = await import('../../src/services/cognitoUser.service.js');
      setCognitoUserPassword = mod.setCognitoUserPassword;
    });

    it('sets a permanent password by default', async () => {
      mockSend.mockResolvedValueOnce({});

      await setCognitoUserPassword('user@example.com', 'NewPass123!@');

      const command = mockSend.mock.calls[0][0];
      expect(command).toBeInstanceOf(AdminSetUserPasswordCommand);
      expect(command.input.Username).toBe('user@example.com');
      expect(command.input.Password).toBe('NewPass123!@');
      expect(command.input.Permanent).toBe(true);
    });

    it('sets a temporary password when permanent is false', async () => {
      mockSend.mockResolvedValueOnce({});

      await setCognitoUserPassword('user@example.com', 'TempPass!1', false);

      const command = mockSend.mock.calls[0][0];
      expect(command.input.Permanent).toBe(false);
    });

    it('skips Cognito call in dev bypass mode', async () => {
      process.env['DEV_AUTH_BYPASS'] = 'true';
      vi.resetModules();
      vi.doMock('@aws-sdk/client-cognito-identity-provider', async () => {
        const actual = await vi.importActual('@aws-sdk/client-cognito-identity-provider');
        return {
          ...actual,
          CognitoIdentityProviderClient: vi.fn().mockImplementation(function () { return {
            send: mockSend,
          }; }),
        };
      });
      vi.doMock('../../src/utils/logger.js', () => ({
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      }));
      const mod = await import('../../src/services/cognitoUser.service.js');

      await mod.setCognitoUserPassword('user@example.com', 'Pass123!@');
      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  describe('getUserPoolId', () => {
    it('throws when COGNITO_USER_POOL_ID is not set', async () => {
      const originalPoolId = process.env['COGNITO_USER_POOL_ID'];
      delete process.env['COGNITO_USER_POOL_ID'];

      vi.resetModules();
      vi.doMock('@aws-sdk/client-cognito-identity-provider', async () => {
        const actual = await vi.importActual('@aws-sdk/client-cognito-identity-provider');
        return {
          ...actual,
          CognitoIdentityProviderClient: vi.fn().mockImplementation(function () { return {
            send: mockSend,
          }; }),
        };
      });
      vi.doMock('../../src/utils/logger.js', () => ({
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      }));
      process.env['DEV_AUTH_BYPASS'] = 'false';
      const mod = await import('../../src/services/cognitoUser.service.js');

      await expect(
        mod.createCognitoUser({
          email: 'test@example.com',
          firstName: 'Test',
          lastName: 'User',
        })
      ).rejects.toThrow('COGNITO_USER_POOL_ID not configured');

      process.env['COGNITO_USER_POOL_ID'] = originalPoolId;
    });
  });
});

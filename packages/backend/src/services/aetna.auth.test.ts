import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

vi.hoisted(() => {
  process.env['AETNA_CLIENT_ID'] = 'test-client-id';
  process.env['AETNA_CLIENT_SECRET'] = 'test-secret';
  process.env['AETNA_FHIR_BASE_URL'] = 'https://fhir.aetna.test';
  delete process.env['AETNA_TOKEN_URL'];
});

describe('AetnaAuthService', () => {
  let aetnaAuth: typeof import('./aetna.auth.js')['aetnaAuth'];

  beforeEach(async () => {
    vi.resetAllMocks();
    vi.resetModules();

    process.env['AETNA_CLIENT_ID'] = 'test-client-id';
    process.env['AETNA_CLIENT_SECRET'] = 'test-secret';
    process.env['AETNA_FHIR_BASE_URL'] = 'https://fhir.aetna.test';
    delete process.env['AETNA_TOKEN_URL'];

    const mod = await import('./aetna.auth.js');
    aetnaAuth = mod.aetnaAuth;
  });

  describe('isConfigured', () => {
    it('returns true when all env vars are set', () => {
      expect(aetnaAuth.isConfigured()).toBe(true);
    });

    it('returns false when env vars are missing', async () => {
      vi.resetModules();
      delete process.env['AETNA_CLIENT_ID'];
      delete process.env['AETNA_CLIENT_SECRET'];
      delete process.env['AETNA_FHIR_BASE_URL'];

      const mod = await import('./aetna.auth.js');
      expect(mod.aetnaAuth.isConfigured()).toBe(false);
    });
  });

  describe('getBaseUrl', () => {
    it('returns the configured base URL', () => {
      expect(aetnaAuth.getBaseUrl()).toBe('https://fhir.aetna.test');
    });
  });

  describe('token URL', () => {
    it('uses default token URL when AETNA_TOKEN_URL is not set', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'tok', expires_in: 3600 }),
      });

      await aetnaAuth.getAccessToken();

      expect(mockFetch).toHaveBeenCalledWith(
        'https://fhir.aetna.test/fhirserver_auth/oauth2/token',
        expect.anything(),
      );
    });

    it('uses custom token URL when AETNA_TOKEN_URL is set', async () => {
      vi.resetModules();
      process.env['AETNA_TOKEN_URL'] = 'https://custom.token.url/oauth/token';

      const mod = await import('./aetna.auth.js');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'tok', expires_in: 3600 }),
      });

      await mod.aetnaAuth.getAccessToken();

      expect(mockFetch).toHaveBeenCalledWith(
        'https://custom.token.url/oauth/token',
        expect.anything(),
      );
    });
  });

  describe('getAccessToken', () => {
    it('throws when not configured', async () => {
      vi.resetModules();
      delete process.env['AETNA_CLIENT_ID'];
      delete process.env['AETNA_CLIENT_SECRET'];
      delete process.env['AETNA_FHIR_BASE_URL'];

      const mod = await import('./aetna.auth.js');

      await expect(mod.aetnaAuth.getAccessToken()).rejects.toThrow(
        'Aetna auth service not configured',
      );
    });

    it('returns access token on success', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'tok123', expires_in: 3600 }),
      });

      const token = await aetnaAuth.getAccessToken();
      expect(token).toBe('tok123');
    });

    it('sends correct Content-Type header', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'tok', expires_in: 3600 }),
      });

      await aetnaAuth.getAccessToken();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        }),
      );
    });

    it('sends grant_type=client_credentials and credentials in body', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'tok', expires_in: 3600 }),
      });

      await aetnaAuth.getAccessToken();

      const callArgs = mockFetch.mock.calls[0];
      const body = callArgs[1].body as string;
      const params = new URLSearchParams(body);

      expect(params.get('grant_type')).toBe('client_credentials');
      expect(params.get('client_id')).toBe('test-client-id');
      expect(params.get('client_secret')).toBe('test-secret');
    });

    it('returns cached token on second call', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'cached-tok', expires_in: 3600 }),
      });

      const first = await aetnaAuth.getAccessToken();
      const second = await aetnaAuth.getAccessToken();

      expect(first).toBe('cached-tok');
      expect(second).toBe('cached-tok');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('fetches new token when cached token is expired', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'first-tok', expires_in: 1 }),
      });

      await aetnaAuth.getAccessToken();

      // The token expires_in=1 with 60s buffer means tokenExpiresAt is in the past
      // (1 - 60) * 1000 = -59000ms from now, so it's already expired

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'second-tok', expires_in: 3600 }),
      });

      const token = await aetnaAuth.getAccessToken();
      expect(token).toBe('second-tok');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('throws on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      });

      await expect(aetnaAuth.getAccessToken()).rejects.toThrow(
        'Aetna token request failed: 401',
      );
    });

    it('throws on 500 server error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      await expect(aetnaAuth.getAccessToken()).rejects.toThrow(
        'Aetna token request failed: 500',
      );
    });

    it('does not re-fetch when token is still valid', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'valid-tok', expires_in: 7200 }),
      });

      await aetnaAuth.getAccessToken();
      await aetnaAuth.getAccessToken();
      await aetnaAuth.getAccessToken();

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('uses POST method', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'tok', expires_in: 3600 }),
      });

      await aetnaAuth.getAccessToken();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });
});

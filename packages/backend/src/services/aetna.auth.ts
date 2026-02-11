import { logger } from '../utils/logger.js';

class AetnaAuthService {
  private configured = false;
  private clientId: string = '';
  private clientSecret: string = '';
  private tokenUrl: string = '';
  private baseUrl: string = '';
  private cachedToken: string | null = null;
  private tokenExpiresAt: number = 0;

  constructor() {
    this.initialize();
  }

  private initialize(): void {
    const clientId = process.env['AETNA_CLIENT_ID'];
    const clientSecret = process.env['AETNA_CLIENT_SECRET'];
    const baseUrl = process.env['AETNA_FHIR_BASE_URL'];

    if (!clientId || !clientSecret || !baseUrl) {
      logger.info('[AetnaAuth] Not configured. Set AETNA_CLIENT_ID, AETNA_CLIENT_SECRET, and AETNA_FHIR_BASE_URL to enable.');
      return;
    }

    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.baseUrl = baseUrl;
    this.tokenUrl = process.env['AETNA_TOKEN_URL'] || `${baseUrl}/fhirserver_auth/oauth2/token`;
    this.configured = true;
    logger.info(`[AetnaAuth] Configured (base: ${baseUrl})`);
  }

  isConfigured(): boolean {
    return this.configured;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  async getAccessToken(): Promise<string> {
    if (!this.configured) {
      throw new Error('Aetna auth service not configured');
    }

    // Return cached token if still valid (with 60s buffer)
    if (this.cachedToken && Date.now() < this.tokenExpiresAt) {
      return this.cachedToken;
    }

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });

    const response = await fetch(this.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`[AetnaAuth] Token request failed: ${response.status} ${errorText}`);
      throw new Error(`Aetna token request failed: ${response.status}`);
    }

    const data = await response.json() as { access_token: string; expires_in: number };
    this.cachedToken = data.access_token;
    // Subtract 60s buffer from expiry
    this.tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;

    return this.cachedToken;
  }
}

export const aetnaAuth = new AetnaAuthService();

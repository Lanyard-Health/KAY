/// <reference lib="dom" />
import puppeteer, { Browser, Page } from 'puppeteer';
import { logger } from '../utils/logger.js';
import { prisma } from '../utils/prisma.js';
import { encrypt, decrypt } from '../utils/crypto.js';

const CAQH_PROVIEW_LOGIN_URL = 'https://proview.caqh.org/Login';

// Concurrency guard — only 1 browser instance at a time, queue up to 3
let activeBrowser = false;
const waitQueue: Array<{ resolve: () => void; reject: (err: Error) => void }> = [];
const MAX_QUEUE_DEPTH = 3;
const QUEUE_TIMEOUT_MS = 60000;

async function acquireBrowserLock(): Promise<void> {
  if (!activeBrowser) {
    activeBrowser = true;
    return;
  }

  if (waitQueue.length >= MAX_QUEUE_DEPTH) {
    throw new Error('Credential verification busy, try again later');
  }

  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      const idx = waitQueue.findIndex((w) => w.resolve === resolve);
      if (idx !== -1) waitQueue.splice(idx, 1);
      reject(new Error('Credential verification timed out waiting for availability'));
    }, QUEUE_TIMEOUT_MS);

    waitQueue.push({
      resolve: () => { clearTimeout(timer); resolve(); },
      reject: (err: Error) => { clearTimeout(timer); reject(err); },
    });
  });
}

function releaseBrowserLock(): void {
  if (waitQueue.length > 0) {
    const next = waitQueue.shift()!;
    next.resolve();
  } else {
    activeBrowser = false;
  }
}

export interface CredentialVerificationResult {
  success: boolean;
  valid: boolean;
  message: string;
  errorType?: 'invalid_credentials' | 'account_locked' | 'mfa_required' | 'timeout' | 'network_error' | 'unknown';
  details?: string;
}

export class CaqhCredentialsService {
  private browser: Browser | null = null;

  /**
   * Verify CAQH ProView login credentials for a provider
   * Uses headless browser automation to test the login
   */
  async verifyCredentials(
    username: string,
    password: string
  ): Promise<CredentialVerificationResult> {
    await acquireBrowserLock();
    let page: Page | null = null;

    try {
      // Launch browser in headless mode
      this.browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
        ],
      });

      page = await this.browser.newPage();

      // Set realistic viewport and user agent
      await page.setViewport({ width: 1280, height: 720 });
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );

      // Navigate to CAQH ProView login page
      logger.info('Navigating to CAQH ProView login page');
      await page.goto(CAQH_PROVIEW_LOGIN_URL, {
        waitUntil: 'networkidle2',
        timeout: 30000,
      });

      // Wait for login form to be present
      await page.waitForSelector('input[type="text"], input[name="username"], #username', {
        timeout: 10000,
      });

      // Find and fill username field
      const usernameSelector = await this.findUsernameField(page);
      if (!usernameSelector) {
        return {
          success: false,
          valid: false,
          message: 'Could not locate username field on login page',
          errorType: 'unknown',
        };
      }

      await page.type(usernameSelector, username, { delay: 50 });

      // Find and fill password field
      const passwordSelector = await this.findPasswordField(page);
      if (!passwordSelector) {
        return {
          success: false,
          valid: false,
          message: 'Could not locate password field on login page',
          errorType: 'unknown',
        };
      }

      await page.type(passwordSelector, password, { delay: 50 });

      // Find and click login button
      const loginButtonSelector = await this.findLoginButton(page);
      if (!loginButtonSelector) {
        return {
          success: false,
          valid: false,
          message: 'Could not locate login button on login page',
          errorType: 'unknown',
        };
      }

      // Click login and wait for navigation or error message
      await Promise.all([
        page.click(loginButtonSelector),
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => null),
      ]);

      // Wait a moment for any error messages to appear
      await this.delay(2000);

      // Check the result of the login attempt
      return await this.checkLoginResult(page);
    } catch (error) {
      logger.error('CAQH credential verification error:', error);

      if (error instanceof Error) {
        if (error.message.includes('timeout') || error.message.includes('Timeout')) {
          return {
            success: false,
            valid: false,
            message: 'Login verification timed out',
            errorType: 'timeout',
            details: error.message,
          };
        }
        if (error.message.includes('net::') || error.message.includes('Network')) {
          return {
            success: false,
            valid: false,
            message: 'Network error connecting to CAQH',
            errorType: 'network_error',
            details: error.message,
          };
        }
      }

      return {
        success: false,
        valid: false,
        message: 'Failed to verify credentials',
        errorType: 'unknown',
        details: error instanceof Error ? error.message : 'Unknown error',
      };
    } finally {
      if (this.browser) {
        await this.browser.close();
        this.browser = null;
      }
      releaseBrowserLock();
    }
  }

  /**
   * Verify credentials and update the provider record
   */
  async verifyAndUpdateProvider(providerId: string): Promise<CredentialVerificationResult> {
    const provider = await prisma.provider.findUnique({
      where: { id: providerId },
      select: {
        id: true,
        caqhUsername: true,
        caqhPassword: true,
        firstName: true,
        lastName: true,
      },
    });

    if (!provider) {
      return {
        success: false,
        valid: false,
        message: 'Provider not found',
        errorType: 'unknown',
      };
    }

    if (!provider.caqhUsername || !provider.caqhPassword) {
      return {
        success: false,
        valid: false,
        message: 'CAQH credentials not configured for this provider',
        errorType: 'unknown',
      };
    }

    logger.info(`Verifying CAQH credentials for provider: ${provider.firstName} ${provider.lastName}`);

    // Decrypt password before verification
    let decryptedPassword: string;
    try {
      decryptedPassword = decrypt(provider.caqhPassword);
    } catch {
      // Handle legacy unencrypted passwords
      decryptedPassword = provider.caqhPassword;
      logger.warn(`Provider ${providerId} has unencrypted CAQH password — re-encrypting`);
      await this.saveCredentials(providerId, provider.caqhUsername, provider.caqhPassword);
    }

    const result = await this.verifyCredentials(
      provider.caqhUsername,
      decryptedPassword
    );

    // Update the provider record with verification result
    await prisma.provider.update({
      where: { id: providerId },
      data: {
        caqhCredentialsValid: result.errorType === 'mfa_required' ? null : result.valid,
        caqhCredentialsLastChecked: new Date(),
      },
    });

    return result;
  }

  /**
   * Save CAQH credentials for a provider
   */
  async saveCredentials(
    providerId: string,
    username: string,
    password: string
  ): Promise<void> {
    await prisma.provider.update({
      where: { id: providerId },
      data: {
        caqhUsername: username,
        caqhPassword: encrypt(password),
        caqhCredentialsValid: null,
        caqhCredentialsLastChecked: null,
      },
    });
  }

  /**
   * Get credential status for a provider
   */
  async getCredentialStatus(providerId: string): Promise<{
    hasCredentials: boolean;
    isValid: boolean | null;
    lastChecked: Date | null;
    username: string | null;
    caqhProviderId: string | null;
    caqhStatus: string | null;
    caqhLastSync: Date | null;
  }> {
    const provider = await prisma.provider.findUnique({
      where: { id: providerId },
      select: {
        caqhUsername: true,
        caqhCredentialsValid: true,
        caqhCredentialsLastChecked: true,
        caqhProviderId: true,
        caqhStatus: true,
        caqhLastSync: true,
      },
    });

    if (!provider) {
      throw new Error('Provider not found');
    }

    return {
      hasCredentials: !!provider.caqhUsername,
      isValid: provider.caqhCredentialsValid,
      lastChecked: provider.caqhCredentialsLastChecked,
      username: provider.caqhUsername,
      caqhProviderId: provider.caqhProviderId,
      caqhStatus: provider.caqhStatus,
      caqhLastSync: provider.caqhLastSync,
    };
  }

  // Helper methods

  private async findUsernameField(page: Page): Promise<string | null> {
    const selectors = [
      'input[name="username"]',
      'input[id="username"]',
      'input[name="userName"]',
      'input[id="userName"]',
      'input[type="text"][autocomplete="username"]',
      'input[type="email"]',
      'input[type="text"]:first-of-type',
    ];

    for (const selector of selectors) {
      try {
        const element = await page.$(selector);
        if (element) {
          return selector;
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  private async findPasswordField(page: Page): Promise<string | null> {
    const selectors = [
      'input[type="password"]',
      'input[name="password"]',
      'input[id="password"]',
    ];

    for (const selector of selectors) {
      try {
        const element = await page.$(selector);
        if (element) {
          return selector;
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  private async findLoginButton(page: Page): Promise<string | null> {
    const selectors = [
      'button[type="submit"]',
      'input[type="submit"]',
      'button:contains("Sign In")',
      'button:contains("Login")',
      'button:contains("Log In")',
      '#loginButton',
      '.login-button',
      'button.btn-primary',
    ];

    for (const selector of selectors) {
      try {
        // Handle :contains() pseudo-selector manually
        if (selector.includes(':contains(')) {
          const buttonText = selector.match(/:contains\("(.+?)"\)/)?.[1];
          if (buttonText) {
            const buttons = await page.$$('button');
            for (const button of buttons) {
              const text = await page.evaluate((el) => el.textContent, button);
              if (text?.toLowerCase().includes(buttonText.toLowerCase())) {
                // Return a unique selector for this button
                const buttonSelector = await page.evaluate((el) => {
                  if (el.id) return `#${el.id}`;
                  if (el.className) return `button.${el.className.split(' ').join('.')}`;
                  return 'button[type="submit"]';
                }, button);
                return buttonSelector;
              }
            }
          }
          continue;
        }

        const element = await page.$(selector);
        if (element) {
          return selector;
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  private async checkLoginResult(page: Page): Promise<CredentialVerificationResult> {
    const currentUrl = page.url();
    const pageText = await page.evaluate(() => {
      // This runs in browser context where document is available
      return (globalThis as any).document.body.innerText;
    });

    logger.info(`CAQH login check - URL: ${currentUrl}`);
    logger.info(`CAQH login check - Page text length: ${pageText.length}`);

    // Check for error messages indicating invalid credentials (check FIRST)
    const invalidCredentialPatterns = [
      /invalid (username|password|credentials)/i,
      /incorrect (username|password|credentials)/i,
      /login failed/i,
      /authentication failed/i,
      /unable to (log|sign) (in|on)/i,
      /user(name)? (not found|does not exist)/i,
      /wrong password/i,
      /the username or password you entered is incorrect/i,
      /login unsuccessful/i,
      /we couldn't verify your identity/i,
      /please check your credentials/i,
      /error.*logging in/i,
      /sign.?in error/i,
    ];

    for (const pattern of invalidCredentialPatterns) {
      if (pattern.test(pageText)) {
        logger.info(`CAQH login failed - matched pattern: ${pattern}`);
        return {
          success: true,
          valid: false,
          message: 'Invalid credentials',
          errorType: 'invalid_credentials',
        };
      }
    }

    // Check for account locked messages
    const lockedPatterns = [
      /account (is )?(locked|disabled|suspended)/i,
      /too many (failed )?(attempts|tries)/i,
      /temporarily (locked|disabled)/i,
    ];

    for (const pattern of lockedPatterns) {
      if (pattern.test(pageText)) {
        logger.info(`CAQH account locked - matched pattern: ${pattern}`);
        return {
          success: true,
          valid: false,
          message: 'Account is locked',
          errorType: 'account_locked',
        };
      }
    }

    // Check for MFA/2FA requirements
    const mfaPatterns = [
      /verification code/i,
      /two-factor/i,
      /2fa/i,
      /multi-factor/i,
      /security code/i,
      /one-time (password|code)/i,
      /enter.*code/i,
      /we sent.*code/i,
    ];

    for (const pattern of mfaPatterns) {
      if (pattern.test(pageText)) {
        logger.info(`CAQH MFA required - matched pattern: ${pattern}`);
        return {
          success: true,
          valid: false,  // Changed from true — MFA means not fully verified
          message: 'MFA required — credentials not fully verified',
          errorType: 'mfa_required',
        };
      }
    }

    // Check for successful login indicators
    const successIndicators = [
      '/dashboard',
      '/home',
      '/provider',
      '/profile',
      '/attestation',
      '/PR',  // CAQH ProView provider area
      '/pr',
    ];

    for (const indicator of successIndicators) {
      if (currentUrl.toLowerCase().includes(indicator.toLowerCase())) {
        logger.info(`CAQH login successful - URL contains: ${indicator}`);
        return {
          success: true,
          valid: true,
          message: 'Credentials verified successfully',
        };
      }
    }

    // Check page text for success indicators (logged in state)
    const successTextPatterns = [
      /welcome.*back/i,
      /my profile/i,
      /my attestation/i,
      /logout/i,
      /sign out/i,
    ];

    for (const pattern of successTextPatterns) {
      if (pattern.test(pageText)) {
        logger.info(`CAQH login successful - page contains: ${pattern}`);
        return {
          success: true,
          valid: true,
          message: 'Credentials verified successfully',
        };
      }
    }

    // If we're still on the login page after attempting login, credentials are likely invalid
    if (currentUrl.includes('login') || currentUrl.includes('Login') || currentUrl.includes('signin') || currentUrl.includes('SignIn')) {
      // Check if there are any error elements visible
      const hasErrorElements = await page.evaluate(() => {
        // This runs in browser context where document is available
        const doc = (globalThis as any).document;
        const errorSelectors = [
          '.error', '.alert-danger', '.alert-error', '[role="alert"]',
          '.validation-error', '.error-message', '.login-error',
          '[class*="error"]', '[class*="invalid"]'
        ];
        for (const selector of errorSelectors) {
          const el = doc.querySelector(selector);
          if (el && el.textContent && el.textContent.trim().length > 0) {
            return el.textContent.trim();
          }
        }
        return null;
      });

      if (hasErrorElements) {
        logger.info(`CAQH login failed - error element found: ${hasErrorElements}`);
        return {
          success: true,
          valid: false,
          message: 'Invalid credentials',
          errorType: 'invalid_credentials',
          details: hasErrorElements,
        };
      }

      // Still on login page but no visible error - likely invalid
      logger.info('CAQH login - still on login page, assuming invalid credentials');
      return {
        success: true,
        valid: false,
        message: 'Login attempt did not succeed - credentials may be invalid',
        errorType: 'invalid_credentials',
        details: `Still on login page: ${currentUrl}`,
      };
    }

    // Unable to determine result - this is now unlikely to happen
    logger.warn(`CAQH login - unable to determine result, URL: ${currentUrl}`);
    return {
      success: true,
      valid: false,
      message: 'Unable to determine login result',
      errorType: 'unknown',
      details: `Final URL: ${currentUrl}`,
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const caqhCredentialsService = new CaqhCredentialsService();

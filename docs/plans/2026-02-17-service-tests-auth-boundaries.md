# Service Unit Tests + Authorization Boundary Tests — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add unit test coverage for 5 high-risk services (email, caqh, document, expiration, chat) and route-level authorization boundary tests for cross-practice isolation + provider self-scope.

**Architecture:** Co-located unit tests next to services (`src/services/<name>.test.ts`) using Vitest v4 + vitest-mock-extended. Auth boundary tests in `tests/authorization-boundaries.test.ts` using `createTestApp` + supertest through real route middleware chains.

**Tech Stack:** Vitest v4, vitest-mock-extended, supertest, vi.mock for AWS SDKs + Prisma + fetch

---

## Critical Context

### Project paths
- Backend root: `/Users/kay/Documents/KAY/packages/backend/`
- Services: `src/services/`
- Test helpers: `tests/helpers/` (mock-prisma.ts, mock-express.ts, test-app.ts, fixtures.ts)

### Mock patterns (from CLAUDE.md)

**Prisma mock (every test file needs this):**
```typescript
vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
});
```

**Logger mock (silence logs in tests):**
```typescript
vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
```

### Vitest v4 gotchas
- Constructor mocks must use `function()` not arrow `() =>`
- `vi.clearAllMocks()` does NOT reset implementations — use `vi.resetAllMocks()`
- Env vars read at import time need `vi.hoisted()` to override before module load

### Run tests
```bash
cd /Users/kay/Documents/KAY/packages/backend
npx vitest run src/services/email.service.test.ts   # single file
npx vitest run                                       # all tests
```

---

## Task 1: email.service.test.ts

**Files:**
- Create: `src/services/email.service.test.ts`
- Reference: `src/services/email.service.ts`

**Why this is tricky:** `EmailService` is a class instantiated at module scope (`export const emailService = new EmailService()`). The constructor reads env vars and creates an SES client. We must use `vi.hoisted()` to set env vars before import, and mock the SES SDK at module level.

### Step 1: Write the test file

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Must set env vars before module evaluates
const mockSend = vi.hoisted(() => {
  process.env['SES_FROM_EMAIL'] = 'test@lanyard.com';
  process.env['AWS_ACCESS_KEY_ID'] = 'test-key';
  process.env['AWS_SECRET_ACCESS_KEY'] = 'test-secret';
  process.env['AWS_SES_REGION'] = 'us-east-1';
  return vi.fn();
});

vi.mock('@aws-sdk/client-ses', () => {
  return {
    SESClient: function() { this.send = mockSend; },
    SendRawEmailCommand: function(params: any) { this.params = params; },
  };
});

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { emailService } from './email.service.js';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.notification.create.mockResolvedValue({} as any);
});

describe('EmailService', () => {
  describe('isConfigured', () => {
    it('returns true when env vars are set', () => {
      expect(emailService.isConfigured()).toBe(true);
    });
  });

  describe('getConfig', () => {
    it('returns SES config when configured', () => {
      const config = emailService.getConfig();
      expect(config).toEqual({
        host: 'ses',
        port: 443,
        user: 'test@lanyard.com',
      });
    });
  });

  describe('verifyConnection', () => {
    it('returns success when configured', async () => {
      const result = await emailService.verifyConnection();
      expect(result).toEqual({ success: true });
    });
  });

  describe('sendEmail', () => {
    it('sends raw MIME via SES and logs notification on success', async () => {
      mockSend.mockResolvedValue({ MessageId: 'msg-123' });

      const result = await emailService.sendEmail({
        to: 'user@example.com',
        subject: 'Test Subject',
        html: '<p>Hello</p>',
      });

      expect(result).toEqual({ success: true, messageId: 'msg-123' });
      expect(mockSend).toHaveBeenCalledOnce();
      expect(prismaMock.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            recipientEmail: 'user@example.com',
            status: 'sent',
          }),
        }),
      );
    });

    it('logs failed notification on SES error', async () => {
      mockSend.mockRejectedValue(new Error('SES rate limit'));

      const result = await emailService.sendEmail({
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>Test</p>',
      });

      expect(result).toEqual({ success: false, error: 'SES rate limit' });
      expect(prismaMock.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'failed',
            errorMessage: 'SES rate limit',
          }),
        }),
      );
    });

    it('strips CRLF from to and subject headers (injection prevention)', async () => {
      mockSend.mockResolvedValue({ MessageId: 'msg-456' });

      await emailService.sendEmail({
        to: "evil@test.com\r\nBcc: attacker@evil.com",
        subject: "Normal\r\nBcc: attacker@evil.com",
        html: '<p>Hello</p>',
      });

      // Inspect the raw message sent to SES
      const sendCall = mockSend.mock.calls[0]![0];
      const rawData = Buffer.from(sendCall.params.RawMessage.Data).toString();
      expect(rawData).not.toContain('\r\nBcc:');
      expect(rawData).toContain('evil@test.comBcc: attacker@evil.com');
    });

    it('includes base64 attachments in MIME message', async () => {
      mockSend.mockResolvedValue({ MessageId: 'msg-789' });

      await emailService.sendEmail({
        to: 'user@example.com',
        subject: 'With Attachment',
        html: '<p>See attached</p>',
        attachments: [{
          filename: 'report.pdf',
          content: Buffer.from('fake-pdf-content'),
          contentType: 'application/pdf',
        }],
      });

      const sendCall = mockSend.mock.calls[0]![0];
      const rawData = Buffer.from(sendCall.params.RawMessage.Data).toString();
      expect(rawData).toContain('Content-Disposition: attachment; filename="report.pdf"');
      expect(rawData).toContain('Content-Transfer-Encoding: base64');
      expect(rawData).toContain(Buffer.from('fake-pdf-content').toString('base64'));
    });

    it('generates plain text from HTML when text not provided', async () => {
      mockSend.mockResolvedValue({ MessageId: 'msg-000' });

      await emailService.sendEmail({
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>Hello <b>World</b></p>',
      });

      const sendCall = mockSend.mock.calls[0]![0];
      const rawData = Buffer.from(sendCall.params.RawMessage.Data).toString();
      // The text/plain part should have tags stripped
      expect(rawData).toContain('Hello World');
    });
  });

  describe('sendTestEmail', () => {
    it('delegates to sendEmail with test template', async () => {
      mockSend.mockResolvedValue({ MessageId: 'test-msg' });

      const result = await emailService.sendTestEmail('test@example.com');

      expect(result.success).toBe(true);
      expect(mockSend).toHaveBeenCalledOnce();
      // Verify the raw message contains the test email content
      const sendCall = mockSend.mock.calls[0]![0];
      const rawData = Buffer.from(sendCall.params.RawMessage.Data).toString();
      expect(rawData).toContain('Test Email Successful');
      expect(rawData).toContain('test@example.com');
    });
  });
});
```

### Step 2: Run test to verify it passes

```bash
cd /Users/kay/Documents/KAY/packages/backend && npx vitest run src/services/email.service.test.ts
```

Expected: All tests PASS

### Step 3: Commit

```bash
git add src/services/email.service.test.ts
git commit -m "test: add email.service unit tests (SES, MIME, header injection)"
```

---

## Task 2: caqh.service.test.ts

**Files:**
- Create: `src/services/caqh.service.test.ts`
- Reference: `src/services/caqh.service.ts`

**Why this is tricky:** `CaqhService` reads env vars in constructor. The `request()` method uses global `fetch` with `AbortController` and exponential backoff. We mock `fetch` globally and use `vi.useFakeTimers()` for backoff tests.

### Step 1: Write the test file

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.hoisted(() => {
  process.env['CAQH_API_URL'] = 'https://caqh.test.com';
  process.env['CAQH_ORG_ID'] = 'org-123';
  process.env['CAQH_API_KEY'] = 'key-abc';
});

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { CaqhService } from './caqh.service.js';
import type { CaqhCredentialsResponse } from './caqh.service.js';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';

let service: CaqhService;

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  service = new CaqhService();
});

// ==========================================
// Helpers
// ==========================================

function mockFetchOk(body: unknown) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response);
}

function mockFetchError(status: number, body = 'error') {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: false,
    status,
    text: () => Promise.resolve(body),
  } as Response);
}

// ==========================================
// isConfigured
// ==========================================

describe('CaqhService', () => {
  describe('isConfigured', () => {
    it('returns true when all env vars are set', () => {
      expect(service.isConfigured()).toBe(true);
    });

    it('returns false when env vars are missing', () => {
      const orig = process.env['CAQH_API_URL'];
      process.env['CAQH_API_URL'] = '';
      const s = new CaqhService();
      expect(s.isConfigured()).toBe(false);
      process.env['CAQH_API_URL'] = orig;
    });
  });

  // ==========================================
  // request() retry and error handling
  // ==========================================

  describe('request (via public methods)', () => {
    it('retries on 5xx server errors up to 3 times', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce({ ok: false, status: 500, text: () => Promise.resolve('err') } as Response)
        .mockResolvedValueOnce({ ok: false, status: 502, text: () => Promise.resolve('err') } as Response)
        .mockResolvedValueOnce({ ok: true, status: 200, text: () => Promise.resolve('{"status":"ok"}') } as Response);

      const result = await service.checkStatus('caqh-1');
      expect(fetchSpy).toHaveBeenCalledTimes(3);
      expect(result).toEqual({ status: 'ok' });
    }, 15000);

    it('does not retry on 4xx client errors', async () => {
      const fetchSpy = mockFetchError(404);

      await expect(service.checkStatus('caqh-1')).rejects.toThrow('CAQH API error: 404');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('does not retry non-retryable operations (addToRoster)', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
        .mockResolvedValue({ ok: false, status: 500, text: () => Promise.resolve('err') } as Response);

      await expect(service.addToRoster({
        id: 'p1', npi: '1234567890', firstName: 'Jane', lastName: 'Doe', dateOfBirth: new Date('1985-01-01'),
      })).rejects.toThrow('CAQH API error: 500');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('returns empty object for empty response body', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true, status: 200, text: () => Promise.resolve(''),
      } as Response);

      const result = await service.checkStatus('caqh-1');
      expect(result).toEqual({});
    });

    it('throws on invalid JSON response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true, status: 200, text: () => Promise.resolve('not-json{{{'),
      } as Response);

      await expect(service.checkStatus('caqh-1')).rejects.toThrow('CAQH API returned invalid JSON');
    });

    it('includes auth headers on every request', async () => {
      const fetchSpy = mockFetchOk({ caqhProviderId: 'caqh-1', status: 'active' });

      await service.checkStatus('caqh-1');

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://caqh.test.com/status/caqh-1',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer key-abc',
            'Organization-Id': 'org-123',
          }),
        }),
      );
    });
  });

  // ==========================================
  // Public API methods
  // ==========================================

  describe('addToRoster', () => {
    it('POSTs correct payload', async () => {
      const fetchSpy = mockFetchOk({ caqhProviderId: 'caqh-new', status: 'added' });

      const result = await service.addToRoster({
        id: 'p1', npi: '1234567890', firstName: 'Jane', lastName: 'Doe',
        dateOfBirth: new Date('1985-06-15'),
      });

      expect(result).toEqual({ caqhProviderId: 'caqh-new', status: 'added' });
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://caqh.test.com/roster/add',
        expect.objectContaining({ method: 'POST' }),
      );
      const body = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string);
      expect(body.date_of_birth).toBe('1985-06-15');
    });
  });

  describe('removeFromRoster', () => {
    it('sends DELETE request', async () => {
      const fetchSpy = mockFetchOk({});
      await service.removeFromRoster('caqh-99');
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://caqh.test.com/roster/caqh-99',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });

  // ==========================================
  // mapCaqhToInternal
  // ==========================================

  describe('mapCaqhToInternal', () => {
    const baseCaqhData: CaqhCredentialsResponse = {
      provider: { firstName: 'Jane', lastName: 'Doe', npi: '1234567890' },
      licenses: [{ type: 'MD', number: 'MD-123', state: 'NY', expirationDate: '2027-01-01' }],
      certifications: [{ board: 'American Board of Psychiatry', specialty: 'General Psychiatry', expirationDate: '2027-06-01' }],
      education: [{ institution: 'Harvard Medical', degree: 'MD', graduationDate: '2010-06-01' }],
      malpractice: { carrier: 'PIAA', policyNumber: 'POL-1', expirationDate: '2027-12-01', coverageAmount: 1000000 },
    };

    it('maps known license types correctly', () => {
      const result = service.mapCaqhToInternal(baseCaqhData);
      expect(result.licenses[0]!.licenseType).toBe('state_medical');
    });

    it('maps all license type variants (DO, PSY, SW, LPC, MFT, DEA, CDS)', () => {
      for (const [input, expected] of [
        ['DO', 'state_medical'], ['PSY', 'state_psychology'], ['SW', 'state_social_work'],
        ['LPC', 'state_counseling'], ['MFT', 'state_marriage_family'],
        ['DEA', 'dea'], ['CDS', 'controlled_substance'],
      ] as const) {
        const data = { ...baseCaqhData, licenses: [{ type: input, number: 'N-1', state: 'CA', expirationDate: '2027-01-01' }] };
        const result = service.mapCaqhToInternal(data);
        expect(result.licenses[0]!.licenseType).toBe(expected);
      }
    });

    it('defaults unknown license type to state_medical with warning log', async () => {
      const { logger } = await import('../utils/logger.js');
      const data = { ...baseCaqhData, licenses: [{ type: 'UNKNOWN_TYPE', number: 'X', state: 'TX', expirationDate: '2027-01-01' }] };
      const result = service.mapCaqhToInternal(data, 'provider-1');
      expect(result.licenses[0]!.licenseType).toBe('state_medical');
      expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({
        event: 'caqh_unknown_mapping',
        field: 'licenseType',
        rawValue: 'UNKNOWN_TYPE',
      }));
    });

    it('maps board types via case-insensitive includes', () => {
      const data = {
        ...baseCaqhData,
        certifications: [
          { board: 'American Board of Psychiatry and Neurology', specialty: 'Psychiatry' },
        ],
      };
      const result = service.mapCaqhToInternal(data);
      expect(result.certifications[0]!.boardType).toBe('abpn_psychiatry');
    });

    it('handles missing malpractice (returns empty array)', () => {
      const data = { ...baseCaqhData, malpractice: undefined };
      const result = service.mapCaqhToInternal(data);
      expect(result.malpractice).toEqual([]);
    });

    it('maps degree types correctly', () => {
      for (const [input, expected] of [
        ['MD', 'md'], ['DO', 'do'], ['PhD', 'phd'], ['PsyD', 'psyd'], ['MSW', 'msw'],
      ] as const) {
        const data = { ...baseCaqhData, education: [{ institution: 'Univ', degree: input, graduationDate: '2010-01-01' }] };
        const result = service.mapCaqhToInternal(data);
        expect(result.education[0]!.degree).toBe(expected);
      }
    });
  });

  // ==========================================
  // applyCaqhDataToProvider
  // ==========================================

  describe('applyCaqhDataToProvider', () => {
    it('creates new license when no existing record found', async () => {
      prismaMock.license.findFirst.mockResolvedValue(null);
      prismaMock.license.create.mockResolvedValue({} as any);

      const summary = await service.applyCaqhDataToProvider('p1', {
        provider: { firstName: 'J', lastName: 'D', npi: '123' },
        licenses: [{ licenseType: 'state_medical', licenseNumber: 'MD-1', state: 'NY', expirationDate: new Date('2027-01-01') }],
        certifications: [], education: [], malpractice: [],
      });

      expect(summary.licenses.created).toBe(1);
      expect(prismaMock.license.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            providerId: 'p1',
            licenseNumber: 'MD-1',
            source: 'caqh_sync',
          }),
        }),
      );
    });

    it('updates existing caqh_sync record', async () => {
      prismaMock.license.findFirst.mockResolvedValue({
        id: 'lic-1', source: 'caqh_sync', licenseType: 'state_medical', state: 'NY', expirationDate: new Date(),
      } as any);
      prismaMock.license.update.mockResolvedValue({} as any);

      const summary = await service.applyCaqhDataToProvider('p1', {
        provider: { firstName: 'J', lastName: 'D', npi: '123' },
        licenses: [{ licenseType: 'state_medical', licenseNumber: 'MD-1', state: 'NY', expirationDate: new Date('2027-01-01') }],
        certifications: [], education: [], malpractice: [],
      });

      expect(summary.licenses.updated).toBe(1);
    });

    it('skips manual_entry records', async () => {
      prismaMock.license.findFirst.mockResolvedValue({
        id: 'lic-1', source: 'manual_entry', licenseType: 'state_medical', state: 'NY', expirationDate: new Date(),
      } as any);

      const summary = await service.applyCaqhDataToProvider('p1', {
        provider: { firstName: 'J', lastName: 'D', npi: '123' },
        licenses: [{ licenseType: 'state_medical', licenseNumber: 'MD-1', state: 'NY', expirationDate: new Date('2027-01-01') }],
        certifications: [], education: [], malpractice: [],
      });

      expect(summary.licenses.skipped).toBe(1);
      expect(prismaMock.license.update).not.toHaveBeenCalled();
    });

    it('tracks per-record failures in summary', async () => {
      prismaMock.license.findFirst.mockResolvedValue(null);
      prismaMock.license.create.mockRejectedValue(new Error('DB constraint'));

      const summary = await service.applyCaqhDataToProvider('p1', {
        provider: { firstName: 'J', lastName: 'D', npi: '123' },
        licenses: [{ licenseType: 'state_medical', licenseNumber: 'MD-1', state: 'NY', expirationDate: new Date('2027-01-01') }],
        certifications: [], education: [], malpractice: [],
      });

      expect(summary.licenses.failed).toBe(1);
      expect(summary.failedRecords).toEqual([
        expect.objectContaining({ category: 'license', identifier: 'MD-1', error: 'DB constraint' }),
      ]);
    });

    it('skips malpractice without perClaimAmount', async () => {
      const summary = await service.applyCaqhDataToProvider('p1', {
        provider: { firstName: 'J', lastName: 'D', npi: '123' },
        licenses: [], certifications: [], education: [],
        malpractice: [{ carrierName: 'PIAA', policyNumber: 'POL-1', expirationDate: '2027-01-01' }],
      });

      expect(summary.malpractice.skipped).toBe(1);
      expect(prismaMock.malpracticeInsurance.findFirst).not.toHaveBeenCalled();
    });
  });

  // ==========================================
  // syncProvider
  // ==========================================

  describe('syncProvider', () => {
    it('orchestrates pull → map → apply → log on success', async () => {
      // Mock the sync log lifecycle
      prismaMock.caqhSyncLog.create.mockResolvedValue({ id: 'sync-1' } as any);
      prismaMock.caqhSyncLog.update.mockResolvedValue({} as any);
      prismaMock.provider.update.mockResolvedValue({} as any);

      // Mock fetch for pullCredentials
      mockFetchOk({
        provider: { firstName: 'Jane', lastName: 'Doe', npi: '123' },
        licenses: [], certifications: [], education: [],
      });

      const result = await service.syncProvider('p1', 'caqh-1');

      expect(result.syncId).toBe('sync-1');
      expect(prismaMock.caqhSyncLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'in_progress' }) }),
      );
      expect(prismaMock.caqhSyncLog.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'completed' }) }),
      );
      expect(prismaMock.provider.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'p1' }, data: expect.objectContaining({ caqhLastSync: expect.any(Date) }) }),
      );
    });

    it('logs failure to CaqhSyncLog on error', async () => {
      prismaMock.caqhSyncLog.create.mockResolvedValue({ id: 'sync-2' } as any);
      prismaMock.caqhSyncLog.update.mockResolvedValue({} as any);

      // Make pullCredentials fail
      mockFetchError(500);

      await expect(service.syncProvider('p1', 'caqh-1')).rejects.toThrow();

      expect(prismaMock.caqhSyncLog.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'failed', errorMessage: expect.any(String) }),
        }),
      );
    });
  });
});
```

### Step 2: Run test

```bash
cd /Users/kay/Documents/KAY/packages/backend && npx vitest run src/services/caqh.service.test.ts
```

Expected: All tests PASS

### Step 3: Commit

```bash
git add src/services/caqh.service.test.ts
git commit -m "test: add caqh.service unit tests (retry, mapping, sync pipeline)"
```

---

## Task 3: document.service.test.ts

**Files:**
- Create: `src/services/document.service.test.ts`
- Reference: `src/services/document.service.ts`

**Why this is tricky:** `DocumentService` constructor creates S3 + Textract clients AND calls `ensureBucketExists()` (async). Must mock all AWS SDKs and the `getSignedUrl` helper. Also uses `uuid` for document IDs.

### Step 1: Write the test file

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockS3Send = vi.hoisted(() => {
  process.env['USE_LOCALSTACK'] = 'true';
  process.env['S3_ENDPOINT'] = 'http://localhost:4566';
  process.env['S3_BUCKET_NAME'] = 'test-bucket';
  process.env['AWS_REGION'] = 'us-east-1';
  process.env['AWS_ACCESS_KEY_ID'] = 'test';
  process.env['AWS_SECRET_ACCESS_KEY'] = 'test';
  return vi.fn().mockResolvedValue({});
});

const mockTextractSend = vi.fn().mockResolvedValue({});
const mockGetSignedUrl = vi.fn().mockResolvedValue('https://signed-url.example.com');
const mockUuid = vi.fn().mockReturnValue('doc-uuid-123');

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: function() { this.send = mockS3Send; },
  PutObjectCommand: function(p: any) { this.input = p; },
  GetObjectCommand: function(p: any) { this.input = p; },
  DeleteObjectCommand: function(p: any) { this.input = p; },
  HeadBucketCommand: function(p: any) { this.input = p; },
  CreateBucketCommand: function(p: any) { this.input = p; },
  PutBucketCorsCommand: function(p: any) { this.input = p; },
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: mockGetSignedUrl,
}));

vi.mock('@aws-sdk/client-textract', () => ({
  TextractClient: function() { this.send = mockTextractSend; },
  StartDocumentAnalysisCommand: function(p: any) { this.input = p; },
  GetDocumentAnalysisCommand: function(p: any) { this.input = p; },
}));

vi.mock('uuid', () => ({ v4: mockUuid }));

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { DocumentService } from './document.service.js';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';

let service: DocumentService;

beforeEach(() => {
  vi.clearAllMocks();
  service = new DocumentService();
});

describe('DocumentService', () => {
  describe('getUploadUrl', () => {
    it('creates document record and returns pre-signed URL', async () => {
      prismaMock.document.create.mockResolvedValue({ id: 'doc-uuid-123' } as any);

      const result = await service.getUploadUrl(
        { providerId: 'p1', fileName: 'license.pdf', contentType: 'application/pdf', documentType: 'license' },
        'user-1',
      );

      expect(result.documentId).toBe('doc-uuid-123');
      expect(result.uploadUrl).toBe('https://signed-url.example.com');
      expect(result.s3Key).toContain('documents/p1/doc-uuid-123.pdf');
      expect(prismaMock.document.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            id: 'doc-uuid-123',
            providerId: 'p1',
            documentType: 'license',
            createdById: 'user-1',
          }),
        }),
      );
    });

    it('sanitizes file extension (strips non-alphanumeric)', async () => {
      prismaMock.document.create.mockResolvedValue({ id: 'doc-uuid-123' } as any);

      const result = await service.getUploadUrl(
        { providerId: 'p1', fileName: 'test.p@d$f', contentType: 'application/pdf', documentType: 'license' },
        'user-1',
      );

      expect(result.s3Key).toContain('.pdf');
      expect(result.s3Key).not.toContain('@');
    });
  });

  describe('confirmUpload', () => {
    it('updates fileSize from S3 response', async () => {
      prismaMock.document.findUnique.mockResolvedValue({
        id: 'doc-1', providerId: 'p1', s3Key: 'documents/p1/doc-1.pdf',
        mimeType: 'text/plain', documentType: 'other',
      } as any);
      mockS3Send.mockResolvedValueOnce({ ContentLength: 12345 });
      prismaMock.document.update.mockResolvedValue({ id: 'doc-1', fileSize: 12345 } as any);

      const result = await service.confirmUpload('doc-1');

      expect(prismaMock.document.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { fileSize: 12345 } }),
      );
    });

    it('links checklist documents (w9)', async () => {
      prismaMock.document.findUnique.mockResolvedValue({
        id: 'doc-1', providerId: 'p1', s3Key: 'k', mimeType: 'text/plain', documentType: 'w9',
      } as any);
      mockS3Send.mockResolvedValueOnce({ ContentLength: 100 });
      prismaMock.document.update.mockResolvedValue({} as any);
      prismaMock.providerChecklist.findUnique.mockResolvedValue({ providerId: 'p1' } as any);
      prismaMock.providerChecklist.update.mockResolvedValue({} as any);

      await service.confirmUpload('doc-1');

      expect(prismaMock.providerChecklist.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ w9DocumentId: 'doc-1', w9Status: 'pending_review' }),
        }),
      );
    });

    it('skips OCR in LocalStack mode', async () => {
      prismaMock.document.findUnique.mockResolvedValue({
        id: 'doc-1', providerId: 'p1', s3Key: 'k', mimeType: 'application/pdf', documentType: 'license',
      } as any);
      mockS3Send.mockResolvedValueOnce({ ContentLength: 100 });
      prismaMock.document.update.mockResolvedValue({} as any);

      await service.confirmUpload('doc-1');

      // Should set ocrStatus to not_applicable (LocalStack mode)
      expect(prismaMock.document.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { ocrStatus: 'not_applicable' } }),
      );
      expect(mockTextractSend).not.toHaveBeenCalled();
    });

    it('throws on missing document', async () => {
      prismaMock.document.findUnique.mockResolvedValue(null);
      await expect(service.confirmUpload('nonexistent')).rejects.toThrow('Document not found');
    });
  });

  describe('deleteDocument', () => {
    it('sends DeleteObjectCommand to S3', async () => {
      mockS3Send.mockResolvedValue({});
      await service.deleteDocument('documents/p1/doc-1.pdf');
      expect(mockS3Send).toHaveBeenCalled();
    });
  });

  describe('getDownloadUrl', () => {
    it('returns pre-signed GET URL', async () => {
      const url = await service.getDownloadUrl('documents/p1/doc-1.pdf');
      expect(url).toBe('https://signed-url.example.com');
      expect(mockGetSignedUrl).toHaveBeenCalled();
    });
  });

  describe('handleOcrNotification', () => {
    it('processes completed OCR job', async () => {
      prismaMock.document.findMany.mockResolvedValue([{ id: 'doc-1' }] as any);
      mockTextractSend.mockResolvedValue({
        JobStatus: 'SUCCEEDED',
        Blocks: [],
      });
      prismaMock.document.update.mockResolvedValue({} as any);

      await service.handleOcrNotification('job-123');

      expect(prismaMock.document.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'doc-1' },
          data: expect.objectContaining({ ocrStatus: 'completed' }),
        }),
      );
    });

    it('marks document failed when OCR job fails', async () => {
      prismaMock.document.findMany.mockResolvedValue([{ id: 'doc-1' }] as any);
      mockTextractSend.mockResolvedValue({ JobStatus: 'FAILED' });
      prismaMock.document.update.mockResolvedValue({} as any);

      await service.handleOcrNotification('job-456');

      expect(prismaMock.document.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { ocrStatus: 'failed' } }),
      );
    });

    it('does nothing when no document found for job', async () => {
      prismaMock.document.findMany.mockResolvedValue([]);
      await service.handleOcrNotification('job-999');
      expect(mockTextractSend).not.toHaveBeenCalled();
    });
  });
});
```

### Step 2: Run test

```bash
cd /Users/kay/Documents/KAY/packages/backend && npx vitest run src/services/document.service.test.ts
```

Expected: All tests PASS

### Step 3: Commit

```bash
git add src/services/document.service.test.ts
git commit -m "test: add document.service unit tests (S3, Textract, checklist linking)"
```

---

## Task 4: expiration.service.test.ts

**Files:**
- Create: `src/services/expiration.service.test.ts`
- Reference: `src/services/expiration.service.ts`

**Why this is tricky:** `ExpirationService` creates its own `SESClient` in constructor (independently from email.service). Uses `EXPIRATION_THRESHOLDS` from shared package. Date math is the core logic — tests need careful date setup.

### Step 1: Write the test file

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSesSend = vi.hoisted(() => {
  process.env['AWS_REGION'] = 'us-east-1';
  process.env['SES_FROM_EMAIL'] = 'test@lanyard.com';
  return vi.fn().mockResolvedValue({});
});

vi.mock('@aws-sdk/client-ses', () => ({
  SESClient: function() { this.send = mockSesSend; },
  SendEmailCommand: function(p: any) { this.input = p; },
}));

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { ExpirationService } from './expiration.service.js';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';

let service: ExpirationService;

function daysFromNow(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
}

function makeLicense(overrides = {}) {
  return {
    id: 'lic-1',
    licenseType: 'state_medical',
    licenseNumber: 'MD-123',
    expirationDate: daysFromNow(15),
    status: 'active',
    provider: { id: 'p1', firstName: 'Jane', lastName: 'Doe', email: 'jane@test.com' },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  service = new ExpirationService();
  // Default: all queries return empty
  prismaMock.license.findMany.mockResolvedValue([]);
  prismaMock.boardCertification.findMany.mockResolvedValue([]);
  prismaMock.malpracticeInsurance.findMany.mockResolvedValue([]);
  prismaMock.document.findMany.mockResolvedValue([]);
  prismaMock.notification.create.mockResolvedValue({} as any);
});

describe('ExpirationService', () => {
  describe('getUpcomingExpirations', () => {
    it('queries all 4 credential types', async () => {
      await service.getUpcomingExpirations();

      expect(prismaMock.license.findMany).toHaveBeenCalled();
      expect(prismaMock.boardCertification.findMany).toHaveBeenCalled();
      expect(prismaMock.malpracticeInsurance.findMany).toHaveBeenCalled();
      expect(prismaMock.document.findMany).toHaveBeenCalled();
    });

    it('filters by type when specified', async () => {
      await service.getUpcomingExpirations(30, 'license');

      expect(prismaMock.license.findMany).toHaveBeenCalled();
      expect(prismaMock.boardCertification.findMany).not.toHaveBeenCalled();
      expect(prismaMock.malpracticeInsurance.findMany).not.toHaveBeenCalled();
      expect(prismaMock.document.findMany).not.toHaveBeenCalled();
    });

    it('sorts results by expiration date ascending', async () => {
      prismaMock.license.findMany.mockResolvedValue([
        makeLicense({ id: 'later', expirationDate: daysFromNow(20) }),
        makeLicense({ id: 'sooner', expirationDate: daysFromNow(5) }),
      ] as any);

      const results = await service.getUpcomingExpirations();

      expect(results[0]!.id).toBe('sooner');
      expect(results[1]!.id).toBe('later');
    });

    it('includes expired credentials when includeExpired=true', async () => {
      await service.getUpcomingExpirations(30, undefined, true);

      // Should use { lte: cutoff } without gte filter
      expect(prismaMock.license.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            expirationDate: expect.objectContaining({ lte: expect.any(Date) }),
            status: { in: ['active', 'expired'] },
          }),
        }),
      );
    });

    it('maps license fields correctly', async () => {
      prismaMock.license.findMany.mockResolvedValue([makeLicense()] as any);

      const results = await service.getUpcomingExpirations();

      expect(results[0]).toEqual(expect.objectContaining({
        id: 'lic-1',
        type: 'license',
        name: 'state_medical - MD-123',
        providerId: 'p1',
        providerName: 'Jane Doe',
        providerEmail: 'jane@test.com',
      }));
    });
  });

  describe('getDashboardData', () => {
    it('aggregates counts across time buckets', async () => {
      // Mock license counts for each bucket
      prismaMock.license.count
        .mockResolvedValueOnce(2)   // 7 days
        .mockResolvedValueOnce(5)   // 30 days
        .mockResolvedValueOnce(8)   // 60 days
        .mockResolvedValueOnce(12)  // 90 days
        .mockResolvedValueOnce(3);  // expired
      prismaMock.boardCertification.count
        .mockResolvedValue(0);
      prismaMock.malpracticeInsurance.count
        .mockResolvedValue(0);

      const result = await service.getDashboardData();

      expect(result.expiring7Days).toBe(2);
      expect(result.expiring30Days).toBe(5);
      expect(result.expiring60Days).toBe(8);
      expect(result.expiring90Days).toBe(12);
      expect(result.expired).toBe(3);
    });
  });

  describe('getProviderExpirations', () => {
    it('filters by providerId', async () => {
      prismaMock.license.findMany.mockResolvedValue([
        makeLicense({ id: 'lic-1', provider: { id: 'p1', firstName: 'A', lastName: 'B', email: 'a@b.com' } }),
        makeLicense({ id: 'lic-2', provider: { id: 'p2', firstName: 'C', lastName: 'D', email: 'c@d.com' } }),
      ] as any);

      const results = await service.getProviderExpirations('p1');

      expect(results).toHaveLength(1);
      expect(results[0]!.providerId).toBe('p1');
    });
  });

  describe('sendExpirationReminders', () => {
    it('sends emails and logs notifications for matching credentials', async () => {
      // Mock getExpiringOnDay to return one credential expiring on the threshold day
      prismaMock.license.findMany.mockResolvedValue([
        makeLicense({
          id: 'lic-remind',
          expirationDate: daysFromNow(30),
        }),
      ] as any);
      mockSesSend.mockResolvedValue({});

      const result = await service.sendExpirationReminders([30]);

      expect(result.sent).toBeGreaterThanOrEqual(0);
      expect(result.failed).toBe(0);
    });

    it('logs failed notifications and continues processing', async () => {
      prismaMock.license.findMany.mockResolvedValue([
        makeLicense({ id: 'lic-fail', expirationDate: daysFromNow(30) }),
      ] as any);
      mockSesSend.mockRejectedValue(new Error('SES quota'));

      const result = await service.sendExpirationReminders([30]);

      // Should not throw — continues processing
      expect(result.failed).toBeGreaterThanOrEqual(0);
    });
  });
});
```

### Step 2: Run test

```bash
cd /Users/kay/Documents/KAY/packages/backend && npx vitest run src/services/expiration.service.test.ts
```

Expected: All tests PASS

### Step 3: Commit

```bash
git add src/services/expiration.service.test.ts
git commit -m "test: add expiration.service unit tests (queries, dashboard, reminders)"
```

---

## Task 5: chat.service.test.ts

**Files:**
- Create: `src/services/chat.service.test.ts`
- Reference: `src/services/chat.service.ts`, `src/services/ai.service.ts`

**Why this is tricky:** Imports `getClient`, `sanitizeUserInput`, `checkTokenBudget` from `ai.service.ts`. Uses practice scope middleware functions. Must mock Anthropic SDK, all Prisma models, and practice scope helpers.

### Step 1: Write the test file

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreate = vi.hoisted(() => {
  process.env['ANTHROPIC_API_KEY'] = 'test-key';
  process.env['AI_MODEL'] = 'test-model';
  process.env['AI_DAILY_TOKEN_BUDGET'] = '100000';
  return vi.fn();
});

vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = { create: mockCreate };
  }
  return { default: MockAnthropic };
});

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../middleware/practiceScope.middleware.js', () => ({
  getPracticeProviderFilter: vi.fn().mockReturnValue({}),
  getPracticeRelationFilter: vi.fn().mockReturnValue({}),
}));

import { sendChatMessage, getUserConversations, getConversationMessages } from './chat.service.js';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import { createMockRequest } from '../../tests/helpers/mock-express.js';

function makeAnthropicResponse(text: string) {
  return {
    content: [{ type: 'text', text }],
    usage: { input_tokens: 100, output_tokens: 200 },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: token budget allowed
  prismaMock.chatMessage.aggregate.mockResolvedValue({
    _sum: { promptTokens: 0, completionTokens: 0 },
    _count: null as any, _avg: null as any, _min: null as any, _max: null as any,
  });
});

describe('chat.service', () => {
  describe('sendChatMessage', () => {
    it('creates new conversation when conversationId not provided', async () => {
      prismaMock.chatConversation.create.mockResolvedValue({ id: 'conv-1', title: 'Test' } as any);
      prismaMock.chatMessage.create.mockResolvedValue({ id: 'msg-1', createdAt: new Date() } as any);
      prismaMock.chatMessage.findMany.mockResolvedValue([]);
      prismaMock.chatConversation.update.mockResolvedValue({} as any);
      prismaMock.payerEnrollment.findMany.mockResolvedValue([]);
      prismaMock.license.findMany.mockResolvedValue([]);
      prismaMock.boardCertification.findMany.mockResolvedValue([]);

      mockCreate.mockResolvedValue(makeAnthropicResponse('Hello! How can I help?'));

      const req = createMockRequest({ user: { id: 'user-1', role: 'admin' }, practiceScope: { isSuperAdmin: true, practiceIds: [] } } as any);

      const result = await sendChatMessage({
        userId: 'user-1',
        message: 'What enrollments are overdue?',
        req,
      });

      expect(result.conversationId).toBe('conv-1');
      expect(result.message.content).toBe('Hello! How can I help?');
      expect(prismaMock.chatConversation.create).toHaveBeenCalled();
    });

    it('uses existing conversation when conversationId provided', async () => {
      prismaMock.chatConversation.findFirst.mockResolvedValue({ id: 'conv-existing' } as any);
      prismaMock.chatMessage.create.mockResolvedValue({ id: 'msg-2', createdAt: new Date() } as any);
      prismaMock.chatMessage.findMany.mockResolvedValue([]);
      prismaMock.chatConversation.update.mockResolvedValue({} as any);
      prismaMock.payerEnrollment.findMany.mockResolvedValue([]);
      prismaMock.license.findMany.mockResolvedValue([]);
      prismaMock.boardCertification.findMany.mockResolvedValue([]);

      mockCreate.mockResolvedValue(makeAnthropicResponse('Here are your enrollments.'));

      const req = createMockRequest({ user: { id: 'user-1', role: 'admin' }, practiceScope: { isSuperAdmin: true, practiceIds: [] } } as any);

      const result = await sendChatMessage({
        userId: 'user-1',
        conversationId: 'conv-existing',
        message: 'Show me overdue enrollments',
        req,
      });

      expect(result.conversationId).toBe('conv-existing');
      expect(prismaMock.chatConversation.create).not.toHaveBeenCalled();
    });

    it('throws when conversation not found', async () => {
      prismaMock.chatConversation.findFirst.mockResolvedValue(null);
      const req = createMockRequest({ user: { id: 'user-1', role: 'admin' }, practiceScope: { isSuperAdmin: true, practiceIds: [] } } as any);

      await expect(sendChatMessage({
        userId: 'user-1',
        conversationId: 'nonexistent',
        message: 'test',
        req,
      })).rejects.toThrow('Conversation not found');
    });

    it('throws when token budget exceeded', async () => {
      prismaMock.chatMessage.aggregate.mockResolvedValue({
        _sum: { promptTokens: 999999, completionTokens: 999999 },
        _count: null as any, _avg: null as any, _min: null as any, _max: null as any,
      });

      const req = createMockRequest({ user: { id: 'user-1', role: 'admin' }, practiceScope: { isSuperAdmin: true, practiceIds: [] } } as any);

      await expect(sendChatMessage({
        userId: 'user-1',
        message: 'test',
        req,
      })).rejects.toThrow(/token budget exceeded/i);
    });

    it('throws when message is empty after sanitization', async () => {
      const req = createMockRequest({ user: { id: 'user-1', role: 'admin' }, practiceScope: { isSuperAdmin: true, practiceIds: [] } } as any);

      await expect(sendChatMessage({
        userId: 'user-1',
        message: '',
        req,
      })).rejects.toThrow(/empty after sanitization/i);
    });

    it('saves assistant message with token counts', async () => {
      prismaMock.chatConversation.create.mockResolvedValue({ id: 'conv-1' } as any);
      prismaMock.chatMessage.create.mockResolvedValue({ id: 'msg-1', createdAt: new Date() } as any);
      prismaMock.chatMessage.findMany.mockResolvedValue([]);
      prismaMock.chatConversation.update.mockResolvedValue({} as any);
      prismaMock.payerEnrollment.findMany.mockResolvedValue([]);
      prismaMock.license.findMany.mockResolvedValue([]);
      prismaMock.boardCertification.findMany.mockResolvedValue([]);

      mockCreate.mockResolvedValue(makeAnthropicResponse('Response text'));

      const req = createMockRequest({ user: { id: 'user-1', role: 'admin' }, practiceScope: { isSuperAdmin: true, practiceIds: [] } } as any);

      await sendChatMessage({ userId: 'user-1', message: 'test message', req });

      // Second create call is the assistant message
      const assistantCall = prismaMock.chatMessage.create.mock.calls[1]![0];
      expect(assistantCall.data).toEqual(expect.objectContaining({
        role: 'assistant',
        promptTokens: 100,
        completionTokens: 200,
      }));
    });
  });

  describe('getUserConversations', () => {
    it('returns paginated conversations with last message preview', async () => {
      prismaMock.chatConversation.findMany.mockResolvedValue([
        {
          id: 'conv-1',
          title: 'Enrollment help',
          messages: [{ content: 'Latest response from AI about enrollments...', role: 'assistant', createdAt: new Date() }],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ] as any);

      const result = await getUserConversations('user-1');

      expect(result).toHaveLength(1);
      expect(result[0]!.title).toBe('Enrollment help');
      expect(result[0]!.lastMessage).toBeTruthy();
      expect(result[0]!.lastMessage!.content.length).toBeLessThanOrEqual(100);
    });
  });

  describe('getConversationMessages', () => {
    it('returns messages for owned conversation', async () => {
      prismaMock.chatConversation.findFirst.mockResolvedValue({
        id: 'conv-1', title: 'Test', createdAt: new Date(),
      } as any);
      prismaMock.chatMessage.findMany.mockResolvedValue([
        { id: 'msg-1', role: 'user', content: 'Hello', metadata: null, createdAt: new Date() },
        { id: 'msg-2', role: 'assistant', content: 'Hi there', metadata: { intent: 'general' }, createdAt: new Date() },
      ] as any);

      const result = await getConversationMessages('conv-1', 'user-1');

      expect(result.messages).toHaveLength(2);
      expect(result.conversation.id).toBe('conv-1');
    });

    it('throws when conversation not owned by user', async () => {
      prismaMock.chatConversation.findFirst.mockResolvedValue(null);

      await expect(getConversationMessages('conv-1', 'wrong-user')).rejects.toThrow('Conversation not found');
    });
  });
});
```

### Step 2: Run test

```bash
cd /Users/kay/Documents/KAY/packages/backend && npx vitest run src/services/chat.service.test.ts
```

Expected: All tests PASS

### Step 3: Commit

```bash
git add src/services/chat.service.test.ts
git commit -m "test: add chat.service unit tests (intent, conversation, budget, sanitization)"
```

---

## Task 6: authorization-boundaries.test.ts

**Files:**
- Create: `tests/authorization-boundaries.test.ts`
- Reference: `src/routes/provider.routes.ts`, `src/middleware/practiceScope.middleware.ts`, `src/middleware/auth.middleware.ts`, `tests/helpers/test-app.ts`

**Why this is tricky:** Uses supertest through real Express routes with injected user + practice scope. Must mock Prisma to return providers with specific practiceIds, then assert that cross-practice access is blocked. The `createTestApp` helper defaults `practiceIds: []` — we need to override it for practice-scoped users.

**Important:** `createTestApp` sets `practiceScope` but defaults to empty practiceIds. For these tests, we inject custom middleware that sets the right practice scope.

### Step 1: Write the test file

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('../src/utils/prisma.js', async () => {
  const { prismaMock } = await import('./helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

vi.mock('../src/utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../src/utils/cache.js', () => ({
  invalidateCache: vi.fn(),
}));

import { prismaMock } from './helpers/mock-prisma.js';
import { errorHandler } from '../src/middleware/error.middleware.js';
import { providerRoutes } from '../src/routes/provider.routes.js';
import { adminUser, staffUser, providerUser, practiceAdminUser } from './helpers/fixtures.js';

// ==========================================
// Helpers
// ==========================================

/**
 * Build test app with injected user and practice scope.
 * Bypasses JWT auth by directly setting req.user + req.practiceScope.
 */
function buildApp(user: Record<string, unknown>, practiceScope: { isSuperAdmin: boolean; practiceIds: string[] }) {
  const app = express();
  app.use(express.json());

  // Inject user + practice scope (bypass authenticate middleware)
  app.use((req, _res, next) => {
    req.user = user as any;
    req.practiceScope = practiceScope;
    next();
  });

  // Mount provider routes WITHOUT the authenticate middleware
  // We re-create a raw router with just the route handlers + authorize + practiceScope middleware
  app.use('/api/v1/providers', providerRoutes);
  app.use(errorHandler);
  return app;
}

// Mock provider data
const providerInPracticeA = {
  id: 'provider-A1',
  npi: '1111111111',
  firstName: 'Alice',
  lastName: 'Smith',
  practiceId: 'practice-A',
  email: 'alice@test.com',
  status: 'active',
};

const providerInPracticeB = {
  id: 'provider-B1',
  npi: '2222222222',
  firstName: 'Bob',
  lastName: 'Jones',
  practiceId: 'practice-B',
  email: 'bob@test.com',
  status: 'active',
};

const unassignedProvider = {
  id: 'provider-unassigned',
  npi: '3333333333',
  firstName: 'Charlie',
  lastName: 'Brown',
  practiceId: null,
  email: 'charlie@test.com',
  status: 'active',
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ==========================================
// Cross-Practice Isolation
// ==========================================

describe('Authorization Boundaries — Cross-Practice Isolation', () => {
  it('staff from Practice A cannot GET provider in Practice B', async () => {
    const app = buildApp(staffUser, { isSuperAdmin: false, practiceIds: ['practice-A'] });

    // requirePracticeProvider will look up the provider
    prismaMock.provider.findUnique.mockResolvedValue(providerInPracticeB as any);

    const res = await request(app).get('/api/v1/providers/provider-B1');

    expect(res.status).toBe(403);
  });

  it('staff from Practice A CAN GET provider in Practice A', async () => {
    const app = buildApp(staffUser, { isSuperAdmin: false, practiceIds: ['practice-A'] });

    prismaMock.provider.findUnique.mockResolvedValue({
      ...providerInPracticeA,
      addresses: [],
      practiceLocations: [],
      licenses: [],
      boardCertifications: [],
      malpracticeInsurances: [],
      educations: [],
      documents: [],
      payerEnrollments: [],
      checklist: null,
      workHistory: [],
      hospitalAffiliations: [],
      professionalReferences: [],
      deaRegistrations: [],
      continuingEducation: [],
      disciplinaryActions: [],
      additionalIdentifiers: [],
      bankingInformation: [],
      demographics: null,
    } as any);

    const res = await request(app).get('/api/v1/providers/provider-A1');

    expect(res.status).toBe(200);
  });

  it('practice admin from Practice A cannot GET provider in Practice B', async () => {
    const app = buildApp(practiceAdminUser, { isSuperAdmin: false, practiceIds: ['practice-A'] });

    prismaMock.provider.findUnique.mockResolvedValue(providerInPracticeB as any);

    const res = await request(app).get('/api/v1/providers/provider-B1');

    expect(res.status).toBe(403);
  });

  it('provider with practiceId=null is accessible to all staff', async () => {
    const app = buildApp(staffUser, { isSuperAdmin: false, practiceIds: ['practice-A'] });

    prismaMock.provider.findUnique.mockResolvedValue({
      ...unassignedProvider,
      addresses: [],
      practiceLocations: [],
      licenses: [],
      boardCertifications: [],
      malpracticeInsurances: [],
      educations: [],
      documents: [],
      payerEnrollments: [],
      checklist: null,
      workHistory: [],
      hospitalAffiliations: [],
      professionalReferences: [],
      deaRegistrations: [],
      continuingEducation: [],
      disciplinaryActions: [],
      additionalIdentifiers: [],
      bankingInformation: [],
      demographics: null,
    } as any);

    const res = await request(app).get('/api/v1/providers/provider-unassigned');

    expect(res.status).toBe(200);
  });

  it('admin bypasses all practice filters', async () => {
    const app = buildApp(adminUser, { isSuperAdmin: true, practiceIds: [] });

    prismaMock.provider.findUnique.mockResolvedValue({
      ...providerInPracticeB,
      addresses: [],
      practiceLocations: [],
      licenses: [],
      boardCertifications: [],
      malpracticeInsurances: [],
      educations: [],
      documents: [],
      payerEnrollments: [],
      checklist: null,
      workHistory: [],
      hospitalAffiliations: [],
      professionalReferences: [],
      deaRegistrations: [],
      continuingEducation: [],
      disciplinaryActions: [],
      additionalIdentifiers: [],
      bankingInformation: [],
      demographics: null,
    } as any);

    const res = await request(app).get('/api/v1/providers/provider-B1');

    expect(res.status).toBe(200);
  });
});

// ==========================================
// Provider Self-Scope
// ==========================================

describe('Authorization Boundaries — Provider Self-Scope', () => {
  it('provider cannot list all providers (role gate)', async () => {
    const app = buildApp(providerUser, { isSuperAdmin: false, practiceIds: [] });

    const res = await request(app).get('/api/v1/providers');

    // authorize('admin', 'credentialing_staff', 'practice_admin') blocks providers
    expect(res.status).toBe(403);
  });

  it('provider can GET their own profile', async () => {
    const app = buildApp(providerUser, { isSuperAdmin: false, practiceIds: [] });

    prismaMock.provider.findUnique.mockResolvedValue({
      ...providerInPracticeA,
      id: 'provider-record-id', // matches providerUser.providerId
      addresses: [],
      practiceLocations: [],
      licenses: [],
      boardCertifications: [],
      malpracticeInsurances: [],
      educations: [],
      documents: [],
      payerEnrollments: [],
      checklist: null,
      workHistory: [],
      hospitalAffiliations: [],
      professionalReferences: [],
      deaRegistrations: [],
      continuingEducation: [],
      disciplinaryActions: [],
      additionalIdentifiers: [],
      bankingInformation: [],
      demographics: null,
    } as any);

    const res = await request(app).get('/api/v1/providers/provider-record-id');

    expect(res.status).toBe(200);
  });

  it('provider cannot GET another provider profile', async () => {
    const app = buildApp(providerUser, { isSuperAdmin: false, practiceIds: [] });

    prismaMock.provider.findUnique.mockResolvedValue(providerInPracticeB as any);

    const res = await request(app).get('/api/v1/providers/provider-B1');

    expect(res.status).toBe(403);
  });
});

// ==========================================
// Staff with No Practice Assignments
// ==========================================

describe('Authorization Boundaries — Edge Cases', () => {
  it('staff with no practice assignments sees only unassigned providers in list', async () => {
    const app = buildApp(staffUser, { isSuperAdmin: false, practiceIds: [] });

    prismaMock.provider.findMany.mockResolvedValue([unassignedProvider] as any);
    prismaMock.provider.count.mockResolvedValue(1);

    const res = await request(app).get('/api/v1/providers');

    expect(res.status).toBe(200);
    // getPracticeProviderFilter with empty practiceIds returns { practiceId: null }
    expect(prismaMock.provider.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ practiceId: null }),
      }),
    );
  });
});
```

### Step 2: Run test

```bash
cd /Users/kay/Documents/KAY/packages/backend && npx vitest run tests/authorization-boundaries.test.ts
```

Expected: All tests PASS. Some may need adjustment if the `providerRoutes` re-runs `authenticate` internally (which it does via `providerRoutes.use(authenticate)` at the top). In that case, we need to also mock the `authenticate` middleware to pass through. If tests fail because `authenticate` rejects the request (no JWT), add this mock:

```typescript
vi.mock('../src/middleware/auth.middleware.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/middleware/auth.middleware.js')>();
  return {
    ...actual,
    authenticate: (_req: any, _res: any, next: any) => next(),
  };
});
```

### Step 3: Commit

```bash
git add tests/authorization-boundaries.test.ts
git commit -m "test: add authorization boundary tests (cross-practice isolation, provider self-scope)"
```

---

## Task 7: Run full test suite and verify

### Step 1: Run all tests

```bash
cd /Users/kay/Documents/KAY/packages/backend && npx vitest run
```

Expected: All existing + new tests PASS. No regressions.

### Step 2: Fix any failures

If any test fails, read the error, fix the specific test, re-run just that file.

### Step 3: Final commit with all fixes

```bash
git add -A
git commit -m "test: fix any test adjustments after full suite run"
```

---

## Summary

| Task | File | Tests | Key Mocks |
|------|------|-------|-----------|
| 1 | `src/services/email.service.test.ts` | ~10 | SES SDK, Prisma |
| 2 | `src/services/caqh.service.test.ts` | ~20 | fetch, Prisma |
| 3 | `src/services/document.service.test.ts` | ~12 | S3, Textract, getSignedUrl, uuid, Prisma |
| 4 | `src/services/expiration.service.test.ts` | ~12 | SES SDK, Prisma |
| 5 | `src/services/chat.service.test.ts` | ~10 | Anthropic SDK, Prisma, practiceScope |
| 6 | `tests/authorization-boundaries.test.ts` | ~10 | Prisma, supertest, real routes |
| 7 | Full suite verification | — | — |

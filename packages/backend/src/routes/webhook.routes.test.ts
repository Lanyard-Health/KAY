/**
 * Tests for the inbound enrollment-status webhook.
 *
 * Signature verification uses the REAL webhookAuth.service (requests are
 * signed with a test secret). The enrollment status write is asserted to go
 * through updateEnrollmentStatus — the single choke point — never through a
 * direct prisma status update.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import crypto from 'node:crypto';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock, prismaBase: prismaMock };
});

vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../services/enrollment.service.js', () => ({
  updateEnrollmentStatus: vi.fn(),
}));

vi.mock('../services/denial-triage.service.js', () => ({
  triggerDenialTriage: vi.fn().mockResolvedValue({ triageCreated: false }),
}));

vi.mock('../agents/event-logger.js', () => ({ logAgentEvent: vi.fn() }));
vi.mock('../agents/websocket.js', () => ({ emitWorkflowEvent: vi.fn() }));

import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import { updateEnrollmentStatus } from '../services/enrollment.service.js';
import { triggerDenialTriage } from '../services/denial-triage.service.js';
import { ValidationError } from '../middleware/error.middleware.js';
import router from './webhook.routes.js';

const SECRET = 'test-webhook-secret';
const ENROLLMENT_ID = '4f7c2c6e-1234-4abc-9def-0123456789ab';

const app = express();
app.use('/', router);

function sign(body: string): string {
  return crypto.createHmac('sha256', SECRET).update(body).digest('hex');
}

function post(body: object, overrides?: { sig?: string; ts?: string }) {
  const raw = JSON.stringify(body);
  return request(app)
    .post('/enrollment-status')
    .set('Content-Type', 'application/json')
    .set('X-Webhook-Signature', overrides?.sig ?? sign(raw))
    .set('X-Webhook-Timestamp', overrides?.ts ?? new Date().toISOString())
    .send(raw);
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env['ENROLLMENT_WEBHOOK_SECRET'] = SECRET;
  prismaMock.enrollment.findUnique.mockResolvedValue({
    id: ENROLLMENT_ID,
    status: 'submitted',
  } as any);
  prismaMock.agentWorkflow.findFirst.mockResolvedValue(null);
  vi.mocked(updateEnrollmentStatus).mockResolvedValue({
    id: ENROLLMENT_ID,
    status: 'approved',
  } as any);
  vi.mocked(triggerDenialTriage).mockResolvedValue({ triageCreated: false } as any);
});

describe('POST /enrollment-status — auth', () => {
  it('rejects a missing signature with 401 and never touches the service', async () => {
    const raw = JSON.stringify({ enrollmentId: ENROLLMENT_ID, status: 'approved' });
    const res = await request(app)
      .post('/enrollment-status')
      .set('Content-Type', 'application/json')
      .send(raw);

    expect(res.status).toBe(401);
    expect(vi.mocked(updateEnrollmentStatus)).not.toHaveBeenCalled();
  });

  it('rejects a bad signature with 401 and never touches the service', async () => {
    const res = await post(
      { enrollmentId: ENROLLMENT_ID, status: 'approved' },
      { sig: 'deadbeef'.repeat(8) }
    );

    expect(res.status).toBe(401);
    expect(vi.mocked(updateEnrollmentStatus)).not.toHaveBeenCalled();
  });
});

describe('POST /enrollment-status — status writes go through the choke point', () => {
  it('routes a valid Mode A change through updateEnrollmentStatus with system actor + webhook source', async () => {
    const res = await post({ enrollmentId: ENROLLMENT_ID, status: 'approved' });

    expect(res.status).toBe(200);
    expect(res.body.newStatus).toBe('approved');
    expect(vi.mocked(updateEnrollmentStatus)).toHaveBeenCalledWith(
      ENROLLMENT_ID,
      'approved',
      null,
      { source: 'webhook', triggerDenialTriage: false }
    );
    // No direct status write from the route.
    expect(prismaMock.enrollment.update).not.toHaveBeenCalled();
  });

  it("maps additional_info_needed to pending_review before delegating", async () => {
    await post({ enrollmentId: ENROLLMENT_ID, status: 'additional_info_needed' });

    expect(vi.mocked(updateEnrollmentStatus)).toHaveBeenCalledWith(
      ENROLLMENT_ID,
      'pending_review',
      null,
      expect.anything()
    );
  });

  it('returns 422 when the service rejects an out-of-order transition, applying nothing', async () => {
    vi.mocked(updateEnrollmentStatus).mockRejectedValue(
      new ValidationError("Cannot transition from 'approved' to 'submitted'")
    );

    const res = await post({
      enrollmentId: ENROLLMENT_ID,
      status: 'submitted',
      confirmationId: 'CONF-1',
    });

    expect(res.status).toBe(422);
    expect(res.body.error.message).toContain('Cannot transition');
    // Rejected message applies nothing — not even the non-status fields.
    expect(prismaMock.enrollment.update).not.toHaveBeenCalled();
  });

  it('applies confirmationId/effectiveDate only after the status change is accepted', async () => {
    prismaMock.enrollment.update.mockResolvedValue({} as any);

    const res = await post({
      enrollmentId: ENROLLMENT_ID,
      status: 'approved',
      confirmationId: 'CONF-42',
      effectiveDate: '2026-09-01',
    });

    expect(res.status).toBe(200);
    expect(prismaMock.enrollment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ENROLLMENT_ID },
        data: expect.objectContaining({ providerNumber: 'CONF-42' }),
      })
    );
  });

  it('runs denial triage with webhook denial context and reports triageCreated', async () => {
    vi.mocked(updateEnrollmentStatus).mockResolvedValue({
      id: ENROLLMENT_ID,
      status: 'denied',
    } as any);
    vi.mocked(triggerDenialTriage).mockResolvedValue({ triageCreated: true, triageId: 't-1' } as any);

    const res = await post({
      enrollmentId: ENROLLMENT_ID,
      status: 'denied',
      denialReason: 'Missing W-9',
    });

    expect(res.status).toBe(200);
    expect(res.body.triageCreated).toBe(true);
    expect(vi.mocked(triggerDenialTriage)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ enrollmentId: ENROLLMENT_ID, denialReason: 'Missing W-9' })
    );
    // The service call must NOT double-trigger triage.
    expect(vi.mocked(updateEnrollmentStatus)).toHaveBeenCalledWith(
      ENROLLMENT_ID,
      'denied',
      null,
      expect.objectContaining({ triggerDenialTriage: false })
    );
  });
});

describe('POST /enrollment-status — resolution', () => {
  it('returns 400 when the Mode A enrollment does not exist', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(null);

    const res = await post({ enrollmentId: ENROLLMENT_ID, status: 'approved' });

    expect(res.status).toBe(400);
    expect(vi.mocked(updateEnrollmentStatus)).not.toHaveBeenCalled();
  });

  it('returns 400 on an ambiguous Mode B match (NPI + payer resolves to 2 enrollments)', async () => {
    prismaMock.enrollment.findMany.mockResolvedValue([
      { id: 'enr-1', status: 'submitted' },
      { id: 'enr-2', status: 'submitted' },
    ] as any);

    const res = await post({
      providerNpi: '1234567890',
      payerExternalId: 'AETNA-01',
      status: 'approved',
    });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('Ambiguous');
    expect(vi.mocked(updateEnrollmentStatus)).not.toHaveBeenCalled();
  });
});

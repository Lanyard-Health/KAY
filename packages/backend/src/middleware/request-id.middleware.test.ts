import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import { requestId } from './request-id.middleware.js';
import { getRequestId } from '../utils/request-context.js';

function mockReqRes(inboundId?: string) {
  const headers: Record<string, string> = {};
  const req = {
    header: (name: string) => (name.toLowerCase() === 'x-request-id' ? inboundId : undefined),
  } as unknown as Request & { requestId?: string };
  const setHeader = vi.fn((k: string, v: string) => {
    headers[k] = v;
  });
  const res = { setHeader } as unknown as Response;
  return { req, res, headers, setHeader };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('requestId middleware', () => {
  it('mints a UUID when no inbound id is present and echoes it on the response', () => {
    const { req, res, headers } = mockReqRes();
    requestId(req, res, () => {});
    expect(req.requestId).toMatch(UUID_RE);
    expect(headers['X-Request-Id']).toBe(req.requestId);
  });

  it('makes the id readable via getRequestId() inside the downstream handler', () => {
    const { req, res } = mockReqRes();
    let seen: string | undefined;
    requestId(req, res, () => {
      seen = getRequestId();
    });
    expect(seen).toBe(req.requestId);
  });

  it('honors a sane inbound X-Request-Id (proxy correlation)', () => {
    const { req, res } = mockReqRes('edge-trace-123');
    requestId(req, res, () => {});
    expect(req.requestId).toBe('edge-trace-123');
  });

  it('rejects a malformed/oversized inbound id and mints a fresh UUID', () => {
    const { req, res } = mockReqRes('bad id with spaces & ;injection');
    requestId(req, res, () => {});
    expect(req.requestId).toMatch(UUID_RE);
  });

  it('calls next exactly once', () => {
    const { req, res } = mockReqRes();
    const next = vi.fn();
    requestId(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});

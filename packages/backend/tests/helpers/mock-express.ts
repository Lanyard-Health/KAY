import type { Request, Response, NextFunction } from 'express';
import { vi } from 'vitest';

export function createMockRequest(overrides: Partial<Request> = {}): Request {
  const req = {
    headers: {},
    params: {},
    query: {},
    body: {},
    user: undefined,
    get: vi.fn(),
    ip: '127.0.0.1',
    ...overrides,
  } as unknown as Request;
  return req;
}

export function createMockResponse(): Response {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
    end: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

export function createMockNext(): NextFunction {
  return vi.fn() as NextFunction;
}

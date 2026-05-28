import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { verifyFileMagicBytes } from './file-magic.middleware.js';

// Minimal real PDF magic bytes ('%PDF-1.4' header).
const PDF_BUFFER = Buffer.from('25504446312d312e340a25e2e3cfd30a', 'hex');

// Minimal PNG magic bytes (89 50 4E 47 0D 0A 1A 0A) + a few bytes.
const PNG_BUFFER = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

// Bogus bytes — not any known format.
const GARBAGE_BUFFER = Buffer.from('00010203040506070809', 'hex');

function makeReq(file: { buffer: Buffer; mimetype: string; originalname: string }): Request {
  return { file } as unknown as Request;
}

function makeRes() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
}

describe('verifyFileMagicBytes', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env['FILETYPE_VALIDATION_ENABLED'];
  });

  it('accepts a real PDF buffer when application/pdf is allowed', async () => {
    const middleware = verifyFileMagicBytes(['application/pdf']);
    const req = makeReq({ buffer: PDF_BUFFER, mimetype: 'application/pdf', originalname: 'real.pdf' });
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect((res as any).statusCode).toBe(200);
  });

  it('rejects a Word doc renamed as PDF', async () => {
    const middleware = verifyFileMagicBytes(['application/pdf']);
    const req = makeReq({ buffer: PNG_BUFFER, mimetype: 'application/pdf', originalname: 'fake.pdf' });
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    await middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect((res as any).statusCode).toBe(400);
    expect((res as any).body).toMatchObject({ detectedMime: 'image/png' });
  });

  it('rejects a buffer of garbage that file-type cannot detect', async () => {
    const middleware = verifyFileMagicBytes(['application/pdf']);
    const req = makeReq({ buffer: GARBAGE_BUFFER, mimetype: 'application/pdf', originalname: 'rand.pdf' });
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    await middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect((res as any).statusCode).toBe(400);
  });

  it('allows text/csv pass-through when configured (file-type cannot detect CSVs)', async () => {
    const middleware = verifyFileMagicBytes(['application/pdf'], ['text/csv']);
    const csvBuffer = Buffer.from('name,age\nalice,30\nbob,25\n', 'utf8');
    const req = makeReq({ buffer: csvBuffer, mimetype: 'text/csv', originalname: 'rows.csv' });
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect((res as any).statusCode).toBe(200);
  });

  it('still rejects a binary file even when declared as text/csv (binary masquerading as text)', async () => {
    const middleware = verifyFileMagicBytes(['application/pdf'], ['text/csv']);
    const req = makeReq({ buffer: PNG_BUFFER, mimetype: 'text/csv', originalname: 'evil.csv' });
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    await middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect((res as any).statusCode).toBe(400);
  });

  it('skips validation entirely when FILETYPE_VALIDATION_ENABLED=false', async () => {
    process.env['FILETYPE_VALIDATION_ENABLED'] = 'false';
    const middleware = verifyFileMagicBytes(['application/pdf']);
    const req = makeReq({ buffer: GARBAGE_BUFFER, mimetype: 'application/pdf', originalname: 'whatever.pdf' });
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });
});

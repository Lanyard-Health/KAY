import { fileTypeFromBuffer } from 'file-type';
import type { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.js';

interface MulterFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
}

function isValidationDisabled(): boolean {
  return process.env['FILETYPE_VALIDATION_ENABLED'] === 'false';
}

interface VerifyOptions {
  /** Mimes whose magic bytes MUST be detected and match. PDF/PNG/JPEG/Office. */
  allowedMimes: readonly string[];
  /**
   * Text-format mimes that lack reliable magic bytes (text/csv, text/plain).
   * If the upload's declared mime is one of these AND file-type detects nothing,
   * the file is allowed through unchanged. If file-type DOES detect something
   * (meaning the file was a binary masquerading as text), it must still match
   * an allowed mime.
   */
  passThroughTextMimes?: readonly string[];
}

async function checkBuffer(
  buffer: Buffer,
  declaredMime: string,
  options: VerifyOptions
): Promise<{ ok: true; mime: string } | { ok: false; detectedMime?: string }> {
  const detected = await fileTypeFromBuffer(buffer);
  if (!detected) {
    if (options.passThroughTextMimes?.includes(declaredMime)) {
      return { ok: true, mime: declaredMime };
    }
    return { ok: false };
  }
  if (!options.allowedMimes.includes(detected.mime)) {
    return { ok: false, detectedMime: detected.mime };
  }
  return { ok: true, mime: detected.mime };
}

export function verifyFileMagicBytes(allowedMimes: readonly string[], passThroughTextMimes?: readonly string[]) {
  const options: VerifyOptions = passThroughTextMimes
    ? { allowedMimes, passThroughTextMimes }
    : { allowedMimes };

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (isValidationDisabled()) {
      next();
      return;
    }

    const candidates: MulterFile[] = [];
    const reqFile = (req as unknown as { file?: MulterFile }).file;
    const reqFiles = (req as unknown as { files?: MulterFile[] | Record<string, MulterFile[]> }).files;
    if (reqFile) candidates.push(reqFile);
    if (Array.isArray(reqFiles)) {
      candidates.push(...reqFiles);
    } else if (reqFiles && typeof reqFiles === 'object') {
      for (const group of Object.values(reqFiles)) {
        if (Array.isArray(group)) candidates.push(...group);
      }
    }

    if (candidates.length === 0) {
      next();
      return;
    }

    for (const candidate of candidates) {
      const result = await checkBuffer(candidate.buffer, candidate.mimetype, options);
      if (!result.ok) {
        logger.warn('File magic byte verification failed', {
          declaredMime: candidate.mimetype,
          detectedMime: result.detectedMime ?? 'unknown',
          originalName: candidate.originalname,
        });
        res.status(400).json({
          error: 'File content does not match the declared file type. The file may be renamed or corrupted.',
          detectedMime: result.detectedMime ?? 'unknown',
          allowed: allowedMimes,
        });
        return;
      }
      candidate.mimetype = result.mime;
    }

    next();
  };
}

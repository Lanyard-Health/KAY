import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import { runWithRequestContext } from '../utils/request-context.js';

// A client/proxy-supplied id is only trusted if it looks sane (avoid log
// injection / unbounded values). Otherwise we mint our own.
const SAFE_ID = /^[\w-]{1,128}$/;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

/**
 * Assigns every request a correlation id and runs the rest of the chain inside
 * a request context (see request-context.ts) so all logs for that request —
 * including morgan's access line and the error handler — carry the same id.
 *
 * Honors an inbound `X-Request-Id` (e.g. from Render's proxy) when it's a sane
 * token; echoes the id back on the response so a client/support can quote it.
 */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const inbound = req.header('x-request-id');
  const id = inbound && SAFE_ID.test(inbound) ? inbound : randomUUID();
  req.requestId = id;
  res.setHeader('X-Request-Id', id);
  runWithRequestContext({ requestId: id }, () => next());
}

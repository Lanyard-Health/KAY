import winston from 'winston';
import { phiSanitizer } from './log-sanitizer.js';
import { getRequestId } from './request-context.js';

const { combine, timestamp, printf, colorize, errors, json } = winston.format;
const isProduction = process.env['NODE_ENV'] === 'production';

// Stamp every entry with the current request's correlation id (when inside a
// request). Runs as a format so both JSON and pretty output pick it up, and so
// callers never have to pass requestId explicitly.
const withRequestId = winston.format((info) => {
  const id = getRequestId();
  if (id) info['requestId'] = id;
  return info;
});

// Human-readable line for local dev: "<ts> [level] (<reqId>): <message>"
const prettyFormat = printf((info) => {
  const { level, message, timestamp: ts, stack, requestId } = info as Record<string, unknown>;
  const rid = requestId ? ` (${String(requestId).slice(0, 8)})` : '';
  return `${ts} [${level}]${rid}: ${stack || message}`;
});

// Single logger-level pipeline (avoids Winston's per-transport double-apply).
// PHI sanitizer runs BEFORE serialization so no transport ever sees SSN, tax
// id, DOB, banking, etc. in metadata.
// Production: machine-parseable JSON on stdout (Render captures it; one object
// per line, requestId queryable). Dev: pretty colorized lines.
const format = isProduction
  ? combine(
      timestamp(),
      errors({ stack: true }),
      withRequestId(),
      phiSanitizer(),
      json(),
    )
  : combine(
      timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      errors({ stack: true }),
      withRequestId(),
      phiSanitizer(),
      colorize(),
      prettyFormat,
    );

export const logger = winston.createLogger({
  level: process.env['LOG_LEVEL'] || 'info',
  format,
  transports: [new winston.transports.Console()],
});

// Production also tees to files (best-effort; Render's fs is ephemeral, stdout
// is the source of truth). These inherit the logger's JSON format.
if (isProduction) {
  logger.add(new winston.transports.File({ filename: 'logs/error.log', level: 'error' }));
  logger.add(new winston.transports.File({ filename: 'logs/combined.log' }));
}

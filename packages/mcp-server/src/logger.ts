import winston from 'winston';

// MCP protocol uses stdout — all logging MUST go to stderr
export const logger = winston.createLogger({
  level: process.env['LOG_LEVEL'] || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
      const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
      return `${String(timestamp)} [mcp-server] ${level}: ${String(message)}${metaStr}`;
    }),
  ),
  transports: [
    new winston.transports.Stream({ stream: process.stderr }),
  ],
});

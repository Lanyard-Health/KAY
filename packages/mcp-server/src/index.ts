import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { logger } from './logger.js';
import { resolveUser } from './auth.js';
import { createServer } from './server.js';
import { prisma } from './prisma.js';

async function main() {
  try {
    // Validate database connection
    await prisma.$connect();
    logger.info('Database connected');

    // Resolve user identity from env var
    const ctx = await resolveUser();

    // Create MCP server and register tools
    const server = createServer(ctx);

    // Start STDIO transport
    const transport = new StdioServerTransport();
    await server.connect(transport);

    logger.info('MCP server running on STDIO');
  } catch (error) {
    logger.error('Failed to start MCP server', { error: String(error) });
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Shutting down...');
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Shutting down...');
  await prisma.$disconnect();
  process.exit(0);
});

main();

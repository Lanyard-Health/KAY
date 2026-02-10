import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { UserContext } from './context.js';
import { registerAllTools } from './tools/index.js';

export function createServer(ctx: UserContext): McpServer {
  const server = new McpServer({
    name: 'lanyard-health',
    version: '1.0.0',
  });

  registerAllTools(server, ctx);

  return server;
}

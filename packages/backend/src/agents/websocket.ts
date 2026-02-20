import type { Server as HttpServer } from 'node:http';
import { Server as SocketServer } from 'socket.io';
import { logger } from '../utils/logger.js';

let io: SocketServer | null = null;

/**
 * Creates a Socket.io server attached to the HTTP server.
 * Sets up event handlers for workflow and approval subscriptions.
 */
export function initializeWebSocket(httpServer: HttpServer): SocketServer {
  const frontendUrl = process.env['FRONTEND_URL'] || 'http://localhost:5190';

  io = new SocketServer(httpServer, {
    path: '/ws/agent',
    cors: {
      origin: frontendUrl,
      methods: ['GET', 'POST'],
    },
  });

  io.on('connection', (socket) => {
    logger.info(`WebSocket client connected: ${socket.id}`);

    socket.on('subscribe:workflow', (workflowId: string) => {
      const room = `workflow:${workflowId}`;
      socket.join(room);
      logger.info(`Client ${socket.id} joined room ${room}`);
    });

    socket.on('unsubscribe:workflow', (workflowId: string) => {
      const room = `workflow:${workflowId}`;
      socket.leave(room);
      logger.info(`Client ${socket.id} left room ${room}`);
    });

    socket.on('subscribe:approvals', () => {
      socket.join('approvals');
      logger.info(`Client ${socket.id} joined room approvals`);
    });

    socket.on('disconnect', (reason) => {
      logger.info(`WebSocket client disconnected: ${socket.id} (${reason})`);
    });
  });

  logger.info('WebSocket server initialized on path /ws/agent');
  return io;
}

/**
 * Returns the Socket.io server instance, or null if not initialized.
 */
export function getSocketServer(): SocketServer | null {
  return io;
}

/**
 * Emits an event to all clients subscribed to a specific workflow room.
 */
export function emitWorkflowEvent(workflowId: string, event: string, data: unknown): void {
  if (io) {
    io.to(`workflow:${workflowId}`).emit(event, data);
  }
}

/**
 * Emits an approval:requested event to all clients in the approvals room.
 */
export function emitApprovalRequest(data: unknown): void {
  if (io) {
    io.to('approvals').emit('approval:requested', data);
  }
}

/**
 * Emits an approval:decided event to all clients in the approvals room.
 */
export function emitApprovalDecision(data: unknown): void {
  if (io) {
    io.to('approvals').emit('approval:decided', data);
  }
}

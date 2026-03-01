import type { Server as HttpServer } from 'node:http';
import { Server as SocketServer } from 'socket.io';
import type { Socket } from 'socket.io';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { logger } from '../utils/logger.js';
import { prisma } from '../utils/prisma.js';

interface SocketUser {
  id: string;
  email: string;
  role: string;
  providerId: string | null;
  practiceIds: string[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let io: SocketServer | null = null;

// Lazy Cognito verifier (same pattern as auth.middleware.ts)
let verifier: ReturnType<typeof CognitoJwtVerifier.create> | null = null;

function getVerifier() {
  if (!verifier) {
    const userPoolId = process.env['COGNITO_USER_POOL_ID'];
    const clientId = process.env['COGNITO_CLIENT_ID'];
    if (!userPoolId || !clientId) {
      throw new Error('Cognito configuration missing');
    }
    verifier = CognitoJwtVerifier.create({
      userPoolId,
      tokenUse: 'access',
      clientId,
    });
  }
  return verifier;
}

/**
 * Socket.io authentication middleware.
 * Validates JWT or dev-bypass token before allowing connections.
 */
async function authenticateSocket(
  socket: Socket,
  next: (err?: Error) => void
): Promise<void> {
  try {
    const token =
      (socket.handshake.auth?.['token'] as string | undefined) ||
      (socket.handshake.query?.['token'] as string | undefined);

    if (!token) {
      next(new Error('Authentication required'));
      return;
    }

    // Dev bypass (mirrors auth.middleware.ts pattern)
    const devBypass = process.env['DEV_AUTH_BYPASS'] === 'true';
    let cognitoId: string;

    if (devBypass && token === 'dev-bypass') {
      if (process.env['NODE_ENV'] === 'production') {
        next(new Error('Authentication required'));
        return;
      }
      cognitoId = 'dev-cognito-id';
    } else {
      // Production: validate Cognito JWT
      const payload = await getVerifier().verify(token);
      cognitoId = payload.sub;
    }

    // Enrich with DB user data for authorization
    const dbUser = await prisma.user.findUnique({
      where: { cognitoId },
      select: {
        id: true,
        email: true,
        role: true,
        providerId: true,
        practices: { select: { practiceId: true } },
      },
    });

    if (!dbUser) {
      next(new Error('Authentication required'));
      return;
    }

    const socketUser: SocketUser = {
      id: dbUser.id,
      email: dbUser.email,
      role: dbUser.role,
      providerId: dbUser.providerId ?? null,
      practiceIds: dbUser.practices.map((p) => p.practiceId),
    };
    (socket as any).user = socketUser;
    next();
  } catch {
    next(new Error('Authentication required'));
  }
}

/**
 * Creates a Socket.io server attached to the HTTP server.
 * Sets up authentication middleware and event handlers for workflow
 * and approval subscriptions.
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

  // Authenticate all incoming connections
  io.use(authenticateSocket);

  io.on('connection', (socket) => {
    logger.info(`WebSocket client connected: ${socket.id}`);

    socket.on('subscribe:workflow', async (workflowId: string) => {
      if (typeof workflowId !== 'string' || !UUID_RE.test(workflowId)) {
        logger.warn(`Client ${socket.id} sent invalid workflowId: ${workflowId}`);
        socket.emit('error', { message: 'Invalid workflowId — must be a UUID' });
        return;
      }

      const user = (socket as any).user as SocketUser;

      // Verify the user has access to this workflow
      const workflow = await prisma.agentWorkflow.findUnique({
        where: { id: workflowId },
        select: { providerId: true, provider: { select: { practiceId: true } } },
      });

      if (!workflow) {
        socket.emit('error', { message: 'Workflow not found' });
        return;
      }

      if (user.role === 'provider') {
        // Providers can only subscribe to their own workflows
        if (user.providerId !== workflow.providerId) {
          socket.emit('error', { message: 'Access denied' });
          return;
        }
      } else if (user.practiceIds.length > 0) {
        // Staff/admin scoped to practices — workflow's provider must belong to one of their practices
        if (workflow.provider?.practiceId && !user.practiceIds.includes(workflow.provider.practiceId)) {
          socket.emit('error', { message: 'Access denied' });
          return;
        }
      }
      // Global admins (practiceIds empty, non-provider role) get access

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
      const user = (socket as any).user as SocketUser;
      const allowedRoles = ['admin', 'credentialing_staff', 'practice_admin'];
      if (!allowedRoles.includes(user.role)) {
        socket.emit('error', { message: 'Access denied' });
        return;
      }
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

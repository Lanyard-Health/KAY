import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io, Socket } from 'socket.io-client';

const DEV_BYPASS_ENABLED = import.meta.env.VITE_DEV_AUTH_BYPASS === 'true';

function getSocketToken(): string | null {
  if (DEV_BYPASS_ENABLED) {
    const devSession = localStorage.getItem('dev_session');
    return devSession ? 'dev-bypass' : null;
  }
  // Production: token is fetched async — we'll set it on connect
  return null;
}

/**
 * Connects to the agent WebSocket server and subscribes to the approvals room.
 * Automatically invalidates React Query caches when approval events arrive.
 */
export function useApprovalSocket() {
  const queryClient = useQueryClient();
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const token = getSocketToken();

    // In production without dev bypass, we need the Cognito token
    const connectSocket = async () => {
      let authToken = token;

      if (!authToken && !DEV_BYPASS_ENABLED) {
        try {
          const { fetchAuthSession } = await import('aws-amplify/auth');
          const session = await fetchAuthSession();
          authToken = session.tokens?.accessToken?.toString() || null;
        } catch {
          return; // Can't connect without auth
        }
      }

      if (!authToken) return;

      // Determine WebSocket URL — in dev, use relative path (Vite proxy handles it)
      // In production, connect to the backend URL directly
      const wsUrl = import.meta.env.VITE_API_URL
        ? import.meta.env.VITE_API_URL.replace(/\/api\/v1$/, '')
        : window.location.origin;

      const socket = io(wsUrl, {
        path: '/ws/agent',
        auth: { token: authToken },
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 2000,
        reconnectionDelayMax: 10000,
        reconnectionAttempts: 10,
      });

      socket.on('connect', () => {
        socket.emit('subscribe:approvals');
      });

      socket.on('approval:requested', () => {
        queryClient.invalidateQueries({ queryKey: ['approvals'] });
      });

      socket.on('approval:decided', () => {
        queryClient.invalidateQueries({ queryKey: ['approvals'] });
        queryClient.invalidateQueries({ queryKey: ['approval'] });
      });

      socketRef.current = socket;
    };

    connectSocket();

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [queryClient]);

  return socketRef;
}

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ==========================================
// Mocks — vi.hoisted so they're available in vi.mock factories
// ==========================================

const { mockOn, mockTo, mockEmit, MockServer } = vi.hoisted(() => {
  const mockEmit = vi.fn();
  const mockTo = vi.fn(() => ({ emit: mockEmit }));
  const mockOn = vi.fn();
  const MockServer = vi.fn().mockImplementation(function () {
    return { on: mockOn, to: mockTo };
  });
  return { mockOn, mockTo, mockEmit, MockServer };
});

vi.mock('socket.io', () => ({
  Server: MockServer,
}));

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  initializeWebSocket,
  getSocketServer,
  emitWorkflowEvent,
  emitApprovalRequest,
  emitApprovalDecision,
} from './websocket.js';

// ==========================================
// Tests
// ==========================================

describe('websocket', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-setup mocks after clear
    mockTo.mockReturnValue({ emit: mockEmit });
    MockServer.mockImplementation(function () {
      return { on: mockOn, to: mockTo };
    });
  });

  describe('initializeWebSocket', () => {
    it('creates a Socket.io Server with correct options', () => {
      const fakeHttpServer = {} as any;
      const io = initializeWebSocket(fakeHttpServer);

      expect(MockServer).toHaveBeenCalledWith(fakeHttpServer, {
        path: '/ws/agent',
        cors: {
          origin: 'http://localhost:5190',
          methods: ['GET', 'POST'],
        },
      });
      expect(io).toBeDefined();
      expect(io.on).toBeDefined();
    });

    it('registers a connection event handler', () => {
      const fakeHttpServer = {} as any;
      initializeWebSocket(fakeHttpServer);

      expect(mockOn).toHaveBeenCalledWith('connection', expect.any(Function));
    });
  });

  describe('getSocketServer', () => {
    it('returns the io instance after initialization', () => {
      const fakeHttpServer = {} as any;
      const io = initializeWebSocket(fakeHttpServer);
      expect(getSocketServer()).toBe(io);
    });
  });

  describe('emitWorkflowEvent', () => {
    it('emits to the correct workflow room', () => {
      const fakeHttpServer = {} as any;
      initializeWebSocket(fakeHttpServer);

      emitWorkflowEvent('wf-123', 'workflow:status', { status: 'running' });

      expect(mockTo).toHaveBeenCalledWith('workflow:wf-123');
      expect(mockEmit).toHaveBeenCalledWith('workflow:status', { status: 'running' });
    });
  });

  describe('emitApprovalRequest', () => {
    it('emits approval:requested to the approvals room', () => {
      const fakeHttpServer = {} as any;
      initializeWebSocket(fakeHttpServer);

      emitApprovalRequest({ approvalId: 'ap-1' });

      expect(mockTo).toHaveBeenCalledWith('approvals');
      expect(mockEmit).toHaveBeenCalledWith('approval:requested', { approvalId: 'ap-1' });
    });
  });

  describe('emitApprovalDecision', () => {
    it('emits approval:decided to the approvals room', () => {
      const fakeHttpServer = {} as any;
      initializeWebSocket(fakeHttpServer);

      emitApprovalDecision({ approvalId: 'ap-1', decision: 'approved' });

      expect(mockTo).toHaveBeenCalledWith('approvals');
      expect(mockEmit).toHaveBeenCalledWith('approval:decided', { approvalId: 'ap-1', decision: 'approved' });
    });
  });

  describe('exports', () => {
    it('exports all 5 functions with correct types', () => {
      expect(typeof initializeWebSocket).toBe('function');
      expect(typeof getSocketServer).toBe('function');
      expect(typeof emitWorkflowEvent).toBe('function');
      expect(typeof emitApprovalRequest).toBe('function');
      expect(typeof emitApprovalDecision).toBe('function');
    });
  });
});

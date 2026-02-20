import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { logAgentEvent } from './event-logger.js';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import { logger } from '../utils/logger.js';

describe('logAgentEvent', () => {
  const baseInput = {
    workflowId: 'wf-123',
    agent: 'document-agent',
    action: 'extract_text',
    data: { documentId: 'doc-1', pages: 5 },
  };

  const fakeEvent = {
    id: 'evt-1',
    workflowId: 'wf-123',
    taskId: null,
    agent: 'document-agent',
    action: 'extract_text',
    data: { documentId: 'doc-1', pages: 5 },
    level: 'info',
    timestamp: new Date(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates an AgentEvent record with correct fields', async () => {
    prismaMock.agentEvent.create.mockResolvedValueOnce(fakeEvent as never);

    const result = await logAgentEvent(baseInput);

    expect(prismaMock.agentEvent.create).toHaveBeenCalledWith({
      data: {
        workflowId: 'wf-123',
        taskId: null,
        agent: 'document-agent',
        action: 'extract_text',
        data: { documentId: 'doc-1', pages: 5 },
        level: 'info',
      },
    });
    expect(result).toEqual(fakeEvent);
  });

  it('defaults level to info when not provided', async () => {
    prismaMock.agentEvent.create.mockResolvedValueOnce(fakeEvent as never);

    await logAgentEvent(baseInput);

    expect(prismaMock.agentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ level: 'info' }),
      })
    );
  });

  it('supports optional taskId', async () => {
    const eventWithTask = { ...fakeEvent, taskId: 'task-42' };
    prismaMock.agentEvent.create.mockResolvedValueOnce(eventWithTask as never);

    const result = await logAgentEvent({ ...baseInput, taskId: 'task-42' });

    expect(prismaMock.agentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ taskId: 'task-42' }),
      })
    );
    expect(result?.taskId).toBe('task-42');
  });

  it('supports optional level', async () => {
    const eventWithLevel = { ...fakeEvent, level: 'error' };
    prismaMock.agentEvent.create.mockResolvedValueOnce(eventWithLevel as never);

    const result = await logAgentEvent({ ...baseInput, level: 'error' });

    expect(prismaMock.agentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ level: 'error' }),
      })
    );
    expect(result?.level).toBe('error');
  });

  it('does NOT throw on database error — returns null instead', async () => {
    prismaMock.agentEvent.create.mockRejectedValueOnce(new Error('DB connection lost'));

    const result = await logAgentEvent(baseInput);

    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to log agent event'),
      expect.objectContaining({ error: expect.any(Error) })
    );
  });
});

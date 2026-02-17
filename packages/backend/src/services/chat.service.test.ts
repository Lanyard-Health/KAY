import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreate = vi.hoisted(() => {
  process.env['ANTHROPIC_API_KEY'] = 'test-key';
  process.env['AI_MODEL'] = 'test-model';
  process.env['AI_DAILY_TOKEN_BUDGET'] = '100000';
  return vi.fn();
});

vi.mock('@anthropic-ai/sdk', () => {
  const MockAnthropic = function (this: any) {
    this.messages = { create: mockCreate };
  };
  return { default: MockAnthropic };
});

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../middleware/practiceScope.middleware.js', () => ({
  getPracticeProviderFilter: vi.fn().mockReturnValue({}),
  getPracticeRelationFilter: vi.fn().mockReturnValue({}),
}));

import { sendChatMessage, getUserConversations, getConversationMessages } from './chat.service.js';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import { createMockRequest } from '../../tests/helpers/mock-express.js';

function makeAnthropicResponse(text: string) {
  return {
    content: [{ type: 'text', text }],
    usage: { input_tokens: 100, output_tokens: 200 },
  };
}

function makeReq() {
  return createMockRequest({
    user: { id: 'user-1', role: 'admin' },
    practiceScope: { isSuperAdmin: true, practiceIds: [] },
  } as any);
}

const defaultAggregateResult = {
  _sum: { promptTokens: 0, completionTokens: 0 },
  _count: null as any,
  _avg: null as any,
  _min: null as any,
  _max: null as any,
};

beforeEach(() => {
  vi.clearAllMocks();
  // Default: token budget allowed — checkTokenBudget calls BOTH aggregates
  prismaMock.aiRecommendation.aggregate.mockResolvedValue(defaultAggregateResult);
  prismaMock.chatMessage.aggregate.mockResolvedValue(defaultAggregateResult);
  // Default: empty context queries
  prismaMock.payerEnrollment.findMany.mockResolvedValue([]);
  prismaMock.license.findMany.mockResolvedValue([]);
  prismaMock.boardCertification.findMany.mockResolvedValue([]);
  prismaMock.provider.findMany.mockResolvedValue([]);
  prismaMock.task.findMany.mockResolvedValue([]);
});

describe('chat.service', () => {
  describe('sendChatMessage', () => {
    it('creates new conversation when conversationId not provided', async () => {
      prismaMock.chatConversation.create.mockResolvedValue({ id: 'conv-1', title: 'Test' } as any);
      prismaMock.chatMessage.create.mockResolvedValue({ id: 'msg-1', createdAt: new Date() } as any);
      prismaMock.chatMessage.findMany.mockResolvedValue([]);
      prismaMock.chatConversation.update.mockResolvedValue({} as any);

      mockCreate.mockResolvedValue(makeAnthropicResponse('Hello! How can I help?'));

      const result = await sendChatMessage({
        userId: 'user-1',
        message: 'What enrollments are overdue?',
        req: makeReq(),
      });

      expect(result.conversationId).toBe('conv-1');
      expect(result.message.content).toBe('Hello! How can I help?');
      expect(prismaMock.chatConversation.create).toHaveBeenCalled();
    });

    it('uses existing conversation when conversationId provided', async () => {
      prismaMock.chatConversation.findFirst.mockResolvedValue({ id: 'conv-existing' } as any);
      prismaMock.chatMessage.create.mockResolvedValue({ id: 'msg-2', createdAt: new Date() } as any);
      prismaMock.chatMessage.findMany.mockResolvedValue([]);
      prismaMock.chatConversation.update.mockResolvedValue({} as any);

      mockCreate.mockResolvedValue(makeAnthropicResponse('Here are your enrollments.'));

      const result = await sendChatMessage({
        userId: 'user-1',
        conversationId: 'conv-existing',
        message: 'Show me overdue enrollments',
        req: makeReq(),
      });

      expect(result.conversationId).toBe('conv-existing');
      expect(prismaMock.chatConversation.create).not.toHaveBeenCalled();
    });

    it('throws when conversation not found', async () => {
      prismaMock.chatConversation.findFirst.mockResolvedValue(null);

      await expect(sendChatMessage({
        userId: 'user-1',
        conversationId: 'nonexistent',
        message: 'test',
        req: makeReq(),
      })).rejects.toThrow('Conversation not found');
    });

    it('throws when token budget exceeded', async () => {
      const overBudget = {
        _sum: { promptTokens: 999999, completionTokens: 999999 },
        _count: null as any,
        _avg: null as any,
        _min: null as any,
        _max: null as any,
      };
      prismaMock.chatMessage.aggregate.mockResolvedValue(overBudget);
      prismaMock.aiRecommendation.aggregate.mockResolvedValue(overBudget);

      await expect(sendChatMessage({
        userId: 'user-1',
        message: 'test',
        req: makeReq(),
      })).rejects.toThrow(/token budget exceeded/i);
    });

    it('throws when message is empty after sanitization', async () => {
      await expect(sendChatMessage({
        userId: 'user-1',
        message: '   ',
        req: makeReq(),
      })).rejects.toThrow(/empty after sanitization/i);
    });

    it('saves assistant message with token counts', async () => {
      prismaMock.chatConversation.create.mockResolvedValue({ id: 'conv-1' } as any);
      prismaMock.chatMessage.create.mockResolvedValue({ id: 'msg-1', createdAt: new Date() } as any);
      prismaMock.chatMessage.findMany.mockResolvedValue([]);
      prismaMock.chatConversation.update.mockResolvedValue({} as any);

      mockCreate.mockResolvedValue(makeAnthropicResponse('Response text'));

      await sendChatMessage({ userId: 'user-1', message: 'test message', req: makeReq() });

      // Second chatMessage.create call is the assistant message
      const calls = prismaMock.chatMessage.create.mock.calls;
      const assistantCall = calls[calls.length - 1]![0];
      expect(assistantCall.data).toEqual(expect.objectContaining({
        role: 'assistant',
        promptTokens: 100,
        completionTokens: 200,
      }));
    });
  });

  describe('getUserConversations', () => {
    it('returns conversations with last message preview', async () => {
      prismaMock.chatConversation.findMany.mockResolvedValue([{
        id: 'conv-1',
        title: 'Enrollment help',
        messages: [{ content: 'Latest response from AI about enrollments and other topics that is longer than 100 characters to test truncation behavior in the preview', role: 'assistant', createdAt: new Date() }],
        createdAt: new Date(),
        updatedAt: new Date(),
      }] as any);

      const result = await getUserConversations('user-1');

      expect(result).toHaveLength(1);
      expect(result[0]!.title).toBe('Enrollment help');
      expect(result[0]!.lastMessage).toBeTruthy();
      expect(result[0]!.lastMessage!.content.length).toBeLessThanOrEqual(100);
    });

    it('returns null lastMessage when conversation has no messages', async () => {
      prismaMock.chatConversation.findMany.mockResolvedValue([{
        id: 'conv-1',
        title: 'Empty conv',
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      }] as any);

      const result = await getUserConversations('user-1');

      expect(result[0]!.lastMessage).toBeNull();
    });
  });

  describe('getConversationMessages', () => {
    it('returns messages for owned conversation', async () => {
      prismaMock.chatConversation.findFirst.mockResolvedValue({
        id: 'conv-1', title: 'Test', createdAt: new Date(),
      } as any);
      prismaMock.chatMessage.findMany.mockResolvedValue([
        { id: 'msg-1', role: 'user', content: 'Hello', metadata: null, createdAt: new Date() },
        { id: 'msg-2', role: 'assistant', content: 'Hi there', metadata: { intent: 'general' }, createdAt: new Date() },
      ] as any);

      const result = await getConversationMessages('conv-1', 'user-1');

      expect(result.messages).toHaveLength(2);
      expect(result.conversation.id).toBe('conv-1');
    });

    it('throws when conversation not owned by user', async () => {
      prismaMock.chatConversation.findFirst.mockResolvedValue(null);

      await expect(getConversationMessages('conv-1', 'wrong-user'))
        .rejects.toThrow('Conversation not found');
    });
  });
});

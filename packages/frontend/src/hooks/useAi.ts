import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api } from '../services/api';

// ===========================
// Types
// ===========================

export interface AiStatus {
  configured: boolean;
  model: string;
  dailyTokenBudget: number;
  todayUsage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface GeneratedEmail {
  subject: string;
  body: string;
  htmlBody: string;
  tone: string;
  escalationLevel: number;
}

export interface EmailGenerationResult {
  email: GeneratedEmail;
  recommendation: { id: string };
}

export interface EnrollmentAnalysis {
  urgencyScore: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  recommendations: string[];
  nextSteps: string[];
  reasoning: string;
}

export interface PortfolioItem {
  enrollmentId: string;
  providerName: string;
  payerName: string;
  status: string;
  urgencyScore: number;
  riskLevel: string;
  recommendation: string;
  daysSinceApplication: number | null;
  daysSinceLastFollowUp: number | null;
}

export interface PortfolioAnalysis {
  enrollments: PortfolioItem[];
  summary: string;
}

export interface AiRecommendation {
  id: string;
  enrollmentId: string;
  type: 'follow_up_email' | 'strategy' | 'priority_alert';
  status: 'pending' | 'accepted' | 'dismissed' | 'expired';
  title: string;
  content: string;
  reasoning: string | null;
  metadata: Record<string, unknown>;
  promptTokens: number;
  completionTokens: number;
  modelUsed: string | null;
  actedOnBy: string | null;
  actedOnAt: string | null;
  createdAt: string;
  updatedAt: string;
  enrollment: {
    provider: { firstName: string; lastName: string; npi: string };
    payer: { name: string };
  };
}

export interface AiUsage {
  today: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  budget: {
    daily: number;
    used: number;
    remaining: number;
    allowed: boolean;
    percentUsed: number;
  };
}

// ===========================
// Hooks
// ===========================

export function useAiStatus() {
  return useQuery({
    queryKey: ['ai-status'],
    queryFn: async () => {
      const { data } = await api.get<{ success: boolean; data: AiStatus }>('/ai/status');
      return data;
    },
    staleTime: 60 * 1000,
  });
}

export function useAiUsage() {
  return useQuery({
    queryKey: ['ai-usage'],
    queryFn: async () => {
      const { data } = await api.get<{ success: boolean; data: AiUsage }>('/ai/usage');
      return data;
    },
    staleTime: 30 * 1000,
  });
}

export function useAiRecommendations(filters?: { type?: string; status?: string; enrollmentId?: string }) {
  const params = new URLSearchParams();
  if (filters?.type) params.set('type', filters.type);
  if (filters?.status) params.set('status', filters.status);
  if (filters?.enrollmentId) params.set('enrollmentId', filters.enrollmentId);
  const queryString = params.toString();

  return useQuery({
    queryKey: ['ai-recommendations', filters],
    queryFn: async () => {
      const { data } = await api.get<{ success: boolean; data: AiRecommendation[] }>(
        `/ai/recommendations${queryString ? `?${queryString}` : ''}`
      );
      return data;
    },
    staleTime: 30 * 1000,
  });
}

export function useGenerateEmail() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ enrollmentId, tone, additionalContext }: {
      enrollmentId: string;
      tone?: string;
      additionalContext?: string;
    }) => {
      const { data } = await api.post<{ success: boolean; data: EmailGenerationResult }>(
        `/ai/enrollment/${enrollmentId}/generate-email`,
        { tone, additionalContext }
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-recommendations'] });
      queryClient.invalidateQueries({ queryKey: ['ai-usage'] });
    },
    onError: (error: any) => {
      const message = error.response?.data?.error || error.message || 'Failed to generate email';
      toast.error(message);
    },
  });
}

export function useAnalyzeEnrollment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (enrollmentId: string) => {
      const { data } = await api.post<{ success: boolean; data: { analysis: EnrollmentAnalysis; recommendation: { id: string } } }>(
        `/ai/enrollment/${enrollmentId}/analyze`
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-recommendations'] });
      queryClient.invalidateQueries({ queryKey: ['ai-usage'] });
    },
    onError: (error: any) => {
      const message = error.response?.data?.error || error.message || 'Failed to analyze enrollment';
      toast.error(message);
    },
  });
}

export function useAnalyzePortfolio() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const { data } = await api.post<{ success: boolean; data: { analysis: PortfolioAnalysis; recommendation: { id: string } | null } }>(
        '/ai/portfolio/analyze'
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-recommendations'] });
      queryClient.invalidateQueries({ queryKey: ['ai-usage'] });
    },
    onError: (error: any) => {
      const message = error.response?.data?.error || error.message || 'Failed to analyze portfolio';
      toast.error(message);
    },
  });
}

export function useUpdateRecommendation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'accepted' | 'dismissed' }) => {
      const { data } = await api.patch<{ success: boolean; data: AiRecommendation }>(
        `/ai/recommendations/${id}`,
        { status }
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-recommendations'] });
    },
    onError: (error: any) => {
      const message = error.response?.data?.error || error.message || 'Failed to update recommendation';
      toast.error(message);
    },
  });
}

// ===========================
// Chat Types
// ===========================

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}

export interface ChatConversation {
  id: string;
  title: string | null;
  lastMessage: {
    content: string;
    role: string;
    createdAt: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChatSendResponse {
  conversationId: string;
  message: ChatMessage;
}

// ===========================
// Chat Hooks
// ===========================

export function useChatConversations() {
  return useQuery({
    queryKey: ['chat-conversations'],
    queryFn: async () => {
      const { data } = await api.get<{ success: boolean; data: ChatConversation[] }>(
        '/ai/chat/conversations'
      );
      return data;
    },
    staleTime: 30 * 1000,
  });
}

export function useChatMessages(conversationId: string | null) {
  return useQuery({
    queryKey: ['chat-messages', conversationId],
    queryFn: async () => {
      const { data } = await api.get<{
        success: boolean;
        data: { conversation: { id: string; title: string | null; createdAt: string }; messages: ChatMessage[] };
      }>(`/ai/chat/conversations/${conversationId}/messages`);
      return data;
    },
    enabled: !!conversationId,
    staleTime: 10 * 1000,
  });
}

export function useSendChatMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ conversationId, message }: { conversationId?: string; message: string }) => {
      const { data } = await api.post<{ success: boolean; data: ChatSendResponse }>(
        '/ai/chat',
        { conversationId, message }
      );
      return data;
    },
    onMutate: async ({ conversationId, message }) => {
      // Optimistic update: add user message to cache immediately
      if (conversationId) {
        await queryClient.cancelQueries({ queryKey: ['chat-messages', conversationId] });
        const previous = queryClient.getQueryData(['chat-messages', conversationId]);
        queryClient.setQueryData(['chat-messages', conversationId], (old: any) => {
          if (!old?.data?.messages) return old;
          return {
            ...old,
            data: {
              ...old.data,
              messages: [
                ...old.data.messages,
                {
                  id: `optimistic-${Date.now()}`,
                  role: 'user',
                  content: message,
                  createdAt: new Date().toISOString(),
                },
              ],
            },
          };
        });
        return { previous, conversationId };
      }
      return {};
    },
    onError: (_error, _variables, context: any) => {
      // Rollback optimistic update on error
      if (context?.conversationId && context?.previous) {
        queryClient.setQueryData(['chat-messages', context.conversationId], context.previous);
      }
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: ['chat-conversations'] });
      queryClient.invalidateQueries({ queryKey: ['ai-usage'] });
      if (variables.conversationId) {
        queryClient.invalidateQueries({ queryKey: ['chat-messages', variables.conversationId] });
      }
    },
  });
}

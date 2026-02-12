import { z } from 'zod';

const toneEnum = z.enum(['polite', 'assertive', 'urgent']);

export const generateEmailSchema = z.object({
  tone: z.string().optional().transform(val => {
    const result = toneEnum.safeParse(val);
    return result.success ? result.data : undefined;
  }),
  additionalContext: z.string().max(2000).optional(),
});

export const expirationAlertSchema = z.object({
  days: z.number().int().min(1).max(365).default(90),
});

export const updateRecommendationSchema = z.object({
  status: z.enum(['accepted', 'dismissed']),
});

export const chatMessageSchema = z.object({
  message: z.string().min(1, 'Message is required').max(2000).trim(),
  conversationId: z.string().optional(),
});

export const chatConversationsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const recommendationsQuerySchema = z.object({
  type: z.string().optional(),
  status: z.string().optional(),
  enrollmentId: z.string().optional(),
});

export type GenerateEmailInput = z.infer<typeof generateEmailSchema>;
export type ExpirationAlertInput = z.infer<typeof expirationAlertSchema>;
export type UpdateRecommendationInput = z.infer<typeof updateRecommendationSchema>;
export type ChatMessageInput = z.infer<typeof chatMessageSchema>;
export type ChatConversationsQuery = z.infer<typeof chatConversationsQuerySchema>;
export type RecommendationsQuery = z.infer<typeof recommendationsQuerySchema>;

export const payerIntelligenceQuerySchema = z.object({
  payerId: z.string().uuid().optional(),
});

export const payerIntelligenceAnalyzeSchema = z.object({
  forceRefresh: z.boolean().optional().default(false),
});

export type PayerIntelligenceQuery = z.infer<typeof payerIntelligenceQuerySchema>;
export type PayerIntelligenceAnalyzeInput = z.infer<typeof payerIntelligenceAnalyzeSchema>;

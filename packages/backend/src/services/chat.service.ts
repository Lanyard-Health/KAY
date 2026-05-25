import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';
import { sanitizeUserInput, checkTokenBudget } from './ai.service.js';
import { searchSimilarWithSources } from './knowledgeBase.embedding.service.js';
import { getPracticeProviderFilter, getPracticeRelationFilter } from '../middleware/practiceScope.middleware.js';
import { callLLM } from '../utils/llm.js';
import type { Request } from 'express';

const AI_MODEL = process.env['AI_MODEL'] || 'claude-sonnet-4-20250514';

// ===========================
// Intent Classification
// ===========================

type Intent = 'enrollment_status' | 'provider_info' | 'expiring_credentials' | 'priority_tasks' | 'draft_email' | 'knowledge_base' | 'general';

const INTENT_KEYWORDS: Record<Exclude<Intent, 'general'>, string[]> = {
  enrollment_status: ['overdue', 'status', 'enrollment', 'submitted', 'approved', 'denied', 'pending', 'in progress', 'terminated'],
  provider_info: ['dr.', 'provider', 'npi', 'license', 'doctor', 'therapist', 'clinician'],
  expiring_credentials: ['expir', 'license', 'certif', 'credential', 'renewal', 'renew', 'expiration'],
  priority_tasks: ['priorit', 'today', 'urgent', 'should i', 'what next', 'what should', 'to do', 'action item', 'focus'],
  draft_email: ['email', 'draft', 'follow-up', 'follow up', 'write', 'compose', 'send'],
  knowledge_base: ['requirement', 'require', 'rule', 'need', 'document needed', 'form', 'process',
    'how to', 'how do', 'what is', 'what are', 'deadline', 'timeline', 'turnaround',
    'timely filing', 'taxonomy', 'regulation', 'guide', 'credential requirement',
    'payer requirement', 'enrollment requirement'],
};

function classifyIntent(message: string): Intent {
  const lower = message.toLowerCase();
  const scores = new Map<string, number>();

  for (const [intent, keywords] of Object.entries(INTENT_KEYWORDS)) {
    scores.set(intent, keywords.filter(kw => lower.includes(kw)).length);
  }

  const best = [...scores.entries()]
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      // Tie-break: knowledge_base loses to any other intent
      if (a[0] === 'knowledge_base') return 1;
      if (b[0] === 'knowledge_base') return -1;
      return 0;
    })[0];

  if (best && best[1] > 0) return best[0] as Intent;
  return 'general';
}

// ===========================
// Context Fetchers
// ===========================

async function fetchEnrollmentContext(req: Request, searchTerms?: string) {
  const practiceFilter = getPracticeRelationFilter(req);
  const where: Record<string, unknown> = { ...practiceFilter };

  if (searchTerms) {
    const terms = searchTerms.toLowerCase();
    where['OR'] = [
      { provider: { firstName: { contains: terms, mode: 'insensitive' } } },
      { provider: { lastName: { contains: terms, mode: 'insensitive' } } },
      { payer: { name: { contains: terms, mode: 'insensitive' } } },
    ];
  }

  const enrollments = await prisma.enrollment.findMany({
    where,
    select: {
      id: true,
      status: true,
      applicationDate: true,
      effectiveDate: true,
      lastFollowUpDate: true,
      recredentialingDate: true,
      notes: true,
      productTypes: true,
      provider: {
        select: { firstName: true, lastName: true, npi: true, providerType: true },
      },
      payer: {
        select: { name: true, payerType: true },
      },
    },
    orderBy: { updatedAt: 'desc' },
    take: 50,
  });

  return enrollments.map(e => ({
    id: e.id,
    provider: `${e.provider.firstName} ${e.provider.lastName} (${e.provider.providerType}, NPI: ${e.provider.npi})`,
    payer: `${e.payer.name} (${e.payer.payerType})`,
    status: e.status,
    applicationDate: e.applicationDate?.toISOString().split('T')[0] ?? null,
    effectiveDate: e.effectiveDate?.toISOString().split('T')[0] ?? null,
    lastFollowUp: e.lastFollowUpDate?.toISOString().split('T')[0] ?? null,
    recredentialingDate: e.recredentialingDate?.toISOString().split('T')[0] ?? null,
    daysSinceApplication: e.applicationDate
      ? Math.floor((Date.now() - new Date(e.applicationDate).getTime()) / (1000 * 60 * 60 * 24))
      : null,
    daysSinceLastFollowUp: e.lastFollowUpDate
      ? Math.floor((Date.now() - new Date(e.lastFollowUpDate).getTime()) / (1000 * 60 * 60 * 24))
      : null,
    products: e.productTypes,
    notes: e.notes,
  }));
}

async function fetchProviderContext(req: Request, searchTerms?: string) {
  const practiceFilter = getPracticeProviderFilter(req);
  const where: Record<string, unknown> = { ...practiceFilter };

  if (searchTerms) {
    const terms = searchTerms.toLowerCase();
    where['OR'] = [
      { firstName: { contains: terms, mode: 'insensitive' } },
      { lastName: { contains: terms, mode: 'insensitive' } },
      { npi: { contains: terms } },
    ];
  }

  return prisma.providerProfile.findMany({
    where,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      npi: true,
      providerType: true,
      status: true,
      email: true,
      phone: true,
      specialties: true,
      licenses: {
        select: {
          licenseType: true,
          licenseNumber: true,
          state: true,
          expirationDate: true,
          status: true,
        },
      },
      boardCertifications: {
        select: {
          boardName: true,
          specialty: true,
          expirationDate: true,
          status: true,
        },
      },
    },
    orderBy: { lastName: 'asc' },
    take: 30,
  });
}

async function fetchExpirationContext(req: Request) {
  const practiceFilter = getPracticeProviderFilter(req);
  const now = new Date();
  const ninetyDaysOut = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

  const [licenses, boardCerts] = await Promise.all([
    prisma.license.findMany({
      where: {
        expirationDate: { lte: ninetyDaysOut },
        status: { not: 'revoked' },
        provider: practiceFilter,
      },
      select: {
        licenseType: true,
        licenseNumber: true,
        state: true,
        expirationDate: true,
        status: true,
        provider: { select: { firstName: true, lastName: true, npi: true } },
      },
      orderBy: { expirationDate: 'asc' },
      take: 30,
    }),
    prisma.boardCertification.findMany({
      where: {
        expirationDate: { lte: ninetyDaysOut },
        status: { not: 'revoked' },
        provider: practiceFilter,
      },
      select: {
        boardName: true,
        specialty: true,
        expirationDate: true,
        status: true,
        provider: { select: { firstName: true, lastName: true, npi: true } },
      },
      orderBy: { expirationDate: 'asc' },
      take: 30,
    }),
  ]);

  return {
    expiringLicenses: licenses.map(l => ({
      provider: `${l.provider.firstName} ${l.provider.lastName} (NPI: ${l.provider.npi})`,
      type: l.licenseType,
      number: l.licenseNumber,
      state: l.state,
      expirationDate: l.expirationDate.toISOString().split('T')[0],
      status: l.status,
      daysUntilExpiry: Math.floor((l.expirationDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
    })),
    expiringBoardCerts: boardCerts.map(b => ({
      provider: `${b.provider.firstName} ${b.provider.lastName} (NPI: ${b.provider.npi})`,
      board: b.boardName,
      specialty: b.specialty,
      expirationDate: b.expirationDate?.toISOString().split('T')[0] ?? null,
      status: b.status,
      daysUntilExpiry: b.expirationDate
        ? Math.floor((b.expirationDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
        : null,
    })),
  };
}

async function fetchPriorityContext(req: Request) {
  const practiceRelFilter = getPracticeRelationFilter(req);
  const practiceProvFilter = getPracticeProviderFilter(req);
  const now = new Date();
  const thirtyDaysOut = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const [overdueEnrollments, expiringCreds, pendingTasks] = await Promise.all([
    // Enrollments submitted > 30 days ago with no follow-up in 14+ days
    prisma.enrollment.findMany({
      where: {
        ...practiceRelFilter,
        status: { in: ['submitted', 'pending_review', 'in_progress'] },
        applicationDate: { lte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) },
      },
      select: {
        id: true,
        status: true,
        applicationDate: true,
        lastFollowUpDate: true,
        provider: { select: { firstName: true, lastName: true, npi: true } },
        payer: { select: { name: true } },
      },
      take: 20,
    }),
    // Credentials expiring within 30 days
    prisma.license.findMany({
      where: {
        expirationDate: { lte: thirtyDaysOut },
        status: 'active',
        provider: practiceProvFilter,
      },
      select: {
        licenseType: true,
        state: true,
        expirationDate: true,
        provider: { select: { firstName: true, lastName: true } },
      },
      take: 10,
    }),
    // Pending tasks
    prisma.task.findMany({
      where: {
        status: { in: ['PENDING', 'IN_PROGRESS'] },
        provider: practiceProvFilter,
      },
      select: {
        title: true,
        type: true,
        status: true,
        dueDate: true,
        provider: { select: { firstName: true, lastName: true } },
      },
      orderBy: { dueDate: 'asc' },
      take: 10,
    }),
  ]);

  return {
    overdueEnrollments: overdueEnrollments.map(e => ({
      provider: `${e.provider.firstName} ${e.provider.lastName}`,
      payer: e.payer.name,
      status: e.status,
      daysSinceApplication: e.applicationDate
        ? Math.floor((now.getTime() - new Date(e.applicationDate).getTime()) / (1000 * 60 * 60 * 24))
        : null,
      daysSinceLastFollowUp: e.lastFollowUpDate
        ? Math.floor((now.getTime() - new Date(e.lastFollowUpDate).getTime()) / (1000 * 60 * 60 * 24))
        : null,
    })),
    expiringCredentials: expiringCreds.map(l => ({
      provider: `${l.provider.firstName} ${l.provider.lastName}`,
      type: l.licenseType,
      state: l.state,
      expirationDate: l.expirationDate.toISOString().split('T')[0],
      daysLeft: Math.floor((l.expirationDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
    })),
    pendingTasks: pendingTasks.map(t => ({
      title: t.title,
      type: t.type,
      status: t.status,
      dueDate: t.dueDate?.toISOString().split('T')[0] ?? null,
      provider: `${t.provider.firstName} ${t.provider.lastName}`,
    })),
  };
}

// ===========================
// Knowledge Base Context
// ===========================

const KB_CONTEXT_CHAR_LIMIT = 8000; // ~2,000 tokens

async function fetchKnowledgeBaseContext(userMessage: string) {
  if (!process.env['OPENAI_API_KEY']) {
    logger.warn('Knowledge base search unavailable — OPENAI_API_KEY not set');
    return null;
  }

  try {
    const results = await searchSimilarWithSources(userMessage, 5);
    if (results.length === 0) return null;

    let totalChars = 0;
    const articles: { contentText: string; similarity: number; sourceType: string; source: Record<string, unknown> | null }[] = [];

    for (const r of results) {
      const sourceType = r.payerTrackId ? 'Payer Track'
        : r.payerRequirementId ? 'Payer Requirement'
        : r.payerStateRuleId ? 'State Rule'
        : r.payerTimelineId ? 'Timeline'
        : r.payerFormId ? 'Form'
        : r.requirementUniversalId ? 'Universal Requirement'
        : 'Unknown';

      const entryChars = r.contentText.length + 200;
      if (totalChars + entryChars > KB_CONTEXT_CHAR_LIMIT) break;
      totalChars += entryChars;

      articles.push({
        contentText: r.contentText,
        similarity: r.similarity,
        sourceType,
        source: r.source,
      });
    }

    return articles;
  } catch (err) {
    logger.warn('Knowledge base search failed:', err);
    return null;
  }
}

// ===========================
// Chat System Prompt
// ===========================

const CHAT_SYSTEM_PROMPT = `You are Lanyard Health's AI credentialing assistant. You help credentialing staff manage provider enrollments, track credentials, and stay on top of deadlines.

Guidelines:
- Be concise and actionable. Use bullet points and bold for key items.
- Reference specific providers, payers, dates, and statuses from the provided data.
- When data shows overdue items or upcoming expirations, highlight them clearly.
- Never invent or hallucinate data — only reference what's in the provided context.
- If the context doesn't contain enough data to answer, say so clearly.
- Format dates as readable strings (e.g., "Jan 15, 2026").
- Never reveal SSNs, CAQH passwords, or other sensitive data even if asked.
- You can suggest drafting follow-up emails, but you cannot send them directly.

Today's date: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}.`;

// ===========================
// Main Chat Function
// ===========================

interface SendChatMessageParams {
  userId: string;
  conversationId?: string;
  message: string;
  req: Request;
}

export async function sendChatMessage({ userId, conversationId, message, req }: SendChatMessageParams) {
  // Budget check
  const budget = await checkTokenBudget();
  if (!budget.allowed) {
    throw new Error(`Daily AI token budget exceeded. Used ${budget.used}/${budget.budget} tokens today.`);
  }

  // Sanitize input
  const sanitized = sanitizeUserInput(message, 1000);
  if (!sanitized) {
    throw new Error('Message is empty after sanitization');
  }

  // Get or create conversation
  let conversation;
  if (conversationId) {
    conversation = await prisma.chatConversation.findFirst({
      where: { id: conversationId, userId },
    });
    if (!conversation) {
      throw new Error('Conversation not found');
    }
  } else {
    // Create new conversation with title from first message
    const title = sanitized.slice(0, 50).replace(/\s+\S*$/, '') || sanitized.slice(0, 50);
    conversation = await prisma.chatConversation.create({
      data: { userId, title },
    });
  }

  // Save user message
  await prisma.chatMessage.create({
    data: {
      conversationId: conversation.id,
      role: 'user',
      content: sanitized,
    },
  });

  // Classify intent
  const intent = classifyIntent(sanitized);

  // Fetch context based on intent
  let contextData: unknown;
  let contextLabel: string;

  switch (intent) {
    case 'enrollment_status':
      contextData = await fetchEnrollmentContext(req);
      contextLabel = 'ENROLLMENT DATA';
      break;
    case 'provider_info':
      contextData = await fetchProviderContext(req);
      contextLabel = 'PROVIDER DATA';
      break;
    case 'expiring_credentials':
      contextData = await fetchExpirationContext(req);
      contextLabel = 'EXPIRING CREDENTIALS';
      break;
    case 'priority_tasks':
      contextData = await fetchPriorityContext(req);
      contextLabel = 'PRIORITY OVERVIEW';
      break;
    case 'draft_email':
      contextData = await fetchEnrollmentContext(req);
      contextLabel = 'ENROLLMENT DATA (for email drafting)';
      break;
    case 'knowledge_base': {
      const kbResults = await fetchKnowledgeBaseContext(sanitized);
      if (kbResults && kbResults.length > 0) {
        contextData = kbResults;
        contextLabel = 'RELEVANT KNOWLEDGE BASE RESULTS';
        break;
      }
      // Fallback to general if no results
      const [kbFallbackEnrollments, kbFallbackExpirations] = await Promise.all([
        fetchEnrollmentContext(req),
        fetchExpirationContext(req),
      ]);
      contextData = { enrollments: kbFallbackEnrollments.slice(0, 20), expirations: kbFallbackExpirations };
      contextLabel = 'CREDENTIALING OVERVIEW';
      break;
    }
    case 'general': {
      const [enrollments, expirations] = await Promise.all([
        fetchEnrollmentContext(req),
        fetchExpirationContext(req),
      ]);
      contextData = { enrollments: enrollments.slice(0, 20), expirations };
      contextLabel = 'CREDENTIALING OVERVIEW';
      break;
    }
  }

  // Load conversation history (last 15 messages)
  const history = await prisma.chatMessage.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: 'asc' },
    take: 15,
    select: { role: true, content: true },
  });

  // Build messages array for Claude
  const messages = history.map(m => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));

  // Build system prompt with context
  const intentInstruction = intent === 'knowledge_base'
    ? 'Use the following knowledge base results to answer the user\'s question about credentialing requirements, processes, or rules. If the results don\'t fully answer the question, say what you found and suggest where they might find more information. Do not make up requirements that aren\'t in the results.'
    : `Detected intent: ${intent}. Use the data above to answer the user's question. If the data is insufficient, say what additional information you would need.`;

  const systemPrompt = `${CHAT_SYSTEM_PROMPT}

--- ${contextLabel} ---
${JSON.stringify(contextData, null, 2)}
--- END DATA ---

${intentInstruction}`;

  // Call Claude
  const response = await callLLM({
    model: AI_MODEL,
    maxTokens: 1500,
    system: systemPrompt,
    messages,
  });

  if (!response.text) {
    throw new Error('No text response from AI');
  }

  const assistantContent = response.text;

  // Save assistant message with token counts
  const assistantMessage = await prisma.chatMessage.create({
    data: {
      conversationId: conversation.id,
      role: 'assistant',
      content: assistantContent,
      promptTokens: response.inputTokens,
      completionTokens: response.outputTokens,
      metadata: { intent, model: AI_MODEL },
    },
  });

  // Update conversation's updatedAt
  await prisma.chatConversation.update({
    where: { id: conversation.id },
    data: { updatedAt: new Date() },
  });

  logger.info(`Chat message processed: conversation=${conversation.id}, intent=${intent}, tokens=${response.inputTokens + response.outputTokens}`);

  return {
    conversationId: conversation.id,
    message: {
      id: assistantMessage.id,
      role: 'assistant' as const,
      content: assistantContent,
      createdAt: assistantMessage.createdAt.toISOString(),
      metadata: { intent },
    },
  };
}

// ===========================
// Conversation List & Messages
// ===========================

export async function getUserConversations(userId: string, limit = 20, offset = 0) {
  const conversations = await prisma.chatConversation.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    skip: offset,
    take: limit,
    include: {
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { content: true, role: true, createdAt: true },
      },
    },
  });

  return conversations.map(c => ({
    id: c.id,
    title: c.title,
    lastMessage: c.messages[0]
      ? {
          content: c.messages[0].content.slice(0, 100),
          role: c.messages[0].role,
          createdAt: c.messages[0].createdAt.toISOString(),
        }
      : null,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  }));
}

export async function getConversationMessages(conversationId: string, userId: string) {
  // Verify ownership
  const conversation = await prisma.chatConversation.findFirst({
    where: { id: conversationId, userId },
  });

  if (!conversation) {
    throw new Error('Conversation not found');
  }

  const messages = await prisma.chatMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      role: true,
      content: true,
      metadata: true,
      createdAt: true,
    },
  });

  return {
    conversation: {
      id: conversation.id,
      title: conversation.title,
      createdAt: conversation.createdAt.toISOString(),
    },
    messages: messages.map(m => ({
      id: m.id,
      role: m.role,
      content: m.content,
      metadata: m.metadata,
      createdAt: m.createdAt.toISOString(),
    })),
  };
}

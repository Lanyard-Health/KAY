import 'dotenv/config';
import { initSentry } from './utils/sentry.js';
initSentry();

import { validateEnv } from './utils/env.js';

// Validate environment variables before anything else
const env = validateEnv();

import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Sentry from '@sentry/node';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';

import { errorHandler } from './middleware/error.middleware.js';
import { auditMiddleware } from './middleware/audit.middleware.js';
import { attachPracticeScope } from './middleware/practiceScope.middleware.js';
import { logger } from './utils/logger.js';

// Routes
import { authRoutes } from './routes/auth.routes.js';
import { providerRoutes } from './routes/provider.routes.js';
import { documentRoutes } from './routes/document.routes.js';
import { credentialRoutes } from './routes/credential.routes.js';
import { credentialExtendedRoutes } from './routes/credentialExtended.routes.js';
import { userRoutes } from './routes/user.routes.js';
import { caqhRoutes } from './routes/caqh.routes.js';
import { integrationsRoutes } from './routes/integrations.routes.js';
import { payerRoutes } from './routes/payer.routes.js';
import { expirationRoutes } from './routes/expiration.routes.js';
import { auditRoutes } from './routes/audit.routes.js';
import practiceLocationRoutes from './routes/practiceLocation.routes.js';
import practicePayerRoutes from './routes/practicePayer.routes.js';
import formFillRoutes from './routes/form-fill.routes.js';
import checklistRoutes from './routes/checklist.routes.js';
import enrollmentRoutes from './routes/enrollment.routes.js';
import enrollmentWorkflowRoutes from './routes/enrollment-workflow.routes.js';
import followUpRoutes from './routes/followup.routes.js';
import { npiRoutes } from './routes/npi.routes.js';
import { pecosRoutes } from './routes/pecos.routes.js';
import { aiRoutes } from './routes/ai.routes.js';
import portalOnboardingRoutes from './routes/portal-onboarding.routes.js';
import portalDocumentRoutes from './routes/portal-documents.routes.js';
import practiceDocumentRoutes from './routes/practice-documents.routes.js';
import adminOnboardingRoutes from './routes/admin-onboarding.routes.js';
import agentInsightsRoutes from './routes/agent-insights.routes.js';
import portalRoutes from './routes/portal.routes.js';
import taskRoutes from './routes/task.routes.js';
import terminationLetterRoutes from './routes/terminationLetter.routes.js';
import practiceSignupRoutes from './routes/practiceSignup.routes.js';
import practiceRoutes from './routes/practice.routes.js';
import emailRoutes from './routes/email.routes.js';
import { payerIntelligenceRoutes } from './routes/payerIntelligence.routes.js';
import notificationRoutes from './routes/notification.routes.js';
import { payerEnrollmentDataRoutes } from './routes/payerEnrollmentData.routes.js';
import dashboardRoutes from './routes/dashboard.routes.js';
import providerImportRoutes from './routes/providerImport.routes.js';
import reportingRoutes from './routes/reporting.routes.js';
import { aetnaRoutes } from './routes/aetna.routes.js';
import { agentRoutes } from './routes/agent.routes.js';
// approval.routes.ts removed — agent.routes.ts provides the same endpoints with proper practice scoping
import searchRoutes from './routes/search.routes.js';
import commandCenterRoutes from './routes/command-center.routes.js';
import { knowledgeBaseRoutes } from './routes/knowledgeBase.routes.js';
import { workflowTemplateRoutes } from './routes/workflowTemplate.routes.js';
import { followupTemplateRoutes } from './routes/followupTemplate.routes.js';
import { workflowApprovalRoutes } from './routes/workflowApproval.routes.js';
import { retellRoutes } from './routes/retell.routes.js';
import { denialTriageRoutes } from './routes/denial-triage.routes.js';
import { bugReportRoutes } from './routes/bug-report.routes.js';
import clinicalProfileRoutes from './routes/clinicalProfile.routes.js';
import practiceSettingsRoutes from './routes/practiceSettings.routes.js';
import emailTemplateRoutes, { emailLogRouter } from './routes/emailTemplate.routes.js';
import emailTemplateReadRoutes from './routes/emailTemplateRead.routes.js';
import webhookRoutes from './routes/webhook.routes.js';
import webhookSubscriptionRoutes from './routes/webhook-subscription.routes.js';
import { wellKnownRoutes } from './routes/well-known.routes.js';
import { initBugMonitor } from './services/bug-monitor/index.js';
import { bugMonitorErrorMiddleware, registerProcessHandlers } from './middleware/bug-monitor.middleware.js';
import { initializeWebSocket } from './agents/websocket.js';
import { initializeWorkers, closeAllWorkers } from './agents/workers.js';
import { initializeWebhookDeliveryWorker, closeWebhookDeliveryWorker } from './agents/webhook-delivery-worker.js';
import { closeAllQueues } from './agents/queues.js';
import { closeRedisConnection, isRedisConfigured, getRedisConnection } from './utils/redis.js';
import { schedulerService } from './services/scheduler.service.js';
import { prisma } from './utils/prisma.js';

const app = express();
const PORT = process.env['PORT'] || 3002;
let serverReady = false;

// Trust first proxy (Render) so rate limiter sees real client IPs, not proxy IP
app.set('trust proxy', 1);

// Mock portals — local fake-portal static sites for browser-automation demos.
// Mounted BEFORE helmet so the inline styles in the static HTML aren't blocked
// by the global CSP. Gated on NODE_ENV !== 'production' so they're never
// exposed in prod.
if (process.env['NODE_ENV'] !== 'production') {
  const staticDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'static');
  app.use('/mock-availity', express.static(path.join(staticDir, 'mock-availity'), { extensions: ['html'] }));
  app.use('/mock-aetna', express.static(path.join(staticDir, 'mock-aetna'), { extensions: ['html'] }));
}

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true,
  },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));

const allowedOrigins = [
  process.env['FRONTEND_URL'],
  ...(process.env['NODE_ENV'] !== 'production' ? ['http://localhost:5190'] : []),
].filter(Boolean) as string[];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (server-to-server, curl, health checks)
    if (!origin) {
      callback(null, true);
    } else if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else if (process.env['NODE_ENV'] !== 'production' && /^https?:\/\/localhost(:\d+)?$/.test(origin)) {
      // In dev, allow any localhost port (Vite may pick a different port if 5190 is taken)
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    // X-Dev-Role only in non-production — prevents header injection in staging/prod
    ...(process.env['NODE_ENV'] !== 'production' ? ['X-Dev-Role'] : []),
  ],
  maxAge: 600, // Cache preflight for 10 minutes
}));

// Rate limiting (skip in dev/test to avoid throttling E2E tests)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // limit each IP to 1000 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});
if (process.env['NODE_ENV'] === 'production') {
  app.use('/api', limiter);
}

// Webhook routes — MUST be mounted BEFORE express.json() so the raw body
// is available for HMAC signature verification. Each webhook route uses
// express.raw() locally to capture its own body bytes.
app.use('/api/v1/webhooks', webhookRoutes);

// Body parsing and compression
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(compression());

// Logging
app.use(morgan('combined', {
  stream: {
    write: (message: string) => logger.info(message.trim()),
  },
}));

// Audit logging middleware
app.use(auditMiddleware);

// Practice scope middleware (must run after authenticate in each route)
app.use(attachPracticeScope);

// Root route — redirect to frontend
app.get('/', (_req, res) => {
  res.redirect(process.env['FRONTEND_URL'] || 'http://localhost:5190');
});

// Health check (with readiness + connectivity info)
async function healthCheck(_req: express.Request, res: express.Response) {
  const raceTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
    Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);

  // Database check
  let database: 'ok' | 'error' = 'error';
  try {
    await raceTimeout(prisma.$queryRaw`SELECT 1`, 3000);
    database = 'ok';
  } catch {
    database = 'error';
  }

  // Redis check
  let redis: 'ok' | 'error' | 'not_configured' = 'not_configured';
  if (isRedisConfigured()) {
    try {
      const client = getRedisConnection();
      await raceTimeout(client.ping(), 3000);
      redis = 'ok';
    } catch {
      redis = 'error';
    }
  }

  const checks = { database, redis };

  let status: 'healthy' | 'degraded' | 'unhealthy';
  let statusCode: number;

  if (!serverReady || database === 'error') {
    status = 'unhealthy';
    statusCode = 503;
  } else if (redis === 'error') {
    status = 'degraded';
    statusCode = 200;
  } else {
    status = 'healthy';
    statusCode = 200;
  }

  res.status(statusCode).json({ status, ready: serverReady, checks, timestamp: new Date().toISOString() });
}

app.get('/health', healthCheck);
app.get('/api/health', healthCheck);

// Public verification keys for AgentEvent signatures (Phase 0.A).
// Mounted BEFORE the /api readiness gate so external verifiers can fetch keys
// at any time, including during server startup. No auth — keys are public.
app.use('/.well-known', wellKnownRoutes);

// Readiness gate — block /api requests until server is fully initialized
app.use('/api', (_req, res, next) => {
  if (!serverReady) {
    res.status(503).json({ error: 'Server starting', retry: true });
    return;
  }
  next();
});

// API Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/providers', providerRoutes);
app.use('/api/v1/documents', documentRoutes);
app.use('/api/v1/credentials', credentialRoutes);
app.use('/api/v1/credentials', credentialExtendedRoutes);
app.use('/api/v1/credentials', payerEnrollmentDataRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/caqh', caqhRoutes);
app.use('/api/v1/integrations', integrationsRoutes);
app.use('/api/v1/payers', payerRoutes);
app.use('/api/v1/expirations', expirationRoutes);
app.use('/api/v1/audit', auditRoutes);
app.use('/api/v1/practice-locations', practiceLocationRoutes);
app.use('/api/v1/practice-payers', practicePayerRoutes);
app.use('/api/v1/practices/:practiceId/documents', practiceDocumentRoutes);
app.use('/api/v1', formFillRoutes);
app.use('/api/v1/checklist', checklistRoutes);
app.use('/api/v1/enrollments', enrollmentWorkflowRoutes);
app.use('/api/v1/enrollments', enrollmentRoutes);
app.use('/api/v1/follow-up', followUpRoutes);
app.use('/api/v1/npi', npiRoutes);
app.use('/api/v1/pecos', pecosRoutes);
app.use('/api/v1/ai', aiRoutes);
app.use('/api/v1/portal/onboarding', portalOnboardingRoutes);
app.use('/api/v1/portal/documents', portalDocumentRoutes);
app.use('/api/v1/portal/admin/onboarding', adminOnboardingRoutes);
app.use('/api/v1/admin/insights', agentInsightsRoutes);
app.use('/api/v1/portal', portalRoutes);
app.use('/api/v1', taskRoutes);
app.use('/api/v1', terminationLetterRoutes);
app.use('/api/v1/practices', practiceSignupRoutes);
app.use('/api/v1/practices', practiceRoutes);
app.use('/api/v1/email', emailRoutes);
app.use('/api/v1/payer-intelligence', payerIntelligenceRoutes);
app.use('/api/v1/notifications', notificationRoutes);
app.use('/api/v1/dashboard', dashboardRoutes);
app.use('/api/v1/provider-import', providerImportRoutes);
app.use('/api/v1/reporting', reportingRoutes);
app.use('/api/v1/enrollments/:enrollmentId/aetna', aetnaRoutes);

app.use('/api/v1/search', searchRoutes);
app.use('/api/v1/command-center', commandCenterRoutes);
app.use('/api/v1/agent', agentRoutes);
// approval.routes.ts removed — agent.routes.ts handles /api/v1/agent/approvals with practice scoping
app.use('/api/v1/knowledge-base', knowledgeBaseRoutes);
app.use('/api/v1/knowledge-base/workflow-templates', workflowTemplateRoutes);
app.use('/api/v1/followup-templates', followupTemplateRoutes);
app.use('/api/v1/workflow-approvals', workflowApprovalRoutes);
app.use('/api/v1/retell', retellRoutes);
app.use('/api/v1/denials', denialTriageRoutes);
app.use('/api/v1/bugs', bugReportRoutes);
app.use('/api/v1/clinical-profile', clinicalProfileRoutes);
app.use('/api/v1/email-templates', emailTemplateReadRoutes);
app.use('/api/v1/admin/practices', practiceSettingsRoutes);
app.use('/api/v1/admin/email-templates', emailTemplateRoutes);
app.use('/api/v1/admin/email-logs', emailLogRouter);
app.use('/api/v1/webhook-subscriptions', webhookSubscriptionRoutes);

// Error handling — Sentry captures before our handler responds
Sentry.setupExpressErrorHandler(app);
app.use(errorHandler);
app.use(bugMonitorErrorMiddleware);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'The requested resource was not found' } });
});

const server = createServer(app);
initializeWebSocket(server);

server.listen(PORT, async () => {
  logger.info(`Backend running on port ${PORT}`);
  logger.info(`Frontend proxy target: ${PORT} (Vite vite.config.ts proxy -> http://localhost:${PORT})`);
  logger.info(`CORS origin: ${process.env['FRONTEND_URL'] || 'http://localhost:5190'}`);

  // Warm up Prisma connection pool with a lightweight query
  try {
    await prisma.$queryRaw`SELECT 1`;
    logger.info('Database connection pool warmed up');
  } catch (err) {
    logger.error('Database warmup failed:', err);
  }

  // Initialize scheduled jobs
  schedulerService.initialize();

  // Initialize agent workers (BullMQ) — requires Redis
  if (isRedisConfigured()) {
    try {
      initializeWorkers();
      logger.info('Agent workers initialized');
    } catch (err) {
      logger.warn('Agent workers failed to initialize — agent features disabled', {
        error: err instanceof Error ? err.message : 'unknown',
      });
    }
    try {
      initializeWebhookDeliveryWorker();
    } catch (err) {
      logger.warn('Webhook delivery worker failed to initialize — outbound webhooks disabled', {
        error: err instanceof Error ? err.message : 'unknown',
      });
    }
  } else {
    logger.info('Redis not configured (REDIS_URL/REDIS_HOST) — agent workers disabled');
  }

  // Initialize bug monitor
  initBugMonitor();
  registerProcessHandlers();

  // Keep-alive: ping /health every 5 minutes to prevent idle shutdown
  if (process.env['NODE_ENV'] === 'production') {
    const keepAliveUrl = `http://localhost:${PORT}/health`;
    setInterval(async () => {
      try {
        await fetch(keepAliveUrl);
      } catch { /* ignore */ }
    }, 5 * 60 * 1000);
    logger.info('Keep-alive ping enabled (every 5 minutes)');
  }

  // Pre-create dev bypass users on startup so auth never fails after restart
  if (process.env['DEV_AUTH_BYPASS'] === 'true') {
    try {
      // Ensure dev admin user exists
      const adminUser = await prisma.user.findUnique({
        where: { cognitoId: 'dev-cognito-id' },
      });
      if (adminUser) {
        logger.info(`Dev admin user ready (id: ${adminUser.id}, email: ${adminUser.email})`);
      } else {
        const newAdmin = await prisma.user.create({
          data: {
            cognitoId: 'dev-cognito-id',
            email: 'admin@dev.local',
            firstName: 'Dev',
            lastName: 'Admin',
            role: 'admin',
            isActive: true,
          },
        });
        logger.info(`Created dev admin user on startup (id: ${newAdmin.id})`);
      }

      // Ensure dev provider user exists with linked provider record
      const providerUser = await prisma.user.findUnique({
        where: { cognitoId: 'dev-provider-cognito-id' },
      });
      if (providerUser) {
        logger.info(`Dev provider user ready (id: ${providerUser.id}, providerId: ${providerUser.providerId})`);
      } else {
        let provider = await prisma.providerProfile.findUnique({
          where: { npi: '1234567890' },
        });
        if (!provider) {
          provider = await prisma.providerProfile.create({
            data: {
              firstName: 'Dev',
              lastName: 'Provider',
              npi: '1234567890',
              email: 'provider@dev.local',
              phone: '555-000-0000',
              status: 'active',
              providerType: 'psychiatrist',
              dateOfBirth: new Date('1980-01-01'),
              gender: 'male',
            },
          });
        }
        const newProvider = await prisma.user.create({
          data: {
            cognitoId: 'dev-provider-cognito-id',
            email: 'provider@dev.local',
            firstName: 'Dev',
            lastName: 'Provider',
            role: 'provider',
            isActive: true,
            providerId: provider.id,
          },
        });
        logger.info(`Created dev provider user on startup (id: ${newProvider.id})`);
      }

      // Ensure dev practice admin user exists
      const practiceAdminUser = await prisma.user.findUnique({
        where: { cognitoId: 'dev-practice-admin-cognito-id' },
      });
      if (practiceAdminUser) {
        logger.info(`Dev practice admin user ready (id: ${practiceAdminUser.id})`);
      } else {
        const devPractice = await prisma.practice.create({
          data: {
            name: 'Dev Practice',
            email: 'practiceadmin@dev.local',
            phone: '555-000-0001',
            status: 'ACTIVE',
          },
        });
        const newPracticeAdmin = await prisma.user.create({
          data: {
            cognitoId: 'dev-practice-admin-cognito-id',
            email: 'practiceadmin@dev.local',
            firstName: 'Dev',
            lastName: 'PracticeAdmin',
            role: 'practice_admin',
            isActive: true,
          },
        });
        await prisma.userPractice.create({
          data: {
            userId: newPracticeAdmin.id,
            practiceId: devPractice.id,
            role: 'SUPER_ADMIN',
          },
        });
        logger.info(`Created dev practice admin user on startup (id: ${newPracticeAdmin.id})`);
      }

      // lanyard_admin role has been consolidated into admin — no separate dev user needed

      logger.info('DEV_AUTH_BYPASS=true — dev users validated and ready');
    } catch (err) {
      logger.error('Failed to bootstrap dev users on startup:', err);
    }
  }

  // Auto-seed core payers if the table is empty (works on fresh DBs and production)
  try {
    const payerCount = await prisma.payer.count();
    if (payerCount === 0) {
      logger.info('Payer table empty — seeding core payers...');
      const corePayers = [
        { name: 'Aetna', payerId: 'AETNA', payerType: 'Medical' },
        { name: 'Cigna', payerId: 'CIGNA', payerType: 'Medical' },
        { name: 'UnitedHealthcare', payerId: 'UHC', payerType: 'Medical' },
        { name: 'Blue Cross Blue Shield', payerId: 'BCBS', payerType: 'Medical' },
        { name: 'Humana', payerId: 'HUMANA', payerType: 'Medical' },
        { name: 'Kaiser Permanente', payerId: 'KAISER', payerType: 'Medical' },
        { name: 'Molina Healthcare', payerId: 'MOLINA', payerType: 'Medical, Medicaid' },
        { name: 'Centene', payerId: 'CENTENE', payerType: 'Medical, Medicaid' },
        { name: 'Anthem', payerId: 'ANTHEM', payerType: 'Medical' },
        { name: 'Medicare', payerId: 'MEDICARE', payerType: 'Government' },
        { name: 'Medicaid', payerId: 'MEDICAID', payerType: 'Government' },
        { name: 'Tricare', payerId: 'TRICARE', payerType: 'Government' },
        { name: 'Magellan Health', payerId: 'MAGELLAN', payerType: 'Behavioral Health' },
        { name: 'Optum', payerId: 'OPTUM', payerType: 'Behavioral Health' },
        { name: 'Beacon Health Options', payerId: 'BEACON', payerType: 'Behavioral Health' },
        { name: 'Carelon Behavioral Health', payerId: 'CARELON', payerType: 'Behavioral Health' },
        { name: 'Evernorth (Express Scripts)', payerId: 'EVERNORTH', payerType: 'Pharmacy' },
        { name: 'CVS Health / Aetna', payerId: 'CVS-AETNA', payerType: 'Medical, Pharmacy' },
        { name: 'Highmark', payerId: 'HIGHMARK', payerType: 'Medical' },
        { name: 'Health Net', payerId: 'HEALTHNET', payerType: 'Medical' },
        { name: 'WellCare', payerId: 'WELLCARE', payerType: 'Medical, Medicaid' },
        { name: 'Amerigroup', payerId: 'AMERIGROUP', payerType: 'Medicaid' },
        { name: 'Oscar Health', payerId: 'OSCAR', payerType: 'Medical' },
        { name: 'Devoted Health', payerId: 'DEVOTED', payerType: 'Medicare Advantage' },
        { name: 'Bright Health', payerId: 'BRIGHTHEALTH', payerType: 'Medical' },
      ];

      for (const p of corePayers) {
        await prisma.payer.upsert({
          where: { payerId: p.payerId },
          update: {},
          create: p,
        });
      }
      logger.info(`Seeded ${corePayers.length} core payers`);
    }
  } catch (err) {
    logger.warn('Payer auto-seed failed (non-fatal):', err);
  }

  serverReady = true;
  logger.info(`Server fully ready — accepting API requests on port ${PORT}`);
});

// Graceful shutdown
function shutdown(signal: string) {
  logger.info(`${signal} received — shutting down gracefully...`);
  serverReady = false; // Stop accepting new API requests via readiness gate

  schedulerService.stop();

  server.close(async () => {
    logger.info('HTTP server closed');
    try {
      await closeAllWorkers();
      await closeWebhookDeliveryWorker();
      await closeAllQueues();
      await closeRedisConnection();
      await prisma.$disconnect();
      logger.info('Database connections closed');
    } catch (err) {
      logger.error('Error during shutdown cleanup:', err);
    }
    process.exit(0);
  });

  // Force exit if graceful shutdown takes too long
  setTimeout(() => {
    logger.error('Graceful shutdown timed out — forcing exit');
    process.exit(1);
  }, 15_000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default app;

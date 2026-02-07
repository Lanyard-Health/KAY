import 'dotenv/config';
import { validateEnv } from './utils/env.js';

// Validate environment variables before anything else
const env = validateEnv();

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';

import { errorHandler } from './middleware/error.middleware.js';
import { auditMiddleware } from './middleware/audit.middleware.js';
import { logger } from './utils/logger.js';

// Routes
import { authRoutes } from './routes/auth.routes.js';
import { providerRoutes } from './routes/provider.routes.js';
import { documentRoutes } from './routes/document.routes.js';
import { credentialRoutes } from './routes/credential.routes.js';
import { userRoutes } from './routes/user.routes.js';
import { caqhRoutes } from './routes/caqh.routes.js';
import { payerRoutes } from './routes/payer.routes.js';
import { expirationRoutes } from './routes/expiration.routes.js';
import { auditRoutes } from './routes/audit.routes.js';
import practiceLocationRoutes from './routes/practiceLocation.routes.js';
import checklistRoutes from './routes/checklist.routes.js';
import enrollmentRoutes from './routes/enrollment.routes.js';
import followUpRoutes from './routes/followup.routes.js';
import { npiRoutes } from './routes/npi.routes.js';
import { pecosRoutes } from './routes/pecos.routes.js';
import { pdmRoutes } from './routes/pdm.routes.js';
import { rosterRoutes } from './routes/roster.routes.js';
import { aiRoutes } from './routes/ai.routes.js';
import portalRoutes from './routes/portal.routes.js';
import taskRoutes from './routes/task.routes.js';
import terminationLetterRoutes from './routes/terminationLetter.routes.js';
import { schedulerService } from './services/scheduler.service.js';
import { prisma } from './utils/prisma.js';

const app = express();
const PORT = process.env['PORT'] || 3002;
let serverReady = false;

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env['FRONTEND_URL'] || 'http://localhost:5190',
  credentials: true,
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
});
app.use('/api', limiter);

// Body parsing and compression
app.use(express.json({ limit: '10mb' }));
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

// Root route — redirect to frontend
app.get('/', (_req, res) => {
  res.redirect(process.env['FRONTEND_URL'] || 'http://localhost:5190');
});

// Health check (with readiness info)
app.get('/health', (_req, res) => {
  const payload = { status: serverReady ? 'ok' : 'starting', ready: serverReady, timestamp: new Date().toISOString() };
  res.status(serverReady ? 200 : 503).json(payload);
});

// Health check alias under /api (registered before the readiness gate)
app.get('/api/health', (_req, res) => {
  const payload = { status: serverReady ? 'ok' : 'starting', ready: serverReady, timestamp: new Date().toISOString() };
  res.status(serverReady ? 200 : 503).json(payload);
});

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
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/caqh', caqhRoutes);
app.use('/api/v1/payers', payerRoutes);
app.use('/api/v1/expirations', expirationRoutes);
app.use('/api/v1/audit', auditRoutes);
app.use('/api/v1/practice-locations', practiceLocationRoutes);
app.use('/api/v1/checklist', checklistRoutes);
app.use('/api/v1/enrollments', enrollmentRoutes);
app.use('/api/v1/follow-up', followUpRoutes);
app.use('/api/v1/npi', npiRoutes);
app.use('/api/v1/pecos', pecosRoutes);
app.use('/api/v1/pdm', pdmRoutes);
app.use('/api/v1/roster', rosterRoutes);
app.use('/api/v1/ai', aiRoutes);
app.use('/api/v1/portal', portalRoutes);
app.use('/api/v1', taskRoutes);
app.use('/api/v1', terminationLetterRoutes);

// Error handling
app.use(errorHandler);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.listen(PORT, async () => {
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
        let provider = await prisma.provider.findUnique({
          where: { npi: '1234567890' },
        });
        if (!provider) {
          provider = await prisma.provider.create({
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

      logger.info('DEV_AUTH_BYPASS=true — dev users validated and ready');
    } catch (err) {
      logger.error('Failed to bootstrap dev users on startup:', err);
    }
  }

  serverReady = true;
  logger.info(`Server fully ready — accepting API requests on port ${PORT}`);
});

export default app;

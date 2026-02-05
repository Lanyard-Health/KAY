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
import { schedulerService } from './services/scheduler.service.js';

const app = express();
const PORT = process.env['PORT'] || 3001;

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env['FRONTEND_URL'] || 'http://localhost:5173',
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

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
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

// Error handling
app.use(errorHandler);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);

  // Initialize scheduled jobs
  schedulerService.initialize();
});

export default app;

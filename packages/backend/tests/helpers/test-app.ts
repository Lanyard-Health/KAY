import express, { type Router } from 'express';
import { errorHandler } from '../../src/middleware/error.middleware.js';

/**
 * Create a test Express app with a router mounted, a mock user injected,
 * and the error handler attached.
 */
export function createTestApp(router: Router, user?: Record<string, unknown>) {
  const app = express();
  app.use(express.json());

  // Inject mock user and practice scope if provided
  if (user) {
    app.use((req, _res, next) => {
      req.user = user as any;
      req.practiceScope = user.role === 'admin'
        ? { isSuperAdmin: true, practiceIds: [] }
        : { isSuperAdmin: false, practiceIds: [] };
      next();
    });
  }

  app.use(router);
  app.use(errorHandler);
  return app;
}

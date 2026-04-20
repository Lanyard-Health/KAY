import { Router, type Request, type Response } from 'express';

/**
 * Aetna-specific routes were retired in Phase 7. The generic form-fill
 * pipeline (POST /api/v1/enrollments/:id/populate-forms) now handles
 * every payer, including Aetna. These routes remain mounted only to
 * return a clear 410 Gone to any lingering client.
 */

export const aetnaRoutes = Router({ mergeParams: true });

aetnaRoutes.all('*', (_req: Request, res: Response) => {
  res.status(410).json({
    success: false,
    error: {
      message:
        'Aetna-specific endpoints have been retired. Use the generic form-fill pipeline instead.',
      migrationPath: '/api/v1/enrollments/:enrollmentId/populate-forms',
    },
  });
});
